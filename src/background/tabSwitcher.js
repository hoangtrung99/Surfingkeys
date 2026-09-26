// Background side of the Command Palette and the Visual Tab Switcher.
//
// Keeps its own most-recently-used tab list (tabHistory in start.js is a capped
// back/forward stack, and tab.lastAccessed ignores window focus changes) and a
// small thumbnail of every tab the user activates, both in storage.session so
// they survive service-worker eviction.
//
// Callback style throughout: Firefox's chrome.* has no promises.

const COMMANDS = {
    commandPalette: 'openPalette',
    tabSwitcher: 'openSwitcher',
};
const MRU_KEY = 'tabSwitcherMRU';
const THUMB_PREFIX = 'tabThumb:';
const CAPTURE_DELAY_MS = 300;  // a freshly activated tab has not painted yet
const CAPTURE_GAP_MS = 1000;   // captureVisibleTab allows 2 calls/s, shared with Surfingkeys' own screenshots
const USER_CAPTURE_QUIET_MS = 2000;
const FRESH_MS = 30000;        // a thumbnail this young of the same page is not taken again
const THUMB_WIDTH = 440;       // 2x the card width in the switcher
const MAX_THUMBS = 80;
const FOCUS_SETTLE_MS = 150;

export default function installTabSwitcher(self, _response) {
    const session = chrome.storage && chrome.storage.session;
    const memThumbs = new Map();  // used only when storage.session is missing
    const shotInfo = new Map();   // tabId -> {url, at} of the stored thumbnail
    let mru = [];
    let restored = !session;
    const waiting = [];
    // closed while the stored list was still being read: it must not come back with it
    const removedEarly = new Set();
    function whenRestored(cb) {
        restored ? cb() : waiting.push(cb);
    }
    if (session) {
        session.get(MRU_KEY, (r) => {
            // merge, don't overwrite: activations may have landed before this read,
            // and their write stored only the part of the list known at the time
            const stored = (r && r[MRU_KEY]) || [];
            mru = mru.concat(stored.filter((id) => mru.indexOf(id) === -1 && !removedEarly.has(id)));
            session.set({[MRU_KEY]: mru});
            restored = true;
            waiting.splice(0).forEach((cb) => cb());
        });
    }

    function touch(tabId) {
        mru = [tabId].concat(mru.filter((id) => id !== tabId));
        session && session.set({[MRU_KEY]: mru});
    }

    let focusedWindowId = chrome.windows.WINDOW_ID_NONE;
    chrome.windows.getLastFocused((w) => {
        if (!chrome.runtime.lastError && w && focusedWindowId === chrome.windows.WINDOW_ID_NONE) {
            focusedWindowId = w.id;
        }
    });

    // A browser page (new tab, chrome://, the Web Store) has no content script to
    // show the switcher, so Alt+Q there just goes back to the previous tab.
    function switchToPrevious(fromTab) {
        whenRestored(() => {
            // the first one still open: a tab id can outlive its tab here
            const ids = mru.filter((i) => i !== fromTab.id);
            (function next(i) {
                i < ids.length && chrome.tabs.get(ids[i], (t) => {
                    if (chrome.runtime.lastError || !t) {
                        next(i + 1);
                        return;
                    }
                    chrome.tabs.update(t.id, {active: true});
                    t.windowId !== fromTab.windowId && chrome.windows.update(t.windowId, {focused: true});
                });
            })(0);
        });
    }

    chrome.commands.onCommand.addListener((command, tab) => {
        if (!COMMANDS.hasOwnProperty(command)) {
            return;  // start.js owns the rest
        }
        // Every frame gets it; the one holding keyboard focus opens the UI
        // (content_scripts/tabSwitcher.js), so Alt is tracked where it is released.
        const send = (t) => chrome.tabs.sendMessage(t.id, {subject: 'tabSwitcherCommand', action: COMMANDS[command]}, () => {
            if (chrome.runtime.lastError && command === 'tabSwitcher') {
                switchToPrevious(t);
            }
        });
        if (tab && tab.id >= 0) {
            send(tab);
        } else {
            chrome.tabs.query({active: true, lastFocusedWindow: true}, (tabs) => tabs[0] && send(tabs[0]));
        }
    });

    // Tell the user once, at install, when another extension (jump, for example)
    // already holds a shortcut: Chrome then leaves ours unassigned, silently.
    chrome.runtime.onInstalled.addListener((details) => {
        if (details.reason !== 'install') {
            return;
        }
        chrome.commands.getAll((cmds) => {
            if ((cmds || []).some((c) => COMMANDS.hasOwnProperty(c.name) && !c.shortcut)) {
                chrome.tabs.create({url: 'chrome://extensions/shortcuts'});
            }
        });
    });

    chrome.tabs.onActivated.addListener(({tabId, windowId}) => {
        // A tab activated in a window the user is not in (a script, a tab moved
        // there) is not one they used. Unknown focus counts as the user's window.
        if (focusedWindowId === chrome.windows.WINDOW_ID_NONE || windowId === focusedWindowId) {
            touch(tabId);
        }
        scheduleCapture(tabId, windowId);
    });
    // Switching to a tab in another window focuses the window first and activates
    // the tab after, so read the window's active tab once that has settled; reading
    // it at once would record the window's previous tab as the last one used.
    let focusTimer = null;
    chrome.windows.onFocusChanged.addListener((windowId) => {
        clearTimeout(focusTimer);
        if (windowId < 0) {
            return;  // WINDOW_ID_NONE: the browser lost focus
        }
        focusedWindowId = windowId;
        focusTimer = setTimeout(() => chrome.tabs.query({active: true, windowId}, (tabs) => {
            if (tabs && tabs[0] && tabs[0].id !== mru[0]) {
                touch(tabs[0].id);
                scheduleCapture(tabs[0].id, windowId);
            }
        }), FOCUS_SETTLE_MS);
    });
    chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
        if (info.status === 'complete' && tab.active) {
            scheduleCapture(tabId, tab.windowId);
        }
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
        restored || removedEarly.add(tabId);
        mru = mru.filter((id) => id !== tabId);
        memThumbs.delete(tabId);
        shotInfo.delete(tabId);
        if (session) {
            session.set({[MRU_KEY]: mru});
            session.remove(THUMB_PREFIX + tabId);
        }
    });

    // --- thumbnails ---------------------------------------------------------
    let captureTimer = null, lastCaptureAt = 0, capturing = false, quietUntil = 0;
    function scheduleCapture(tabId, windowId, delay) {
        clearTimeout(captureTimer);
        const wait = Math.max(lastCaptureAt + CAPTURE_GAP_MS, quietUntil) - Date.now();
        captureTimer = setTimeout(() => capture(tabId, windowId), Math.max(delay || CAPTURE_DELAY_MS, wait));
    }
    function capture(tabId, windowId) {
        if (capturing || Date.now() < quietUntil) {
            scheduleCapture(tabId, windowId, CAPTURE_GAP_MS);
            return;
        }
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab || !tab.active || tab.incognito || !/^(https?|file):/.test(tab.url || '')) {
                return;
            }
            const known = shotInfo.get(tabId);
            if (known && known.url === tab.url && Date.now() - known.at < FRESH_MS) {
                return;
            }
            // A Surfingkeys panel on screen would end up in the thumbnail.
            chrome.tabs.sendMessage(tabId, {subject: 'tabSwitcherUiVisible'}, {frameId: 0}, (res) => {
                if (chrome.runtime.lastError || (res && res.visible)) {
                    return;
                }
                // a screenshot of Surfingkeys' own (yg) may have started during that round trip
                if (capturing || Date.now() < quietUntil) {
                    scheduleCapture(tabId, windowId, CAPTURE_GAP_MS);
                    return;
                }
                capturing = true;
                lastCaptureAt = Date.now();
                chrome.tabs.captureVisibleTab(windowId, {format: 'jpeg', quality: 85}, (dataUrl) => {
                    capturing = false;
                    if (chrome.runtime.lastError || !dataUrl) {
                        return;
                    }
                    // captureVisibleTab shoots whatever is active now; the user may have
                    // switched while the page answered, and those pixels are not this tab's
                    chrome.tabs.get(tabId, (now) => {
                        if (chrome.runtime.lastError || !now || !now.active || now.url !== tab.url) {
                            return;
                        }
                        shrink(dataUrl).then((thumb) => store(tabId, {thumb, url: tab.url, at: Date.now()})).catch(() => {});
                    });
                });
            });
        });
    }
    function shrink(dataUrl) {
        return fetch(dataUrl).then((r) => r.blob()).then((blob) => createImageBitmap(blob)).then((img) => {
            const scale = Math.min(1, THUMB_WIDTH / img.width);
            const canvas = new OffscreenCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            img.close && img.close();
            return canvas.convertToBlob({type: 'image/webp', quality: 0.72}).then((blob) => {
                // Safari's canvas cannot encode webp and silently returns png
                return blob.type === 'image/webp' ? blob : canvas.convertToBlob({type: 'image/jpeg', quality: 0.75});
            });
        }).then((blob) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        }));
    }
    function store(tabId, entry) {
        if (mru.indexOf(tabId) === -1) {
            return;  // closed while its thumbnail was being made
        }
        shotInfo.set(tabId, {url: entry.url, at: entry.at});
        if (!session) {
            memThumbs.set(tabId, entry);
            return;
        }
        session.set({[THUMB_PREFIX + tabId]: entry}, () => void chrome.runtime.lastError);  // quota: the switcher falls back to icons
        whenRestored(() => {
            const old = mru.slice(MAX_THUMBS);
            old.length && session.remove(old.map((id) => THUMB_PREFIX + id));
        });
    }

    // Surfingkeys' own screenshots (yg, yG) spend the same 2-per-second
    // captureVisibleTab budget and stall if a call fails, so thumbnails step aside.
    ['captureVisibleTab', 'getCaptureSize'].forEach((name) => {
        const upstream = self[name];
        if (typeof upstream !== 'function') {
            return;
        }
        self[name] = function(message, sender, sendResponse) {
            clearTimeout(captureTimer);
            quietUntil = Date.now() + USER_CAPTURE_QUIET_MS;
            const wait = lastCaptureAt + CAPTURE_GAP_MS - Date.now();
            if (wait > 0) {
                setTimeout(() => upstream(message, sender, sendResponse), wait);
                return;
            }
            return upstream(message, sender, sendResponse);
        };
    });

    // --- handlers reached via RUNTIME(action, args, cb) ---------------------
    // Every open tab, most recently used first; the tab asking is flagged current.
    self.tabSwitcherTabs = function(message, sender, sendResponse) {
        whenRestored(() => chrome.tabs.query({}, (tabs) => {
            const currentId = sender.tab ? sender.tab.id : -1;
            // The tab asking is the one in use, whatever focus events were missed.
            if (currentId !== -1 && mru[0] !== currentId) {
                touch(currentId);
            }
            const rank = (t) => {
                if (t.id === currentId) {
                    return -1;
                }
                const i = mru.indexOf(t.id);
                return i === -1 ? Infinity : i;
            };
            tabs.sort((a, b) => (rank(a) - rank(b)) || ((b.lastAccessed || 0) - (a.lastAccessed || 0)));
            const currentWindow = sender.tab ? sender.tab.windowId : -1;
            _response(message, sendResponse, {
                tabs: tabs.map((t) => ({
                    id: t.id,
                    windowId: t.windowId,
                    title: t.title,
                    url: t.url || t.pendingUrl || '',
                    favIconUrl: t.favIconUrl,
                    pinned: t.pinned,
                    audible: t.audible,
                    current: t.id === currentId,
                    incognito: t.incognito,
                    otherWindow: currentWindow !== -1 && t.windowId !== currentWindow,
                })),
            });
        }));
    };
    // A subframe's report to its top frame, and the top frame's Alt release and
    // typed-ahead keys to the frontend: sent here, never over postMessage, which the
    // page can use too.
    self.tabSwitcherRelay = function(message, sender) {
        sender.tab && chrome.tabs.sendMessage(sender.tab.id, {subject: 'tabSwitcherRelay', data: message.data}, {frameId: 0}, () => void chrome.runtime.lastError);
    };
    self.tabSwitcherModifierUp = function(message, sender) {
        sender.tab && chrome.tabs.sendMessage(sender.tab.id, {subject: 'tabSwitcherModifierUp', session: message.session, at: message.at}, () => void chrome.runtime.lastError);
    };
    self.tabSwitcherPaletteTypeAhead = function(message, sender) {
        sender.tab && chrome.tabs.sendMessage(sender.tab.id, {subject: 'paletteTypeAhead', text: message.text, then: message.then, shift: message.shift}, () => void chrome.runtime.lastError);
    };
    // Thumbnails are a separate request so the palette never pays for images
    // and the switcher can draw its cards before they arrive.
    self.tabSwitcherThumbnails = function(message, sender, sendResponse) {
        const ids = message.tabIds || [];
        if (!session) {
            const thumbs = {};
            ids.forEach((id) => memThumbs.has(id) && (thumbs[id] = memThumbs.get(id)));
            _response(message, sendResponse, {thumbs});
            return;
        }
        session.get(ids.map((id) => THUMB_PREFIX + id), (items) => {
            const thumbs = {};
            Object.keys(items || {}).forEach((k) => {
                thumbs[k.slice(THUMB_PREFIX.length)] = items[k];
            });
            _response(message, sendResponse, {thumbs});
        });
    };
}
