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
const THUMB_WIDTH = 440;       // 2x the card width in the switcher
const MAX_THUMBS = 80;
const FOCUS_SETTLE_MS = 150;

export default function installTabSwitcher(self, _response) {
    const session = chrome.storage && chrome.storage.session;
    const memThumbs = new Map();  // used only when storage.session is missing
    let mru = [];
    let restored = !session;
    const waiting = [];
    function whenRestored(cb) {
        restored ? cb() : waiting.push(cb);
    }
    if (session) {
        session.get(MRU_KEY, (r) => {
            // merge, don't overwrite: activations may have landed before this read
            const stored = (r && r[MRU_KEY]) || [];
            mru = mru.concat(stored.filter((id) => mru.indexOf(id) === -1));
            restored = true;
            waiting.splice(0).forEach((cb) => cb());
        });
    }

    function touch(tabId) {
        mru = [tabId].concat(mru.filter((id) => id !== tabId));
        session && session.set({[MRU_KEY]: mru});
    }

    chrome.commands.onCommand.addListener((command, tab) => {
        if (!COMMANDS.hasOwnProperty(command)) {
            return;  // start.js owns the rest
        }
        const send = (t) => chrome.tabs.sendMessage(t.id, {subject: 'tabSwitcherCommand', action: COMMANDS[command]},
            {frameId: 0}, () => void chrome.runtime.lastError);  // no content script (chrome:// etc): nothing to open
        if (tab && tab.id >= 0) {
            send(tab);
        } else {
            chrome.tabs.query({active: true, lastFocusedWindow: true}, (tabs) => tabs[0] && send(tabs[0]));
        }
    });

    chrome.tabs.onActivated.addListener(({tabId, windowId}) => {
        touch(tabId);
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
        mru = mru.filter((id) => id !== tabId);
        memThumbs.delete(tabId);
        if (session) {
            session.set({[MRU_KEY]: mru});
            session.remove(THUMB_PREFIX + tabId);
        }
    });

    // --- thumbnails ---------------------------------------------------------
    let captureTimer = null, lastCaptureAt = 0, capturing = false;
    function scheduleCapture(tabId, windowId, delay) {
        clearTimeout(captureTimer);
        const gap = lastCaptureAt + CAPTURE_GAP_MS - Date.now();
        captureTimer = setTimeout(() => capture(tabId, windowId), Math.max(delay || CAPTURE_DELAY_MS, gap));
    }
    function capture(tabId, windowId) {
        if (capturing) {
            scheduleCapture(tabId, windowId, CAPTURE_GAP_MS);
            return;
        }
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab || !tab.active || tab.incognito || !/^(https?|file):/.test(tab.url || '')) {
                return;
            }
            // A Surfingkeys panel on screen would end up in the thumbnail.
            chrome.tabs.sendMessage(tabId, {subject: 'tabSwitcherUiVisible'}, {frameId: 0}, (res) => {
                if (chrome.runtime.lastError || (res && res.visible)) {
                    return;
                }
                capturing = true;
                lastCaptureAt = Date.now();
                chrome.tabs.captureVisibleTab(windowId, {format: 'jpeg', quality: 85}, (dataUrl) => {
                    capturing = false;
                    if (chrome.runtime.lastError || !dataUrl) {
                        return;
                    }
                    shrink(dataUrl).then((thumb) => store(tabId, {thumb, url: tab.url, at: Date.now()})).catch(() => {});
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
        if (!session) {
            memThumbs.set(tabId, entry);
            return;
        }
        session.set({[THUMB_PREFIX + tabId]: entry}, () => {
            void chrome.runtime.lastError;  // quota: the in-memory list still works
            session.get(null, (all) => {
                const keep = new Set(mru.slice(0, MAX_THUMBS).map((id) => THUMB_PREFIX + id));
                const stale = Object.keys(all || {}).filter((k) => k.startsWith(THUMB_PREFIX) && !keep.has(k));
                stale.length && session.remove(stale);
            });
        });
    }

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
                })),
            });
        }));
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
