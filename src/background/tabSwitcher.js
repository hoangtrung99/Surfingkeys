// Background side of the Command Palette and the Visual Tab Switcher.
//
// Keeps its own most-recently-used tab list (tabHistory in start.js is a capped
// back/forward stack, and tab.lastAccessed ignores window focus changes) and a
// small thumbnail of every tab the user activates, both in storage.session so
// they survive service-worker eviction.
//
// On a tab Surfingkeys cannot run in (chrome:// pages, the New Tab page, the
// Web Store) the palette and the switcher open in pages/palette.html instead:
// the toolbar dropdown, or a small window when Chrome cannot show that. Every
// request that frame sends then acts on the tab the shortcut was pressed on.
//
// Callback style throughout: Firefox's chrome.* has no promises.
import { THEME_KEY } from '../content_scripts/common/themes.js';
import { HOSTED_PATH, hostedUrl, isHostedSender, parseHostedUrl, popupBounds, surfaceOf } from './hostedUi.js';

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
const TAP_MS = 300;            // Alt+Q on a blocked page: a second press within this opens the strip

export default function installTabSwitcher(self, _response) {
    const session = chrome.storage && chrome.storage.session;
    const base = chrome.runtime.getURL('');
    // split incognito runs a second worker on the same storage
    const HOSTED_KEY = 'tabSwitcherHosted' + (chrome.extension && chrome.extension.inIncognitoContext ? ':incognito' : '');
    // The open palette.html: {n, ui, targetTabId, targetWindowId, surface, hostTabId, hostWindowId, queue, ready}.
    let hosted = null;
    let tap = null;
    const hook = globalThis.__skTabSwitcher = {command: onCommand, forceSurface: null, hosted: () => hosted};
    const memThumbs = new Map();  // used only when storage.session is missing
    const shotInfo = new Map();   // tabId -> {url, at} of the stored thumbnail
    let mru = [];
    let restored = !session;
    const waiting = [];
    function whenRestored(cb) {
        restored ? cb() : waiting.push(cb);
    }
    if (session) {
        session.get([MRU_KEY, HOSTED_KEY], (r) => {
            // merge, don't overwrite: activations may have landed before this read,
            // and their write stored only the part of the list known at the time
            const stored = (r && r[MRU_KEY]) || [];
            mru = mru.concat(stored.filter((id) => mru.indexOf(id) === -1));
            session.set({[MRU_KEY]: mru});
            hosted = hosted || (r && r[HOSTED_KEY]) || null;
            restored = true;
            waiting.splice(0).forEach((cb) => cb());
        });
    }

    function touch(tabId) {
        mru = [tabId].concat(mru.filter((id) => id !== tabId));
        session && session.set({[MRU_KEY]: mru});
    }
    function saveHosted() {
        if (session) {
            hosted ? session.set({[HOSTED_KEY]: hosted}) : session.remove(HOSTED_KEY);
        }
    }
    function isHostUrl(url) {
        return (url || '').startsWith(base + HOSTED_PATH);
    }
    // The fallback window is not a place the user works in. Until windows.create
    // answers, any window focused is taken for it.
    function isHostWindow(windowId) {
        return !!hosted && hosted.surface === 'window' && (hosted.hostWindowId === -1 || windowId === hosted.hostWindowId);
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
            const id = mru.find((i) => i !== fromTab.id);
            id !== undefined && chrome.tabs.get(id, (t) => {
                if (chrome.runtime.lastError || !t) {
                    return;
                }
                chrome.tabs.update(t.id, {active: true});
                t.windowId !== fromTab.windowId && chrome.windows.update(t.windowId, {focused: true});
            });
        });
    }

    function onCommand(command, tab) {
        if (!COMMANDS.hasOwnProperty(command)) {
            return;  // start.js owns the rest
        }
        const go = (t) => whenRestored(() => dispatch(command, t));
        if (tab && tab.id >= 0) {
            go(tab);
        } else {
            chrome.tabs.query({active: true, lastFocusedWindow: true}, (tabs) => tabs && tabs[0] && go(tabs[0]));
        }
    }
    chrome.commands.onCommand.addListener(onCommand);

    function dispatch(command, tab) {
        // Alt+Q again before the first press went back: Alt is held, to browse.
        // Any other shortcut meanwhile drops the going back.
        const pending = tap;
        clearTimeout(pending && pending.timer);
        tap = null;
        if (pending && command === 'tabSwitcher' && pending.tabId === tab.id) {
            openHosted('switcher', tab, ['switcher']);
            return;
        }
        // Inside the dropdown Chrome runs the shortcut before the page ever sees
        // it, and reports the tab under the dropdown: the open palette.html is
        // where a repeat press belongs, or it would open a second one.
        findHost((h) => {
            if (h && (tab.windowId === h.targetWindowId || tab.windowId === h.hostWindowId || isHostUrl(tab.url))) {
                toHost(h, command === 'commandPalette' ? 'palette' : 'switcher');
            } else {
                probe(command, tab);
            }
        });
    }

    // Every frame gets the command; the one holding keyboard focus opens the UI
    // (content_scripts/tabSwitcher.js), so Alt is tracked where it is released.
    // Whether Surfingkeys is live in the top document is asked at the same time,
    // and that answer decides: on the Web Store an embedded frame can answer the
    // command while the page itself can show nothing.
    function probe(command, tab) {
        chrome.tabs.sendMessage(tab.id, {subject: 'tabSwitcherCommand', action: COMMANDS[command]}, () => void chrome.runtime.lastError);
        chrome.tabs.sendMessage(tab.id, {subject: 'tabSwitcherUiVisible'}, {frameId: 0}, () => {
            if (chrome.runtime.lastError) {
                blocked(command, tab);
            }
        });
    }

    function blocked(command, tab) {
        if (command === 'commandPalette') {
            openHosted('palette', tab, []);
            return;
        }
        // Nothing here hears Alt, so a quick tap cannot be told from a hold: a
        // single press goes back to the previous tab, a second one opens the strip.
        // The second can also land here, when both came before the first's answer.
        if (tap && tap.tabId === tab.id) {
            clearTimeout(tap.timer);
            tap = null;
            openHosted('switcher', tab, ['switcher']);
            return;
        }
        clearTimeout(tap && tap.timer);
        tap = {tabId: tab.id, timer: setTimeout(() => {
            tap = null;
            switchToPrevious(tab);
        }, TAP_MS)};
    }

    // Is the palette.html of this record still open? The dropdown closes by
    // itself (a click in the page, another tab), without a word.
    function findHost(cb) {
        const h = hosted;
        const answer = (open) => cb(open && hosted === h ? h : null);
        if (!h) {
            cb(null);
        } else if (chrome.runtime.getContexts) {
            chrome.runtime.getContexts({contextTypes: ['POPUP', 'TAB']}, (contexts) => {
                answer(!chrome.runtime.lastError && (contexts || []).some((c) => {
                    const page = parseHostedUrl(c.documentUrl, base);
                    return page && page.n === h.n;
                }));
            });
        } else if (h.hostTabId >= 0) {
            chrome.tabs.get(h.hostTabId, (t) => answer(!chrome.runtime.lastError && !!t));
        } else {
            answer(false);
        }
    }

    // Presses that arrive while the page loads are handed over when it is ready.
    function toHost(h, action) {
        if (h.ready) {
            chrome.runtime.sendMessage({subject: 'tabSwitcherHosted', action, n: h.n}, () => void chrome.runtime.lastError);
        } else {
            h.queue.push(action);
            saveHosted();
        }
    }

    function openHosted(ui, tab, queue) {
        closeHosted(false);
        const h = hosted = {
            n: Math.random().toString(36).slice(2, 12),
            ui,
            targetTabId: tab.id,
            targetWindowId: tab.windowId,
            surface: 'popup',
            hostTabId: -1,
            hostWindowId: -1,
            queue,
            ready: false,
        };
        saveHosted();
        chrome.storage.local.get(THEME_KEY, (r) => {
            const bg = surfaceOf(r && r[THEME_KEY]);
            if (hosted !== h) {
                return;
            }
            if (hook.forceSurface === 'window' || !chrome.action || typeof chrome.action.openPopup !== 'function') {
                openHostWindow(h, tab, bg);
                return;
            }
            // Only this tab's popup changes, and only until the dropdown is up: a
            // click on the icon later still shows the enable/disable page. It is
            // put back as it was, not emptied: an empty popup means none at all,
            // and the icon would do nothing on this tab until it navigates.
            chrome.action.getPopup({tabId: tab.id}, (previous) => {
                if (chrome.runtime.lastError) {
                    dropHosted(h);  // the tab is gone
                    return;
                }
                chrome.action.setPopup({tabId: tab.id, popup: hostedUrl({ui, bg, n: h.n})}, () => {
                    chrome.action.openPopup({windowId: tab.windowId}, () => {
                        const err = chrome.runtime.lastError;
                        chrome.action.setPopup({tabId: tab.id, popup: previous || ''}, () => void chrome.runtime.lastError);
                        if (!err || hosted !== h) {
                            return;
                        }
                        if (/inactive window/i.test(err.message || '')) {
                            dropHosted(h);  // the user has moved on
                        } else {
                            openHostWindow(h, tab, bg);  // no toolbar, another dropdown open, ...
                        }
                    });
                });
            });
        });
    }

    function openHostWindow(h, tab, bg) {
        h.surface = 'window';
        saveHosted();
        const url = hostedUrl({ui: h.ui, bg, n: h.n, surface: 'window'});
        chrome.windows.get(tab.windowId, (win) => {
            const create = (bounds) => chrome.windows.create(Object.assign({url, type: 'popup', focused: true}, bounds), (w) => {
                if (chrome.runtime.lastError || !w) {
                    // a position off every screen is refused: let Chrome place it
                    bounds.left !== undefined ? create({width: bounds.width, height: bounds.height}) : dropHosted(h);
                    return;
                }
                if (hosted === h) {
                    h.hostWindowId = w.id;
                    h.hostTabId = w.tabs && w.tabs[0] ? w.tabs[0].id : h.hostTabId;
                    saveHosted();
                } else {
                    chrome.windows.remove(w.id, () => void chrome.runtime.lastError);  // closed while it opened
                }
            });
            create(popupBounds(h.ui, chrome.runtime.lastError ? null : win));
        });
    }

    // refocus: the fallback window was the focused one, and the page under it
    // should get the keyboard back.
    function closeHosted(refocus) {
        const h = hosted;
        if (!h) {
            return;
        }
        hosted = null;
        saveHosted();
        chrome.runtime.sendMessage({subject: 'tabSwitcherHosted', action: 'close', n: h.n}, () => void chrome.runtime.lastError);
        if (h.surface === 'window') {
            // the tab, not the window: closing a popup window files it under
            // recently closed, where Reopen Closed Tab would bring it back
            h.hostTabId >= 0 && chrome.tabs.remove(h.hostTabId, () => void chrome.runtime.lastError);
            refocus && chrome.windows.update(h.targetWindowId, {focused: true}, () => void chrome.runtime.lastError);
        }
    }
    function dropHosted(h) {
        if (hosted === h) {
            hosted = null;
            saveHosted();
        }
    }

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
        if (isHostWindow(windowId)) {
            return;
        }
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
        if (hosted) {
            if (isHostWindow(windowId)) {
                return;
            }
            // another Chrome window, or back to the page under the fallback window
            if (hosted.surface === 'window' || windowId !== hosted.targetWindowId) {
                closeHosted(false);
            }
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
        if (info.status === 'complete' && isHostUrl(tab.url)) {
            chrome.history && chrome.history.deleteUrl({url: tab.url}, () => void chrome.runtime.lastError);
        } else if (info.status === 'complete' && tab.active) {
            scheduleCapture(tabId, tab.windowId);
        }
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
        if (hosted && tabId === hosted.hostTabId) {
            hosted = null;
            saveHosted();
        }
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
        whenRestored(() => chrome.tabs.query({}, (all) => {
            const tabs = all.filter((t) => !isHostUrl(t.url || t.pendingUrl));
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

    // --- palette.html -------------------------------------------------------
    // From its own document (content_scripts/tabSwitcher.js): ready, with what
    // was pressed while it loaded, or done. A page no record waits for (reopened
    // from history, a stale one) gets null and closes.
    function hostedReply(message, sender) {
        const h = hosted && hosted.n === message.n ? hosted : null;
        if (message.ready) {
            const queue = h ? h.queue.splice(0) : null;
            if (h) {
                h.ready = true;
                if (sender.tab) {  // the fallback window can be ready before windows.create answers
                    h.hostTabId = sender.tab.id;
                    h.hostWindowId = sender.tab.windowId;
                }
                saveHosted();
            }
            return {queue};
        }
        message.done && h && closeHosted(true);
        return {};
    }
    self.tabSwitcherHosted = function(message, sender, sendResponse) {
        if (restored) {
            return hostedReply(message, sender);
        }
        whenRestored(() => _response(message, sendResponse, hostedReply(message, sender)));
    };

    function inWindow(tab, cb) {
        chrome.tabs.query({windowId: tab.windowId}, (tabs) => cb(tabs || []));
    }
    // start.js resolves these from the service worker's current window, which is
    // the fallback window while that is open: they would act on it, not on the
    // page under it. The dropdown leaves the page's window current, and runs the
    // same code, so both surfaces behave alike.
    const OVERRIDES = {
        togglePinTab(message, sender) {
            chrome.tabs.update(sender.tab.id, {pinned: !sender.tab.pinned});
        },
        tabOnly(message, sender) {
            inWindow(sender.tab, (tabs) => chrome.tabs.remove(tabs.filter((t) => t.id !== sender.tab.id && !t.pinned).map((t) => t.id)));
        },
        closeTabsToLeft(message, sender) {
            inWindow(sender.tab, (tabs) => chrome.tabs.remove(tabs.filter((t) => t.index < sender.tab.index).map((t) => t.id)));
        },
        closeTabsToRight(message, sender) {
            inWindow(sender.tab, (tabs) => chrome.tabs.remove(tabs.filter((t) => t.index > sender.tab.index).map((t) => t.id)));
        },
        getWindows(message, sender, sendResponse, upstream) {
            chrome.windows.getAll({windowTypes: ['normal']}, (wins) => {
                const others = new Set((wins || []).map((w) => w.id).filter((id) => id !== sender.tab.windowId));
                upstream.call(self, message, sender, (r) => sendResponse(Object.assign({}, r, {
                    windows: ((r && r.windows) || []).filter((w) => others.has(parseInt(w.id))),
                })));
            });
        },
        gatherWindows(message, sender) {
            const into = sender.tab.windowId;
            chrome.windows.getAll({populate: true, windowTypes: ['normal']}, (wins) => (wins || []).forEach((w) => {
                if (w.id !== into && w.incognito === sender.tab.incognito) {
                    (w.tabs || []).forEach((t) => chrome.tabs.move(t.id, {windowId: into, index: -1}));
                }
            }));
        },
        openLink(message, sender, sendResponse, upstream) {
            const how = message.tab || {};
            if (how.tabbed || how.cookieStoreId) {
                return upstream.call(self, message, sender, sendResponse);
            }
            const url = String(message.url || '').trim();
            if (!/^javascript:/i.test(url)) {  // refused, as upstream does
                chrome.tabs.update(sender.tab.id, {
                    url: /^[\w-]+?:/.test(url) ? url : 'http://' + url,
                    pinned: !!how.pinned || sender.tab.pinned,
                }, () => void chrome.runtime.lastError);
            }
        },
        // the fallback window, once closed, is the most recent entry
        openLast() {
            chrome.sessions.getRecentlyClosed((entries) => {
                const ours = (t) => isHostUrl(t && t.url);
                const entry = (entries || []).find((e) => (e.tab ? !ours(e.tab) : e.window && !(e.window.tabs || []).every(ours)));
                entry && chrome.sessions.restore((entry.tab || entry.window).sessionId);
            });
        },
    };

    function targetOf(h, cb) {
        if (!h) {
            cb(null);
            return;
        }
        chrome.tabs.get(h.targetTabId, (t) => {
            if (!chrome.runtime.lastError && t) {
                cb(t);
                return;
            }
            // gone (Close Tab from the palette): whatever its window shows now
            chrome.tabs.query({active: true, windowId: h.targetWindowId}, (tabs) => {
                cb(!chrome.runtime.lastError && tabs && tabs[0] && !isHostUrl(tabs[0].url) ? tabs[0] : null);
            });
        });
    }

    // Every request from the palette.html frontend is made as if the frontend sat
    // in the page the shortcut was pressed on: that tab stands in for sender.tab,
    // freshly read (mute, pin), as the top frame (openLink then opens next to it
    // instead of asking which tab is active). Without this every action would
    // act on no tab, or on the fallback window's own. Everything else goes
    // through untouched and synchronously, as before.
    Object.keys(self).forEach((name) => {
        const upstream = self[name];
        if (typeof upstream !== 'function' || name === 'tabSwitcherHosted') {
            return;
        }
        self[name] = function(message, sender, sendResponse) {
            if (!isHostedSender(sender, base)) {
                return upstream.apply(this, arguments);
            }
            whenRestored(() => {
                const page = sender.tab && parseHostedUrl(sender.tab.url, base);
                const h = hosted && (!page || page.n === hosted.n) ? hosted : null;
                targetOf(h, (tab) => {
                    const as = tab ? Object.assign({}, sender, {tab, frameId: 0, url: tab.url}) : sender;
                    const result = tab && OVERRIDES[name]
                        ? OVERRIDES[name](message, as, sendResponse, upstream)
                        : upstream.call(self, message, as, sendResponse);
                    if (result && message && message.needResponse) {
                        _response(message, sendResponse, result);
                    }
                });
            });
        };
    });
}
