import {
    NATIVE_HOST_NAME,
    NATIVE_LOCAL_PATH,
    filterByTitleOrUrl,
    snippetsRevision,
} from '../common/utils.js';

function request(url, onReady, headers, data, onException) {
    headers = headers || {};
    const CHARTSET_RE = /(?:charset|encoding)\s*=\s*['"]? *([\w\-]+)/i;

    fetch(url, {
        method: (data !== undefined) ? "POST" : "GET",
        headers,
        body: data,
    }).then(res => {
        const cs = res.headers.get('content-type') ? res.headers.get('content-type').match(CHARTSET_RE) : [];

        return Promise.all([
            Promise.resolve(cs && cs.length > 1 ? cs[1] : "utf-8"),
            res.arrayBuffer()
        ])
    }).then(res => {
        const decoder = new TextDecoder(res[0]);
        const content = decoder.decode(res[1]);
        onReady(content);
    }).catch(exp => {
        onException && onException(exp);
    });
}

// Without a deadline, a host that stays alive but answers nothing leaves getSettings
// unanswered and the page runs no user settings at all.
const NATIVE_SETTINGS_TIMEOUT = 5000;

// Callbacks waiting on the read that is currently running, or null when none is.
let nativeSettingsWaiters = null;

// The long-lived connection to neovim, when this browser has one. Module-level
// because _save() reads the file too, from outside start()'s scope.
let nativeHost = null;

// Turns one native reply into onReady or onException. The nvim host wraps every
// reply as {status, res, id}; the Safari app answers with the payload itself.
function deliverNativeSettings(response, onReady, onException) {
    const reply = (response && response.res) || response;
    // status false means the host itself threw, so `res` is a STRING with no
    // `.error`. Checked first, or a lua error the host already named is reported as
    // an out-of-date server.lua.
    if (response && response.status === false) {
        onException(typeof reply === "string" && reply
            ? reply
            : "the native app failed to read the file");
    } else if (!reply) {
        onException("no response from the native app");
    } else if (reply.error) {
        onException(reply.error);
    } else if (typeof reply.data === "string") {
        onReady(reply.data);
    } else {
        onException("the native app did not return the file, please update it");
    }
}

// Asks the native app for ~/.surfingkeys.js, which the extension cannot read itself:
// Safari can fetch no file:// URL, and elsewhere the browser will not tell us where
// the user's home directory is.
//
// Over the neovim connection when there is one, so one process serves the editor and
// the read. sendNativeMessage is for Safari, whose host is its containing app; on
// Chrome and Firefox it would start `nvim --headless` once per read.
//
// Concurrent callers share one read, since a full settings load happens once per
// FRAME. Only OVERLAPPING reads are shared, so an edit to ~/.surfingkeys.js takes
// effect on the next page load.
//
// onException gets the native side's own message: no host, no such file, an old
// server.lua and no answer at all need different fixes.
function readNativeSettings(onReady, onException) {
    if (nativeSettingsWaiters) {
        nativeSettingsWaiters.push({onReady, onException});
        return;
    }
    const waiters = [{onReady, onException}];
    nativeSettingsWaiters = waiters;

    // Whichever of the deadline and the reply lands first ends the read for everyone:
    // a reply arriving afterwards must not hand the page settings it has been told it
    // is not getting. The waiter list is cleared before the callbacks run, so one that
    // reads again from its own callback starts a fresh read.
    //
    // Giving up is told to the neovim connection too, which has no deadline of its own
    // and would hold the request for the next read to trip over.
    let settled = false;
    const abandon = new AbortController();
    const finish = function(method, arg) {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timer);
        abandon.abort();
        nativeSettingsWaiters = null;
        waiters.forEach(function(waiter) {
            waiter[method](arg);
        });
    };
    const timer = setTimeout(function() {
        finish("onException", `the native app did not answer within ${NATIVE_SETTINGS_TIMEOUT / 1000} seconds`);
    }, NATIVE_SETTINGS_TIMEOUT);
    const onReply = (response) => deliverNativeSettings(response,
        (data) => finish("onReady", data),
        (reason) => finish("onException", reason));

    if (nativeHost && nativeHost.request) {
        // No fallback to a one-off process when this connection is unusable: the
        // point of sending it here is that there is ONE neovim.
        nativeHost.request({command: "Settings.read"}, {signal: abandon.signal}).then(onReply, function(error) {
            finish("onException", error && error.message ? error.message : String(error));
        });
        return;
    }

    try {
        chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {command: "Settings.read"}, function(response) {
            if (chrome.runtime.lastError) {
                finish("onException", chrome.runtime.lastError.message);
                return;
            }
            onReply(response);
        });
    } catch (e) {
        finish("onException", e.toString());
    }
}

// Profile switching (gP) goes through the native host: an extension can neither list
// the browser's other profiles nor open a tab in one, and server.lua can, by starting
// the browser itself with --profile-directory (see its Profile.open).
const NATIVE_PROFILES_TIMEOUT = 5000;
// server.lua answers Profile.open once the browser it started has exited, and gives
// that 15 seconds. This deadline must outlast it: a shorter one reports "no answer"
// while the switch is still being decided, and may then happen anyway.
const NATIVE_OPEN_PROFILE_TIMEOUT = 20000;

// Tabs of the browser's other profiles, for the palette, through the same host: the
// hosts of one browser's profiles reach each other (server.lua's Peers.*). Each
// deadline must outlast the host's own -- 1.5 seconds for every other profile's tab
// list, 3 for a switch -- or the reason the host gives is lost to "no answer".
const NATIVE_PEER_TABS_TIMEOUT = 3000;
const NATIVE_PEER_ACTIVATE_TIMEOUT = 5000;
// The host looks for the identifying token for up to 2 seconds.
const NATIVE_IDENTIFY_TIMEOUT = 5000;
// Where the token is written: a key in chrome.storage.local, removed once the host has
// looked for it.
const PROFILE_TOKEN_KEY = "_profileToken";

// Asks the native host one Profile.* or Peers.* command and calls `done` exactly once,
// with {data} or {error, kind}. `kind` names the fix the menu points at: "host" when no
// host can be reached, "update" for a server.lua from before the command existed --
// which answers it with no `res` at all -- and "pending" when the host could not tell
// whether it worked: an outcome the menu must not call a failure.
function askProfileHost(message, timeout, done, outdated = "this server.lua cannot switch profiles yet, update it") {
    let settled = false;
    const abandon = new AbortController();
    const finish = function(result) {
        if (settled) {
            return;
        }
        settled = true;
        clearTimeout(timer);
        // The connection has no deadline of its own: an entry left behind would be
        // held for the next request to trip over.
        abandon.abort();
        done(result);
    };
    const timer = setTimeout(function() {
        finish({error: `the native host did not answer within ${timeout / 1000} seconds`});
    }, timeout);
    if (!nativeHost || !nativeHost.request) {
        finish({error: "Surfingkeys' native messaging host is not set up for this browser", kind: "host"});
        return;
    }
    nativeHost.request(message, {signal: abandon.signal}).then(function(response) {
        const res = response && response.res;
        if (response && response.status === false) {
            // the host threw, and `res` is its message
            finish({error: typeof res === "string" && res ? res : "the native host failed"});
        } else if (res && typeof res === "object" && res.error) {
            finish(res.pending === true ? {error: String(res.error), kind: "pending"} : {error: String(res.error)});
        } else if (res && typeof res === "object" && "data" in res) {
            finish({data: res.data});
        } else {
            finish({error: outdated, kind: "update"});
        }
    }, function(error) {
        const reason = (error && error.message ? error.message : String(error)).replace(/\.$/, "");
        finish({error: `cannot reach Surfingkeys' native messaging host: ${reason}`, kind: "host"});
    });
}

function dictFromArray(arry, val) {
    var dict = {};
    arry.forEach(function(h) {
        dict[h] = val;
    });
    return dict;
}

function extendObject(target, ss) {
    for (var k in ss) {
        target[k] = ss[k];
    }
}

function getSubSettings(set, keys) {
    var subset;
    if (!keys) {
        // if null/undefined/""
        subset = set;
    } else {
        if ( !(keys instanceof Array) ) {
            keys = [ keys ];
        }
        subset = {};
        keys.forEach(function(k) {
            subset[k] = set[k];
        });
    }
    return subset;
}

function _save(storage, data, cb) {
    // _save never writes the identifying token, to either area: it is how the adapters'
    // loadRawSettings copies one area into the other, and only identifyToHost's own
    // write of local storage may hold the token. Copied into sync storage, it is never
    // removed from there -- identifyToHost removes it from local storage only -- and it
    // is synced to every profile and computer signed in to the same account.
    delete data[PROFILE_TOKEN_KEY];
    if (storage === chrome.storage.sync) {
        // don't store snippets from localPath into sync storage, since sync storage has its quota.
        if (data.localPath) {
            delete data.snippets;
            delete data.localPath;
        }
        if (Object.keys(data).length > 1) {
            storage.set(data, cb);
        } else if (cb) {
            // nothing but savedAt is left to sync: still answer, or loading
            // settings saved with only a localPath never calls back
            cb();
        }
    } else {
        if (data.localPath) {
            delete data.snippets;
            const cacheSnippets = function(resp) {
                data.snippets = resp;
                storage.set(data, cb);
            };
            // `data` carries no `snippets` key, so the copy already in storage stays:
            // the settings being saved are unrelated to the file.
            const saveWithoutSnippets = function() {
                storage.set(data, cb);
            };
            // try to fetch snippets from localPath and cache it in local storage.
            if (data.localPath === NATIVE_LOCAL_PATH) {
                readNativeSettings(cacheSnippets, saveWithoutSnippets);
            } else {
                request(data.localPath, cacheSnippets, undefined, undefined, saveWithoutSnippets);
            }
        } else {
            storage.set(data, cb);
        }
    }
}

function start(browser) {
    var self = {};

    // Claimed before the first settings load below, so even that read goes over the
    // editor's connection.
    nativeHost = browser.nvimServer || null;

    const isMV3 = chrome.runtime.getManifest().manifest_version === 3;

    var tabHistory = [],
        tabHistoryIndex = 0,
        chromelikeNewTabPosition = 0,
        historyTabAction = false;

    // data by tab id
    var tabActivated = {},
        tabMessages = {},
        tabURLs = {},
        tabIconStatus = {};

    var newTabUrl = browser._setNewTabUrl();

    var conf = {
        focusAfterClosed: "right",
        tabsMRUOrder: true,
        newTabPosition: 'default',
        showTabIndices: false,
        interceptedErrors: []
    };

    var bookmarkFolders = [];
    function getFolders(tree, root) {
        var cd = root;
        if (tree.title !== "" && (!tree.hasOwnProperty('url') || tree.url === undefined)) {
            cd += "/" + tree.title;
            bookmarkFolders.push({id: tree.id, title: cd + "/"});
        }
        if (tree.hasOwnProperty('children')) {
            for (var i = 0; i < tree.children.length; ++i) {
                getFolders(tree.children[i], cd);
            }
        }
    }

    function createBookmark(page, onCreated) {
        if (page.path.length) {
            chrome.bookmarks.create({
                'parentId': page.folder,
                'title': page.path.shift()
            }, function(newFolder) {
                page.folder = newFolder.id;
                createBookmark(page, onCreated);
            });
        } else {
            chrome.bookmarks.create({
                'parentId': page.folder,
                'title': page.title,
                'url': page.url
            }, function(ret) {
                onCreated(ret);
            });
        }
    }

    function loadSettings(keys, cb) {
        var tmpSet = {
            blocklist: {},
            marks: {},
            findHistory: [],
            cmdHistory: [],
            sessions: {},
            proxyMode: 'clear',
            autoproxy_hosts: [],
            proxy: []
        };

        browser.loadRawSettings(keys, function(set) {
            if (typeof(set.proxy) === "string") {
                set.proxy = [set.proxy];
                set.autoproxy_hosts = [set.autoproxy_hosts];
            }
            if (set.localPath) {
                readSnippets(set.localPath, function(resp) {
                    set.snippets = resp;
                    cb(set);
                }, function (reason) {
                    // The cached snippets stay in `set`, so the last copy read keeps
                    // working while the banner says what went wrong.
                    const from = set.localPath === NATIVE_LOCAL_PATH ? "~/.surfingkeys.js" : set.localPath;
                    set.error = "Failed to read snippets from " + from + (reason ? ": " + reason : "");
                    cb(set);
                });
            } else {
                cb(set);
            }
        }, tmpSet);
    }

    loadSettings(null, function(data) {
        browser._applyProxySettings(data);
    });

    function removeTab(tabId) {
        delete tabActivated[tabId];
        delete tabMessages[tabId];
        delete tabURLs[tabId];
        delete tabIconStatus[tabId];
        tabHistory = tabHistory.filter(function(e) {
            return e !== tabId;
        });
        if (_queueURLs.length) {
            chrome.tabs.create({
                active: false,
                url: _queueURLs.shift()
            });
        }

        _updateTabIndices();
    }
    chrome.tabs.onRemoved.addListener(removeTab);
    function _setScrollPos_bg(tabId) {
        if (tabMessages.hasOwnProperty(tabId)) {
            const message = tabMessages[tabId];
            sendTabMessage(tabId, 0, {
                subject: "setScrollPos",
                scrollLeft: message.scrollLeft,
                scrollTop: message.scrollTop
            });
            delete tabMessages[tabId];
        }
    }

    function sendTabMessage(tabId, frameId, message) {
        const opts = (frameId === -1) ? undefined : {frameId: frameId};
        // use catch to suppress Uncaught (in promise) Error on sending message to unsupported tabs like chrome://
        const p = chrome.tabs.sendMessage(tabId, message, opts);
        if (p) {
            p.catch((e) => {});
        }
    }
    var _lastActiveTabId = null;
    function _tabActivated(tabId) {
        if (_lastActiveTabId !== tabId) {
            if (_lastActiveTabId !== null) {
                sendTabMessage(_lastActiveTabId, 0, {
                    subject: 'tabDeactivated'
                });
            }
            sendTabMessage(tabId, 0, {
                subject: 'tabActivated'
            });
            _lastActiveTabId = tabId;
        }
    }
    chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
        if (changeInfo.status === "complete") {
            if (tab.active) {
                _tabActivated(tabId);
            }
        }
        if (browser.detectTabTitleChange && changeInfo.title) {
            sendTabMessage(tabId, 0, {
                subject: 'titleChanged',
                changeInfo
            });
        }
    });
    chrome.windows.onFocusChanged.addListener(function(w) {
        getActiveTab(function(tab) {
            _tabActivated(tab.id);
        });
    });

    chrome.tabs.onCreated.addListener(function(tab) {
        _updateTabIndices();
    });
    chrome.tabs.onMoved.addListener(function() {
        _updateTabIndices();
    });
    chrome.tabs.onActivated.addListener(function(activeInfo) {
        if (!historyTabAction && activeInfo.tabId != tabHistory[tabHistory.length - 1]) {
            if (tabHistory.length > 10) {
                tabHistory.shift();
            }
            if (tabHistoryIndex != tabHistory.length - 1) {
                tabHistory.splice(tabHistoryIndex + 1, tabHistory.length - 1);
            }
            tabHistory.push(activeInfo.tabId);
            tabHistoryIndex = tabHistory.length - 1;
        }
        tabActivated[activeInfo.tabId] = new Date().getTime();
        _tabActivated(activeInfo.tabId);
        historyTabAction = false;
        chromelikeNewTabPosition = 0;

        _updateTabIndices();
    });
    chrome.tabs.onDetached.addListener(function() {
        _updateTabIndices();
    });
    chrome.tabs.onAttached.addListener(function() {
        _updateTabIndices();
    });

    function getActiveTab(cb) {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            tabs.length > 0 && cb(tabs[0]);
        });
    }
    chrome.commands.onCommand.addListener(function(command) {
        switch (command) {
            case 'restartext':
                chrome.tabs.query({}, function(tabs) {
                    tabs.forEach(function(tab) {
                        chrome.tabs.reload(tab.id);
                    });
                    chrome.runtime.reload();
                });
                break;
            case 'previousTab':
            case 'nextTab':
                getActiveTab(function(tab) {
                    var index = (command === 'previousTab') ? tab.index - 1 : tab.index + 1;
                    chrome.tabs.query({ windowId: tab.windowId }, function(tabs) {
                        index = ((index % tabs.length) + tabs.length) % tabs.length;
                        chrome.tabs.update(tabs[index].id, { active: true });
                    });
                });
                break;
            case 'closeTab':
                getActiveTab(function(tab) {
                    chrome.tabs.remove(tab.id);
                });
                break;
            case 'proxyThis':
                getActiveTab(function(tab) {
                    var host = new URL(tab.url || tab.pendingUrl).host;
                    updateProxy({
                        host: host,
                        operation: "toggle"
                    }, function() {
                        chrome.tabs.reload(tab.id, {
                            bypassCache: true
                        });
                    });
                });
                break;
            default:
                break;
        }
    });

    self.pendingPorts = [];
    function _response(message, sendResponse, result) {
        var idx = self.pendingPorts.indexOf(message);
        if (idx !== -1) {
            self.pendingPorts.splice(idx, 1);
        }
        sendResponse(result);
    }
    function handleMessage(_message, _sender, _sendResponse) {
        if (self.hasOwnProperty(_message.action)) {
            var result = self[_message.action](_message, _sender, _sendResponse);
            if (_message.needResponse) {
                if (result) {
                    _sendResponse(result);
                    _message.needResponse = false;
                } else {
                    self.pendingPorts.push(_message);
                    // An asynchronous response will be sent using sendResponse later.
                }
                return _message.needResponse;
            }
        } else {
            console.log("[unexpected runtime message] " + JSON.stringify(_message));
        }
    }
    chrome.runtime.onMessage.addListener(handleMessage);
    if (isMV3) {
        chrome.runtime.onUserScriptMessage.addListener((m, s, r) => {
            m.fromUserScript = true;
            handleMessage(m, s, r);
        });
        chrome.runtime.onInstalled.addListener((e) => {
            // chrome.userScripts is missing until "Allow User Scripts" is on, which the
            // built-in themes do not need; updateSettings configures the world later
            if (!isUserScriptsAvailable()) {
                return;
            }
            chrome.userScripts.configureWorld({
                csp: 'script-src \'self\' \'unsafe-eval\'',
                messaging: true
            });
        });
    }

    function _updateSettings(diffSettings, afterSet) {
        diffSettings.savedAt = new Date().getTime();
        _save(chrome.storage.local, diffSettings, function() {
            _save(chrome.storage.sync, diffSettings, function() {
                if (chrome.runtime.lastError) {
                    var error = chrome.runtime.lastError.message;
                }
            });
            if (afterSet) {
                afterSet();
            }
        });
    }

    function _broadcastSettings(data) {
        chrome.tabs.query({}, function(tabs) {
            tabs.forEach(function(tab) {
                sendTabMessage(tab.id, -1, {
                    subject: 'settingsUpdated',
                    settings: data
                });
            });
        });
    }

    function _updateAndPostSettings(diffSettings, afterSet) {
        _broadcastSettings(diffSettings);
        _updateSettings(diffSettings, afterSet);
    }

    function _updateTabIndices() {
        if (conf.showTabIndices) {
            chrome.tabs.query({currentWindow: true}, function(tabs) {
                tabs.forEach(function(tab) {
                    sendTabMessage(tab.id, 0, {
                        subject: "tabIndexChange",
                        index: tab.index + 1
                    });
                });
            });
        }
    }

    function getSenderUrl(sender) {
        // use the tab's url if sender is a frame with blank url.
        return (sender.frameId !== 0 && sender.url === "about:blank") ? sender.tab.url : sender.url;
    }
    function _getState(set, url, blocklistPattern, lurkingPattern) {
        if (set.blocklist['.*']) {
            return "disabled";
        }
        if (url) {
            if (set.blocklist[url.origin]) {
                return "disabled";
            }
            if (blocklistPattern) {
                blocklistPattern = new RegExp(blocklistPattern.source, blocklistPattern.flags);
                if (blocklistPattern.test(url.href)) {
                    return "disabled";
                }
            }
            if (lurkingPattern) {
                lurkingPattern = new RegExp(lurkingPattern.source, lurkingPattern.flags);
                if (lurkingPattern.test(url.href)) {
                    return "lurking";
                }
            }
        }
        return "enabled";
    }
    // The web origin `s` names exactly, or null.
    function webOrigin(s) {
        try {
            const url = new URL(s);
            return /^https?:$/.test(url.protocol) && url.origin === s ? s : null;
        } catch (e) {
            return null;
        }
    }
    self.toggleBlocklist = function(message, sender, sendResponse) {
        loadSettings('blocklist', function(data) {
            var origin = ".*";
            var senderOrigin = sender.origin || new URL(getSenderUrl(sender)).origin;
            var fromExtension = chrome.runtime.getURL("/").toLowerCase().indexOf(senderOrigin.toLowerCase()) === 0;
            // Only the extension's own pages (the popup, for the tab it was opened
            // over) may name a site: a content script speaks for its own page, and
            // one naming a site could turn Surfingkeys off on any other. A name that
            // is not a web origin changes nothing, rather than falling back to
            // turning it off everywhere.
            var named = fromExtension && message.origin !== undefined;
            if (!fromExtension && senderOrigin !== "null") {
                origin = senderOrigin;
            } else if (named) {
                origin = webOrigin(message.origin);
                if (!origin) {
                    sendResponse({error: "Not a web origin: " + message.origin, blocklist: data.blocklist});
                    return;
                }
            }
            if (data.blocklist.hasOwnProperty(origin)) {
                delete data.blocklist[origin];
            } else {
                data.blocklist[origin] = 1;
            }
            _updateAndPostSettings({blocklist: data.blocklist}, function() {
                var url = named ? new URL(origin) : (sender.tab ? new URL(getSenderUrl(sender)) : null);
                sendResponse({
                    state: _getState(data, url, message.blocklistPattern, message.lurkingPattern),
                    blocklist: data.blocklist,
                    url: origin
                });
            });
        });
    };
    self.toggleMouseQuery = function(message, sender, sendResponse) {
        loadSettings('mouseSelectToQuery', function(data) {
            if (sender.tab && sender.tab.url.indexOf(chrome.runtime.getURL("/")) !== 0) {
                var mouseSelectToQuery = data.mouseSelectToQuery || [];
                var idx = mouseSelectToQuery.indexOf(message.origin);
                if (idx === -1) {
                    mouseSelectToQuery.push(message.origin);
                } else {
                    mouseSelectToQuery.splice(idx, 1);
                }
                _updateAndPostSettings({mouseSelectToQuery: mouseSelectToQuery});
            }
        });
    };
    self.getState = function(message, sender, sendResponse) {
        loadSettings(['blocklist', 'noPdfViewer', 'proxyMode', 'proxy'], function(data) {
            if (sender.tab) {
                _response(message, sendResponse, {
                    noPdfViewer: data.noPdfViewer,
                    proxyMode: data.proxyMode,
                    proxy: data.proxy,
                    state: _getState(data, new URL(getSenderUrl(sender)), message.blocklistPattern, message.lurkingPattern)
                });
            }
        });
    };

    self.addVIMark = function(message, sender, sendResponse) {
        loadSettings('marks', function(data) {
            extendObject(data.marks, message.mark);
            _updateAndPostSettings({marks: data.marks});
        });
    };
    self.jumpVIMark = function(message, sender, sendResponse) {
        loadSettings("marks", function(data) {
            var marks = data.marks;
            if (marks.hasOwnProperty(message.mark)) {
                var markInfo = marks[message.mark];
                chrome.tabs.query({}, function(tabs) {
                    tabs = tabs.filter(function(t) {
                        return t.url === markInfo.url;
                    });

                    // newTab (<Ctrl-'>) opens a tab even when one shows the mark already;
                    // switching to that tab instead would make it the same as '
                    if (tabs.length === 0 || message.newTab) {
                        markInfo.tab = {
                            tabbed: true,
                            active: true
                        };
                        self.openLink(markInfo, sender, sendResponse);
                    } else {
                        if (markInfo.scrollLeft || markInfo.scrollTop) {
                            tabMessages[tabs[0].id] = {
                                scrollLeft: markInfo.scrollLeft,
                                scrollTop: markInfo.scrollTop
                            };
                        }
                        if (tabs[0].id === sender.tab.id) {
                            _setScrollPos_bg(tabs[0].id);
                        } else {
                            chrome.tabs.update(tabs[0].id, {
                                active: true
                            });
                            // A loaded tab reports no url again, so the queued offset
                            // would wait for its next load: send it now. A discarded or
                            // loading tab gets it when it reports its url (tabURLAccessed).
                            if (!tabs[0].discarded && tabs[0].status === "complete") {
                                _setScrollPos_bg(tabs[0].id);
                            }
                        }
                    }
                });
            }
        });
    };

    function appendNonce(url) {
        if (/https?:\/\//.test(url)) {
            url = url.replace(/\?$/, "");
            let u = new URL(url);
            let con = u.search ? "&" : "?";
            url = `${url}${con}nonce=${new Date().getTime()}`;
        }
        return url;
    }

    // Reads the snippets `localPath` points at, from the native app's file or from a
    // URL. onException always gets a string, because it travels over sendMessage,
    // which turns an Error into an empty object.
    function readSnippets(localPath, onReady, onException) {
        if (localPath === NATIVE_LOCAL_PATH) {
            readNativeSettings(onReady, onException);
        } else {
            request(appendNonce(localPath), onReady, undefined, undefined, function(exp) {
                onException(exp && exp.message ? exp.message : String(exp));
            });
        }
    }

    function _loadSettingsFromUrl(url, cb) {
        readSnippets(url, function(resp) {
            _updateAndPostSettings({localPath: url, snippets: resp});
            registerUserScript(resp, () => {
                cb({status: "Succeeded", snippets: resp});
            });
        }, function (reason) {
            cb({status: "Failed", error: reason});
        });
    };

    self.resetSettings = function(message, sender, sendResponse) {
        chrome.storage.local.clear();
        chrome.storage.sync.clear();
        loadSettings(null, function(data) {
            browser._applyProxySettings(data);
            // The snippet is gone from storage, so the script that runs it goes before
            // the reply: a page opened after the reset must not run the old code.
            registerUserScript(null, () => {
                _response(message, sendResponse, {
                    settings: data
                });
            });
            // paletteTheme and paletteThemePair are cleared too; saying so makes open
            // tabs fall back to the default theme as new tabs do, instead of keeping the old one.
            _broadcastSettings(Object.assign({}, data, {paletteTheme: null, paletteThemePair: null}));
        });
    };
    self.loadSettingsFromUrl = function(message, sender, sendResponse) {
        _loadSettingsFromUrl(message.url, function(status) {
            _response(message, sendResponse, status);
        });
    };
    /*
     * The tabs worth listing, filtered by the caller's query.
     *
     * A tab whose navigation has not committed yet reports no `url` at all -- its
     * destination is in `pendingUrl` -- and it is dropped, because a list a person
     * picks a tab from has nothing to show for it.
     */
    function _filterByTitleOrUrl(tabs, query) {
        tabs = tabs.filter(function(b) {
            return b.url;
        });
        return filterByTitleOrUrl(tabs, query, false);
    }
    self.getRecentlyClosed = function(message, sender, sendResponse) {
        chrome.sessions.getRecentlyClosed({}, function(sessions) {
            var tabs = [];
            for (var i = 0; i < sessions.length; i ++) {
                var s = sessions[i];
                if (s.hasOwnProperty('window')) {
                    tabs = tabs.concat(s.window.tabs);
                } else if (s.hasOwnProperty('tab')) {
                    tabs.push(s.tab);
                }
            }
            tabs = _filterByTitleOrUrl(tabs, message.query);
            _response(message, sendResponse, {
                urls: tabs
            });
        });
    };
    self.getTopSites = function(message, sender, sendResponse) {
        if (chrome.topSites) {
            chrome.topSites.get(function(urls) {
                urls = _filterByTitleOrUrl(urls, message.query);
                _response(message, sendResponse, {
                    urls: urls
                });
            });
        } else {
            _response(message, sendResponse, {
                urls: []
            });
        }
    };


    function _getHistory(text, maxResults, cb, sortByMostUsed) {
        browser.getLatestHistoryItem(text, maxResults, (items) => {
            if (sortByMostUsed) {
                items = items.sort(function(a, b) {
                    return b.visitCount - a.visitCount;
                });
            }
            cb(items);
        });
    }
    self.getAllURLs = function(message, sender, sendResponse) {
        chrome.bookmarks.search(message.query || {}, function(bmItems) {
            var urls = bmItems,
                requestCount = message.maxResults || 100;
            var maxResults = requestCount - urls.length;
            if (maxResults > 0) {
                _getHistory(message.query || "", maxResults,  function(historyItems) {
                    urls = urls.concat(historyItems);
                    _response(message, sendResponse, {
                        urls: urls
                    });
                }, true);
            } else {
                _response(message, sendResponse, {
                    urls: urls.slice(0, requestCount)
                });
            }
        });
    };
    self.getTabs = function(message, sender, sendResponse) {
        var tab = sender.tab;
        var queryInfo = message.queryInfo || {};
        chrome.tabs.query(queryInfo, function(tabs) {
            tabs = _filterByTitleOrUrl(tabs, message.filter);
            if (tabs.length > message.tabsThreshold && conf.tabsMRUOrder) {
                // only remove current tab when tabsMRUOrder is enabled.
                tabs = tabs.filter(function(b) {
                    return b.id !== tab.id;
                });
                tabs.sort(function(x, y) {
                    // Shift tabs without "last access" data to the end
                    var a = x.lastAccessed || tabActivated[x.id];
                    var b = y.lastAccessed || tabActivated[y.id];

                    if (!isFinite(a) && !isFinite(b)) {
                        return 0;
                    }

                    if (!isFinite(a)) {
                        return 1;
                    }

                    if (!isFinite(b)) {
                        return -1;
                    }

                    return b - a;
                });
            }
            _response(message, sendResponse, {
                tabs: tabs
            });
        });
    };
    /*
     * Group the sender's tab: into `groupId` when one is given, else into a new
     * group, answered with the group it ended up in.
     *
     * `chrome.tabGroups` is absent on some browsers (see getTabGroups below), and
     * the browser can refuse to group, so both are reported rather than thrown -- a
     * throw in the background reaches a caller as a timeout it cannot act on.
     */
    self.createTabGroup = function(message, sender, sendResponse) {
        if (!chrome.tabGroups) {
            _response(message, sendResponse, {
                error: "tab groups are not supported by this browser"
            });
            return;
        }
        chrome.tabs.group({tabIds: [sender.tab.id], groupId: message.groupId}, function(groupId) {
            if (chrome.runtime.lastError || groupId === undefined) {
                _response(message, sendResponse, {
                    error: chrome.runtime.lastError ? chrome.runtime.lastError.message : "no group was created"
                });
                return;
            }
            const done = () => _response(message, sendResponse, {
                groupId: groupId
            });
            if (message.title || message.color) {
                chrome.tabGroups.update(groupId, {
                    title: message.title,
                    color: message.color
                }, done);
            } else {
                done();
            }
        });
    };
    self.ungroupTab = function(message, sender, sendResponse) {
        chrome.tabs.ungroup([sender.tab.id]);
    };
    self.collapseGroup = function(message, sender, sendResponse) {
        chrome.tabGroups.update(message.groupId, {collapsed: message.collapsed});
    };
    self.getTabGroups = function(message, sender, sendResponse) {
        chrome.tabGroups.query({}, function(groups) {
            let activeGroup = -1;
            // retrieve all tabs of each group
            chrome.tabs.query({}, function(tabs) {
                const tabsInGroup = {};
                tabs.forEach(function(tab) {
                    if (tab.groupId && tab.groupId !== (chrome.tabGroups?.TAB_GROUP_ID_NONE ?? -1)) {
                        if (!tabsInGroup[tab.groupId]) {
                            tabsInGroup[tab.groupId] = [];
                        }
                        if (tab.id === sender.tab.id) {
                            activeGroup = tab.groupId;
                        }
                        tabsInGroup[tab.groupId].push({
                            id: tab.id,
                            title: tab.title,
                            url: tab.url,
                            favIconUrl: tab.favIconUrl,
                            active: tab.active,
                            index: tab.index
                        });
                    }
                });

                groups = groups.filter((g) => !g.hermit);
                groups.forEach(function(group) {
                    group.tabs = tabsInGroup[group.id] || [];
                    group.active = group.id === activeGroup;
                });

                _response(message, sendResponse, {
                    groups: groups
                });
            });
        });
    };
    self.togglePinTab = function(message, sender, sendResponse) {
        getActiveTab(function(tab) {
            return chrome.tabs.update(tab.id, {
                pinned: !tab.pinned
            });
        });
    };
    self.closeTabByIds = function(message, sender, sendResponse) {
        chrome.tabs.remove(message.tabIds);
    };
    // The tab or its window may have closed since the caller listed it: reading
    // lastError keeps that failure off the extension's error page.
    function ignoreGone() {
        void chrome.runtime.lastError;
    }
    function focusTab(windowId, tabId) {
        chrome.windows.update(windowId, {
            focused: true
        }, function() {
            ignoreGone();
            chrome.tabs.update(tabId, {
                active: true
            }, ignoreGone);
        });
    }
    self.focusTab = function(message, sender, sendResponse) {
        if (message.windowId !== undefined && sender.tab.windowId !== message.windowId) {
            focusTab(message.windowId, message.tabId);
        } else {
            chrome.tabs.update(message.tabId, {
                active: true
            }, ignoreGone);
        }
    };
    self.focusTabByIndex = function(message, sender, sendResponse) {
        var queryInfo = message.queryInfo || {currentWindow: true};
        chrome.tabs.query(queryInfo, function(tabs) {
            if (message.repeats > 0 && message.repeats <= tabs.length) {
                chrome.tabs.update(tabs[message.repeats - 1].id, {
                    active: true
                });
            }
        });
    };
    self.goToLastTab = function(message, sender, sendResponse) {
        if (tabHistory.length > 1) {
            var lastTab = tabHistory[tabHistory.length - 2];
            chrome.tabs.update(lastTab, {
                active: true
            });
        }
    };
    self.historyTab = function(message, sender, sendResponse) {
        if (tabHistory.length > 0) {
            historyTabAction = true;
            if (message.hasOwnProperty("index")) {
                tabHistoryIndex = (parseInt(message.index) + tabHistory.length) % tabHistory.length;
            } else {
                tabHistoryIndex += message.backward ? -1 : 1;
                if (tabHistoryIndex < 0) {
                    tabHistoryIndex = 0;
                } else if (tabHistoryIndex >= tabHistory.length) {
                    tabHistoryIndex = tabHistory.length - 1;
                }
            }
            const tabId = tabHistory[tabHistoryIndex];
            chrome.tabs.update(tabId, {
                active: true
            });
        }
    };
    // limit to between 0 and length
    function _fixTo(to, length) {
        if (to < 0) {
            to = 0;
        } else if (to >= length){
            to = length;
        }
        return to;
    }
    // round base ahead if repeats reaches length
    function _roundBase(base, repeats, length) {
        if (repeats > length - base) {
            base -= repeats - (length - base);
        }
        return base;
    }
    function _nextTab(tab, step) {
        if (tab) {
            chrome.tabs.query({
                windowId: tab.windowId
            }, function(tabs) {
                if (tab.index == 0 && step == -1) {
                    step = tabs.length -1 ;
                } else if (tab.index == tabs.length -1 && step == 1 ) {
                    step = 1 - tabs.length ;
                }
                var to = _fixTo(tab.index + step, tabs.length - 1);
                chrome.tabs.update(tabs[to].id, {
                    active: true
                });
            });
        } else {
            getActiveTab(function(t) {
                _nextTab(t, step);
            });
        }
    }
    self.nextTab = function(message, sender, sendResponse) {
        _nextTab(sender.tab, message.repeats);
    };
    self.previousTab = function(message, sender, sendResponse) {
        _nextTab(sender.tab, -message.repeats);
    };
    function _roundRepeatTabs(tab, repeats, operation) {
        if (tab) {
            chrome.tabs.query({
                windowId: tab.windowId
            }, function(tabs) {
                var tabIds = tabs.map(function(e) {
                    return e.id;
                });
                repeats = _fixTo(repeats, tabs.length);
                var base = _roundBase(tab.index, repeats, tabs.length);
                operation(tabIds.slice(base, base + repeats));
            });
        } else {
            getActiveTab(function(t) {
                _roundRepeatTabs(t, repeats, operation);
            });
        }
    }
    self.reloadTab = function(message, sender, sendResponse) {
        _roundRepeatTabs(sender.tab, message.repeats, function(tabIds) {
            tabIds.forEach(function(tabId) {
                chrome.tabs.reload(tabId, {
                    bypassCache: message.nocache
                });
            });
        });
    };
    self.closeTab = function(message, sender, sendResponse) {
        _roundRepeatTabs(sender.tab, message.repeats, function(tabIds) {
            chrome.tabs.remove(tabIds, function() {
                if ( conf.focusAfterClosed === "left" ) {
                    _nextTab(sender.tab, -1);
                } else if ( conf.focusAfterClosed === "last" ) {
                    self.historyTab({backward: true});
                }
            });
        });
    };

    function _closeTab(s, n) {
        chrome.tabs.query({currentWindow: true}, function(tabs) {
            tabs = tabs.map(function(e) { return e.id; });
            chrome.tabs.remove(tabs.slice(s.tab.index + (n < 0 ? n : 1),
                                          s.tab.index + (n < 0 ? 0 : 1 + n)));
        });
    };

    self.closeTabLeft  = function(message, sender, senderResponse) { _closeTab(sender, -message.repeats);};
    self.closeTabRight = function(message, sender, senderResponse) { _closeTab(sender, message.repeats); };
    self.closeTabsToLeft = function(message, sender, senderResponse) { _closeTab(sender, -sender.tab.index); };
    self.closeTabsToRight = function(message, sender, senderResponse) {
        chrome.tabs.query({currentWindow: true},
                          function(tabs) { _closeTab(sender, tabs.length - sender.tab.index); });
    };
    self.tabOnly = function(message, sender, sendResponse) {
        chrome.tabs.query({currentWindow: true}, function(tabs) {
            tabs = tabs.filter(function(t) {
                return t.id != sender.tab.id && !t.pinned;
            }).map(function(t) { return t.id });
            chrome.tabs.remove(tabs);
        });
    };

    self.closeAudibleTab = function(message, sender, sendResponse) {
        chrome.tabs.query({audible: true}, function(tabs) {
            if (tabs) {
                chrome.tabs.remove(tabs[0].id)
            }
        });
    };
    self.muteTab = function(message, sender, sendResponse) {
        var tab = sender.tab;
        chrome.tabs.update(tab.id, {
            muted: ! tab.mutedInfo.muted
        });
    };
    self.openLast = function(message, sender, sendResponse) {
        if (browser.name === "Safari") {
            chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {command: "reopenLastTab"}, function(response) {
                _response(message, sendResponse, response);
            });
        } else {
            chrome.sessions.restore();
        }
    };
    self.duplicateTab = function(message, sender, sendResponse) {
        chrome.tabs.duplicate(sender.tab.id, function() {
            if (message.active === false) {
                chrome.tabs.update(sender.tab.id, { active: true });
            }
        });
    };
    let previousWindowChoice = -1;
    self.getWindows = function (message, sender, sendResponse) {
        chrome.tabs.query({currentWindow: false}, function(tabs) {
            const windows = {};
            tabs.forEach(t => {
                const tabsInWindow = windows[t.windowId] || [];
                tabsInWindow.push({title: t.title, url: t.url});
                windows[t.windowId] = tabsInWindow;
            });
            _response(message, sendResponse, {
                windows: Object.keys(windows).map(w => {
                    return {
                        id: w,
                        tabs: windows[w],
                        isPreviousChoice: (parseInt(w) === previousWindowChoice)
                    };
                })
            });
        });
    };
    self.moveToWindow = function(message, sender, sendResponse) {
        if (message.windowId === -1) {
            chrome.windows.create({tabId: sender.tab.id});
        } else {
            chrome.tabs.move(sender.tab.id, {windowId: message.windowId, index: -1}, () => {
                focusTab(message.windowId, sender.tab.id);
            });
        }
        previousWindowChoice = message.windowId;
    };
    self.gatherWindows = function(message, sender, sendResponse) {
        const windowId = sender.tab.windowId;
        chrome.tabs.query({currentWindow: false}, function(tabs) {
            tabs.forEach(function(tab) {
                chrome.tabs.move(tab.id, {windowId, index: -1});
            });
        });
    };
    self.gatherTabs = function(message, sender, sendResponse) {
        const windowId = sender.tab.windowId;
        message.tabs.forEach(function(tab) {
            chrome.tabs.move(tab.id, {windowId, index: -1});
        });
    };
    self.getBookmarkFolders = function(message, sender, sendResponse) {
        chrome.bookmarks.getTree(function(tree) {
            bookmarkFolders = [];
            getFolders(tree[0], "");
            _response(message, sendResponse, {
                folders: bookmarkFolders
            });
        });
    };
    self.createBookmark = function(message, sender, sendResponse) {
        removeBookmark(message.page.url, function() {
            createBookmark(message.page, function(ret) {
                _response(message, sendResponse, {
                    bookmark: ret
                });
            });
        });
    };
    function filterBookmarksByQuery(bookmarks, query, caseSensitive) {
        return bookmarks.filter(function(b) {
            var title = b.title, url = b.url;
            if (!caseSensitive) {
                title = title.toLowerCase();
                url = url && url.toLowerCase();
                query = query.toLowerCase();
            }
            return title.indexOf(query) !== -1 || (url && url.indexOf(query) !== -1);
        });
    }
    self.getBookmarks = function(message, sender, sendResponse) {
        if (message.parentId) {
            chrome.bookmarks.getSubTree(message.parentId, function(tree) {
                var bookmarks = tree[0].children;
                if (message.query && message.query.length) {
                    bookmarks = filterBookmarksByQuery(bookmarks, message.query, message.caseSensitive);
                }
                _response(message, sendResponse, {
                    bookmarks: bookmarks
                });
            });
        } else {
            if (message.query && message.query.length) {
                chrome.bookmarks.search(message.query, function(tree) {
                    _response(message, sendResponse, {
                        bookmarks: filterBookmarksByQuery(tree, message.query, message.caseSensitive)
                    });
                });
            } else {
                chrome.bookmarks.getTree(function(tree) {
                    _response(message, sendResponse, {
                        bookmarks: tree[0].children
                    });
                });
            }
        }
    };
    self.getHistory = function(message, sender, sendResponse) {
        _getHistory(message.query || "", message.maxResults || 100, function(tree) {
            _response(message, sendResponse, {
                history: tree
            });
        }, message.sortByMostUsed);
    };
    self.addHistories = function(message, sender, sendResponse) {
        message.history.forEach(h => {
            chrome.history.addUrl({url: h});
        });
    };
    function normalizeURL(url) {
        if (!/^view-source:|^javascript:/.test(url) && /^(?:https?:\/\/)?(?:[^@\/\n]+@)?(?:www\.)?([^:\/\n]+)/im.test(url)) {
            if (/^[\w-]+?:/i.test(url)) {
                url = url;
            } else {
                url = "http://" + url;
            }
        }
        return url;
    }

    function openUrlInNewTab(currentTab, url, message) {
        var newTabPosition;
        if (currentTab) {
            switch (conf.newTabPosition) {
                case 'left':
                    newTabPosition = currentTab.index;
                    break;
                case 'right':
                    newTabPosition = currentTab.index + 1;
                    break;
                case 'first':
                    newTabPosition = 0;
                    break;
                case 'last':
                    break;
                default:
                    newTabPosition = currentTab.index + 1 + chromelikeNewTabPosition;
                    chromelikeNewTabPosition++;
                    break;
            }
        }
        var createProperties = {
            url: url,
            active: message.tab.active,
            index: newTabPosition,
            pinned: message.tab.pinned,
            openerTabId: currentTab.id
        };
        if (message.tab.cookieStoreId) {
            createProperties.cookieStoreId = message.tab.cookieStoreId;
        }
        chrome.tabs.create(createProperties, function(tab) {
            if (message.scrollLeft || message.scrollTop) {
                tabMessages[tab.id] = {
                    scrollLeft: message.scrollLeft,
                    scrollTop: message.scrollTop
                };
            }
        });
    }

    self.openLink = function(message, sender, sendResponse) {
        var url = normalizeURL(message.url);
        if (url.startsWith("javascript:")) {
            sendTabMessage(sender.tab.id, 0, {
                subject: "showBanner",
                message: "JavaScript URLs are not allowed in such operation."
            });
        } else {
            if (message.tab.cookieStoreId) {
                if (browser.name !== "Firefox") {
                    delete message.tab.cookieStoreId;
                } else if (sender.tab && sender.tab.cookieStoreId === message.tab.cookieStoreId) {
                    delete message.tab.cookieStoreId;
                }
            }
            if (message.tab.cookieStoreId) {
                openUrlInNewTab(sender.tab, url, message);
            } else if (message.tab.tabbed) {
                if (sender.frameId !== 0 && chrome.runtime.getURL("pages/frontend.html") === sender.url
                    || !sender.tab) {
                    // if current call was made from Omnibar, the sender.tab may be stale,
                    // as sender was bound when port was created.
                    getActiveTab(function(tab) {
                        openUrlInNewTab(tab, url, message);
                    });
                } else {
                    openUrlInNewTab(sender.tab, url, message);
                }
            } else {
                chrome.tabs.update({
                    url: url,
                    pinned: message.tab.pinned || sender.tab.pinned
                }, function(tab) {
                    if (message.scrollLeft || message.scrollTop) {
                        tabMessages[tab.id] = {
                            scrollLeft: message.scrollLeft,
                            scrollTop: message.scrollTop
                        };
                    }
                });
            }
        }
    };
    self.viewSource = function(message, sender, sendResponse) {
        message.url = 'view-source:' + sender.tab.url;
        self.openLink(message, sender, sendResponse);
    };
    // callback(error): error is the userScripts API's message, or "" when the
    // registered script now matches `snippets`
    function registerUserScript(snippets, callback) {
        if (!isUserScriptsAvailable()) {
            callback && callback("");
            return;
        }
        const userScriptId = "settingsSnippets";
        const lastErrorMessage = () => chrome.runtime.lastError.message || String(chrome.runtime.lastError);
        const invokeCallback = () => {
            let error = "";
            if (chrome.runtime.lastError) {
                console.error("userScripts API error:", chrome.runtime.lastError);
                error = lastErrorMessage();
            }
            callback && callback(error);
        };
        if (snippets) {
            chrome.userScripts.getScripts({ids:[userScriptId]}, (r) => {
                if (chrome.runtime.lastError) {
                    console.error("userScripts.getScripts error:", chrome.runtime.lastError);
                    callback && callback(lastErrorMessage());
                    return;
                }
                // The snippet goes in as a string that api.js compiles inside its
                // try: pasted in as code, a syntax error in it stops this whole script
                // from parsing, so no setting applies and nothing says why.
                const code = `import('./api.js').then((module) => {module.default("${chrome.runtime.getURL("/")}", ${JSON.stringify(snippets)})});`;
                const registerSettingSnippets = () => {
                    // compiling it takes 'unsafe-eval' in the world, which is otherwise
                    // configured only at install and when advanced mode is switched on,
                    // so not when "Allow User Scripts" was turned on in between
                    chrome.userScripts.configureWorld({
                        csp: 'script-src \'self\' \'unsafe-eval\'',
                        messaging: true
                    });
                    chrome.userScripts.register([{
                        allFrames: true,
                        id: userScriptId,
                        matches: ['*://*/*', 'file:///*'],
                        js: [{code}]
                    }], invokeCallback);
                };
                if (r.length > 0) {
                    if (r[0].js[0].code !== code) {
                        chrome.userScripts.unregister({ids:[userScriptId]}, registerSettingSnippets);
                    } else {
                        callback && callback("");
                    }
                } else {
                    registerSettingSnippets();
                }
            });
        } else {
            chrome.userScripts.getScripts({ids:[userScriptId]}, (r) => {
                if (chrome.runtime.lastError) {
                    console.error("userScripts.getScripts error:", chrome.runtime.lastError);
                    callback && callback(lastErrorMessage());
                    return;
                }
                if (r.length > 0) {
                    chrome.userScripts.unregister({ids:[userScriptId]}, invokeCallback);
                } else {
                    callback && callback("");
                }
            });
        }
    }

    function onFullSettingsRequested(data, callback) {
        data.isMV3 = isMV3;
        // `ready`, not `instance`: a pending connection may have no host behind it. A
        // boolean, because a content script receives a promise as a truthy empty
        // object.
        data.useNeovim = !!(browser.nvimServer && browser.nvimServer.ready);
        data.isUserScriptsAvailable = isUserScriptsAvailable();
        if (isMV3) {
            data.showAdvanced = data.isUserScriptsAvailable && data.showAdvanced;
        }

        if (data.isUserScriptsAvailable && data.showAdvanced) {
            registerUserScript(data.snippets, callback);
        } else if (data.isUserScriptsAvailable) {
            registerUserScript(null, callback);
        } else {
            callback && callback();
        }
    }
    // The last error the settings snippet threw in a page, for the settings page,
    // which runs no snippet itself and would otherwise never learn of it. In
    // storage.session where there is one: the worker is stopped between pages.
    const SNIPPETS_ERROR_KEY = 'snippetsError';
    let snippetsError = null;
    self.reportSnippetsError = function(message, sender) {
        const entry = {
            error: String(message.error).slice(0, 1000),
            rev: message.rev,
            url: sender.tab ? sender.tab.url : sender.url,
            at: Date.now(),
        };
        if (chrome.storage.session) {
            chrome.storage.session.set({[SNIPPETS_ERROR_KEY]: entry}, () => void chrome.runtime.lastError);
        } else {
            snippetsError = entry;
        }
    };
    // Only an error from the snippet that is saved now: an older one is fixed.
    function readSnippetsError(snippets, cb) {
        const pick = (entry) => cb(entry && entry.rev === snippetsRevision(snippets)
            ? {error: entry.error, url: entry.url, at: entry.at} : null);
        if (chrome.storage.session) {
            chrome.storage.session.get(SNIPPETS_ERROR_KEY, (r) => pick(!chrome.runtime.lastError && r && r[SNIPPETS_ERROR_KEY]));
        } else {
            pick(snippetsError);
        }
    }
    self.getSettings = function(message, sender, sendResponse) {
        var pf = loadSettings;
        if (message.key === "RAW") {
            pf = browser.loadRawSettings;
            message.key = "";
        }
        pf(message.key, function(data) {
            if (message.key === undefined) {
                onFullSettingsRequested(data);
                // only the settings page shows it: every other frame would wait on
                // storage for it and learn another tab's URL
                const fromOptions = typeof sender.url === "string"
                    && sender.url.split(/[?#]/)[0] === chrome.runtime.getURL("pages/options.html");
                if (fromOptions && data.showAdvanced && data.snippets) {
                    readSnippetsError(data.snippets, (error) => {
                        if (error) {
                            data.snippetsError = error;
                        }
                        _response(message, sendResponse, {
                            settings: data
                        });
                    });
                    return;
                }
            }

            _response(message, sendResponse, {
                settings: data
            });
        });
    };
    function isUserScriptsAvailable() {
        try {
            if (chrome.userScripts) {
                return true;
            }
        } catch {
            return false;
        }
        return false;
    }
    /*
     * Persist a change to the snippet or to advanced mode, then make the registered
     * user script match what is stored, and only then reply. A page loads whatever
     * script is registered when it starts, so a reply sent before this -- or a
     * registration left to the next page's getSettings -- hands the first page
     * opened after "Saved" the old code. A key the change does not carry keeps its
     * stored value: a Save sends only the snippet, the toggle only the mode.
     */
    function _updateAndSyncUserScript(message, sendResponse) {
        const saved = message.settings;
        _updateAndPostSettings(saved, function() {
            // read after the write: with localPath set, the stored snippet is the
            // file's text, and _save has dropped the one in the message
            loadSettings(['showAdvanced', 'snippets'], function(stored) {
                const on = saved.hasOwnProperty('showAdvanced') ? saved.showAdvanced : stored.showAdvanced;
                const snippets = saved.hasOwnProperty('snippets') ? saved.snippets : stored.snippets;
                // stored either way, but a page opened now would not run it
                registerUserScript(on ? snippets : null, (error) => {
                    _response(message, sendResponse, {
                        error: error ? "Saved, but the settings script could not be registered: " + error : ""
                    });
                });
            });
        });
    }
    self.updateSettings = function(message, sender, sendResponse) {
        let error = "";
        if (message.scope === "snippets") {
            // For settings from snippets, don't broadcast the update
            // neither persist into storage
            for (var k in message.settings) {
                if (conf.hasOwnProperty(k)) {
                    conf[k] = message.settings[k];
                }
            }
            return { error };
        } else {
            if (message.settings.showAdvanced && isMV3) {
                if (isUserScriptsAvailable()) {
                    chrome.userScripts.configureWorld({
                        csp: 'script-src \'self\' \'unsafe-eval\'',
                        messaging: true
                    });
                    _updateAndSyncUserScript(message, sendResponse);
                    return;
                } else {
                    error = "Advanced mode is only available when Developer mode is turned on from chrome://extensions/.";
                }
            } else if (isMV3 && isUserScriptsAvailable()
                && (message.settings.hasOwnProperty('snippets') || message.settings.hasOwnProperty('showAdvanced'))) {
                _updateAndSyncUserScript(message, sendResponse);
                return;
            } else {
                _updateAndPostSettings(message.settings);
            }
        }
        return { error };
    };
    self.updateInputHistory = function(message, sender, sendResponse) {
        let key = undefined, value;
        for (var k in message) {
            key = k + "History";
            value = message[k];
            break;
        }
        if (key) {
            loadSettings(key, function(data) {
                let curr = data[key] || [];
                let toUpdate = {};
                if (value.constructor.name === "Array") {
                    toUpdate[key] = value;
                    _updateAndPostSettings(toUpdate);
                } else if (value.trim().length && value !== ".") {
                    curr = curr.filter(function(c) {
                        return c.trim().length && c !== value && c !== ".";
                    });
                    curr.unshift(value);
                    if (curr.length > 50) {
                        curr.pop();
                    }
                    toUpdate[key] = curr;
                    _updateAndPostSettings(toUpdate);
                }
                _response(message, sendResponse, {
                    history: curr
                });
            });
        }
    };
    self.setSurfingkeysIcon = function(message, sender, sendResponse) {
        const tabId = sender.tab ? sender.tab.id : undefined;
        // Only touch the icon API when the per-tab state actually changed;
        // every page load reports the state again, most often the same one.
        if (tabId !== undefined && tabIconStatus[tabId] === message.status) {
            return;
        }
        let icon = "icons/48.png";
        if (message.status === "disabled") {
            icon = "icons/48-x.png";
        } else if (message.status === "lurking") {
            icon = "icons/48-l.png";
        }
        const browserAction = isMV3 ? chrome.action : chrome.browserAction;
        browserAction.setIcon({
            path: icon,
            tabId: tabId
        });
        if (tabId !== undefined) {
            tabIconStatus[tabId] = message.status;
        }
    };
    self.request = function(message, sender, sendResponse) {
        request(message.url, function(res) {
            _response(message, sendResponse, {
                text: res
            });
        }, message.headers, message.data, (e) => {
            _response(message, sendResponse, {
                error: e.toString()
            });
        });
    };
    self.requestImage = function(message, sender, sendResponse) {
        fetch(message.url, {
            method: "GET"
        }).then(res => {
            return res.blob()
        }).then(blob => {
            return createImageBitmap(blob)
        }).then(img => {
            const canvas = new OffscreenCanvas(img.width, img.height)
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0,0, canvas.width, canvas.height);
            canvas.convertToBlob().then(blob => {
                const fr = new FileReader();
                fr.onload = function(e) {
                    _response(message, sendResponse, {
                        text: e.target.result
                    });
                }
                fr.readAsDataURL(blob);
            });
        }).catch(exp => {
            _response(message, sendResponse, {
                text: ""
            });
        });
    };
    self.nextFrame = function(message, sender, sendResponse) {
        const tid = sender.tab.id;
        chrome.scripting.executeScript({
            target: {
                allFrames: true,
                tabId: tid,
            },
            func: () => {
                return typeof(getFrameId) === 'function' ? getFrameId() : 0;
            },
        }, function(framesInTab) {
            framesInTab = framesInTab.map((res) => {
                return res.result;
            }).filter((frameId) => {
                return frameId;
            });

            if (framesInTab.length > 0) {
                let i = 0;
                for (i = 0; i < framesInTab.length; i++) {
                    if (framesInTab[i] === message.frameId) {
                        break;
                    }
                }
                i = (i === framesInTab.length - 1) ? 0 : i + 1;
                sendTabMessage(tid, -1, {
                    subject: "focusFrame",
                    frameId: framesInTab[i]
                });
            }
        });
    };
    self.moveTab = function(message, sender, sendResponse) {
        chrome.tabs.query({
            windowId: sender.tab.windowId
        }, function(tabs) {
            var to = _fixTo(sender.tab.index + message.step * message.repeats, tabs.length);
            chrome.tabs.move(sender.tab.id, {
                index: to
            });
        });
    };
    function _quit() {
        chrome.windows.getAll({
            populate: false
        }, function(windows) {
            windows.forEach(function(w) {
                chrome.windows.remove(w.id);
            });
        });
    }
    self.quit = function(message, sender, sendResponse) {
        _quit();
    };
    // Surfingkeys' new tab page (pages/newtab.html, with any query or fragment)
    // is a new tab as much as the browser's: a session neither saves it nor leaves
    // it open when restored. Matching the browser's address alone misses it, since
    // the page goes on to itself with ?focus at once (README: "New tab page") and
    // the tab then reports that address.
    const newTabPage = chrome.runtime.getURL("/pages/newtab.html");
    function isNewTab(url) {
        return url === newTabUrl || (typeof url === "string" && url.replace(/[?#].*$/, "") === newTabPage);
    }
    self.createSession = function(message, sender, sendResponse) {
        loadSettings('sessions', function(data) {
            chrome.tabs.query({}, function(tabs) {
                var tabGroup = {};
                tabs.forEach(function(tab) {
                    if (tab && tab.index !== void 0) {
                        if (!tabGroup.hasOwnProperty(tab.windowId)) {
                            tabGroup[tab.windowId] = [];
                        }
                        if (!isNewTab(tab.url)) {
                            tabGroup[tab.windowId].push(tab.url);
                        }
                    }
                });
                var tabg = [];
                for (var k in tabGroup) {
                    if (tabGroup[k].length) {
                        tabg.push(tabGroup[k]);
                    }
                }
                data.sessions[message.name] = {};
                data.sessions[message.name]['tabs'] = tabg;
                _updateAndPostSettings({
                    sessions: data.sessions
                }, (message.quitAfterSaved ? _quit : undefined));
            });
        });
    };
    self.openSession = function(message, sender, sendResponse) {
        loadSettings('sessions', function(data) {
            if (data.sessions.hasOwnProperty(message.name)) {
                var urls = data.sessions[message.name]['tabs'];
                urls[0].forEach(function(url) {
                    chrome.tabs.create({
                        url: url,
                        active: false,
                        pinned: false
                    });
                });
                for (var i = 1; i < urls.length; i++) {
                    var a = urls[i];
                    chrome.windows.create({}, function(win) {
                        a.forEach(function(url) {
                            chrome.tabs.create({
                                windowId: win.id,
                                url: url,
                                active: false,
                                pinned: false
                            });
                        });
                    });
                }
                chrome.tabs.query({}, function(tabs) {
                    chrome.tabs.remove(tabs.filter(function(t) {
                        return isNewTab(t.url);
                    }).map(function(t) {
                        return t.id;
                    }));
                });
            }
        });
    };
    self.deleteSession = function(message, sender, sendResponse) {
        loadSettings('sessions', function(data) {
            delete data.sessions[message.name];
            _updateAndPostSettings({
                sessions: data.sessions
            });
        });
    };
    self.closeDownloadsShelf = function(message, sender, sendResponse) {
        if (message.clearHistory) {
            chrome.downloads.erase({"urlRegex": ".*"});
        } else {
            chrome.downloads.setShelfEnabled(false);
            chrome.downloads.setShelfEnabled(true);
        }
    };
    self.getDownloads = function(message, sender, sendResponse) {
        chrome.downloads.search(message.query, function(items) {
            _response(message, sendResponse, {
                downloads: items
            });
        });
    };
    self.download = function(message, sender, sendResponse) {
        chrome.downloads.download({
            url: message.url,
            filename: message.filename,
            saveAs: message.saveAs
        });
    };
    self.tabURLAccessed = function(message, sender, sendResponse) {
        if (sender.tab) {
            var tabId = sender.tab.id;
            _setScrollPos_bg(tabId);
            if (!tabURLs.hasOwnProperty(tabId)) {
                tabURLs[tabId] = {};
            }
            tabURLs[tabId][message.url] = message.title;
            return {
                active: sender.tab.active,
                index: conf.showTabIndices ? sender.tab.index + 1 : 0
            };
        } else {
            return {};
        }
    };
    self.getTabURLs = function(message, sender, sendResponse) {
        var tabURL = tabURLs[sender.tab.id] || {};
        tabURL = Object.keys(tabURL).map(function(u) {
            return {
                url: u,
                title: tabURL[u]
            };
        });
        return {
            urls: tabURL
        };
    };
    self.getTopURL = function(message, sender, sendResponse) {
        return {
            url: sender.tab ? sender.tab.url : ""
        };
    };

    function updateProxy(message, cb) {
        loadSettings(['proxyMode', 'proxy', 'autoproxy_hosts'], function(proxyConf) {
            if (message.operation === "deleteProxyPair") {
                proxyConf.proxy.splice(message.number, 1);
                proxyConf.autoproxy_hosts.splice(message.number, 1);
            } else if (message.operation === "set") {
                proxyConf.proxyMode = message.mode;
                proxyConf.proxy = message.proxy;
                proxyConf.autoproxy_hosts = message.host;
            } else {
                if (message.mode) {
                    proxyConf.proxyMode = message.mode;
                }
                if (!message.number) {
                    message.number = 0;
                }
                if (message.proxy) {
                    proxyConf.proxy[message.number] = message.proxy;
                    if (proxyConf.autoproxy_hosts.length <= message.number) {
                        proxyConf.autoproxy_hosts[message.number] = [];
                    }
                }
                if (message.host) {
                    var hostsDict = dictFromArray(proxyConf.autoproxy_hosts[message.number], 1);
                    var hosts = message.host.split(/\s*[ ,\n]\s*/);
                    if (message.operation === "toggle") {
                        hosts.forEach(function(host) {
                            if (hostsDict.hasOwnProperty(host)) {
                                delete hostsDict[host];
                            } else {
                                hostsDict[host] = 1;
                            }
                        });
                    } else if (message.operation === "add") {
                        hosts.forEach(function(host) {
                            hostsDict[host] = 1;
                        });
                    } else {
                        hosts.forEach(function(host) {
                            delete hostsDict[host];
                        });
                    }
                    proxyConf.autoproxy_hosts[message.number] = Object.keys(hostsDict);
                }
            }
            var diffSet = {
                autoproxy_hosts: proxyConf.autoproxy_hosts,
                proxyMode: proxyConf.proxyMode,
                proxy: proxyConf.proxy
            };
            _updateAndPostSettings(diffSet);
            browser._applyProxySettings(proxyConf);
            cb && cb(diffSet);
        });
    }
    self.updateProxy = function(message, sender, sendResponse) {
        updateProxy(message, function(diffSet) {
            _response(message, sendResponse, diffSet);
        });
    };
    self.setZoom = function(message, sender, sendResponse) {
        var tabId = sender.tab.id;
        var zoomFactor = message.zoomFactor * message.repeats;
        if (zoomFactor == 0) {
            chrome.tabs.getZoomSettings(tabId, function(settings) {
                const defaultZoom = settings.defaultZoomFactor ?
                    settings.defaultZoomFactor : 1;
                chrome.tabs.setZoom(tabId, defaultZoom);
            });
        } else {
            chrome.tabs.getZoom(tabId, function(zf) {
                chrome.tabs.setZoom(tabId, zf + zoomFactor);
            });
        }
    };
    function _removeURL(uid, cb) {
        var type = uid[0], uid = uid.substr(1);
        if (type === 'B') {
            chrome.bookmarks.remove(uid, cb);
        } else if (type === 'H') {
            chrome.history.deleteUrl({url: uid}, cb);
        } else if (type === 'T') {
            uid = uid.split(":").map(function(u) {
                return parseInt(u);
            });
            chrome.windows.update(uid[0], {
                focused: true
            }, function() {
                chrome.tabs.remove(uid[1], cb);
            });
        } else if (type === 'M') {
            loadSettings('marks', function(data) {
                delete data.marks[uid];
                _updateAndPostSettings({marks: data.marks}, cb);
            });
        }
    }
    self.removeURL = function(message, sender, sendResponse) {
        var removed = 0,
            totalToRemoved = message.uid.length,
            uid = message.uid;
        if (typeof(message.uid) === "string") {
            totalToRemoved = 1;
            uid = [ message.uid ];
        }
        function _done() {
            removed ++;
            if (removed === totalToRemoved) {
                _response(message, sendResponse, {
                    response: "Done"
                });
            }
        }
        uid.forEach(function(u) {
            _removeURL(u, _done);
        });

    };
    self.localData = function(message, sender, sendResponse) {
        if (message.data.constructor === Object) {
            chrome.storage.local.set(message.data, function() {
            });
            // broadcast the change also, such as lastKeys
            // we would set lastKeys in sync to avoid breaching chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE
            _broadcastSettings(message.data);
        } else {
            // string or array of string keys
            chrome.storage.local.get(message.data, function(data) {
                _response(message, sendResponse, {
                    data: data
                });
            });
        }
    };
    self.captureVisibleTab = function(message, sender, sendResponse) {
        chrome.tabs.captureVisibleTab(null, {format: "png"}, function(dataUrl) {
            _response(message, sendResponse, {
                dataUrl: dataUrl
            });
        });
    };
    self.getCaptureSize = function(message, sender, sendResponse) {
        chrome.tabs.captureVisibleTab(null, {format: "png"}, function(dataUrl) {
            fetch(dataUrl)
                .then(function(res) {
                    return res.blob();
                })
                .then(function(blob) {
                    return createImageBitmap(blob);
                })
                .then(function(img) {
                    _response(message, sendResponse, {
                        width: img.width,
                        height: img.height
                    });
                });
        });
    };
    self.deleteHistoryOlderThan = function(message, sender, sendResponse) {
        var days = message.days || 0, hours = message.hours || 0;
        chrome.history.deleteRange({
            startTime: 0,
            endTime: new Date().getTime() - (days * 86400 + hours * 3600) * 1000
        }, function() {
        });
    };
    function removeBookmark(url, cb) {
        chrome.bookmarks.search({
            url: url
        }, function(bookmarks) {
            bookmarks.forEach(function(b) {
                chrome.bookmarks.remove(b.id);
            });
            cb && cb();
        });
    }
    self.removeBookmark = function(message, sender, sendResponse) {
        removeBookmark(sender.tab.url);
    };
    self.getBookmark = function(message, sender, sendResponse) {
        chrome.bookmarks.search({
            url: sender.tab.url
        }, function(bookmarks) {
            _response(message, sendResponse, {
                bookmarks: bookmarks
            });
        });
    };

    var _queueURLs = [];
    self.queueURLs = function(message, sender, sendResponse) {
        _queueURLs = _queueURLs.concat(message.urls);
    };
    self.getQueueURLs = function(message, sender, sendResponse) {
        return {
            queueURLs: _queueURLs
        };
    };
    self.clearQueueURLs = function(message, sender, sendResponse) {
        _queueURLs = [];
    };

    self.getVoices = function(message, sender, sendResponse) {
        chrome.tts.getVoices(function(voices) {
            _response(message, sendResponse, {
                voices: voices
            });
        });
    };

    self.read = function(message, sender, sendResponse) {
        var options = message.options || {};
        options.onEvent = function(ttsEvent) {
            // https://developer.chrome.com/docs/extensions/mv2/messaging/
            // If multiple pages are listening for onMessage events, only the first to call sendResponse()
            // for a particular event will succeed in sending the response. All other responses to that event will be ignored.
            //
            // Thus for the later events after `start` we will send them in sendTabMessage.
            if (ttsEvent.type === "start") {
                _response(message, sendResponse, {
                    ttsEvent: ttsEvent
                });
            } else {
                sendTabMessage(sender.tab.id, -1, {
                    subject: 'onTtsEvent',
                    ttsEvent: ttsEvent
                });
            }
        };
        chrome.tts.speak(message.content, options);
    };
    self.stopReading = function(message, sender, sendResponse) {
        chrome.tts.stop();
    };

    self.openIncognito = function(message, sender, sendResponse) {
        chrome.windows.create({"url": message.url, "incognito": true});
    };

    // The browser's profiles for the Profiles omnibar (ui/profileMenu.js), and the
    // switch to one. Both answer on every path: the menu shows the error it is handed.
    function chromiumOnly(message, sendResponse, what = "switching profiles") {
        if (browser.name === "Chrome") {
            return false;
        }
        _response(message, sendResponse, {error: `${what} needs a Chromium-based browser`, kind: "browser"});
        return true;
    }
    self.getProfiles = function(message, sender, sendResponse) {
        if (chromiumOnly(message, sendResponse)) {
            return;
        }
        askProfileHost({command: "Profile.list"}, NATIVE_PROFILES_TIMEOUT, function(reply) {
            if (reply.error) {
                _response(message, sendResponse, reply);
            } else {
                const profiles = Array.isArray(reply.data) ? reply.data : [];
                _response(message, sendResponse, {
                    profiles: profiles.filter((p) => p && typeof p.dir === "string").map((p) => ({
                        dir: p.dir,
                        name: typeof p.name === "string" && p.name ? p.name : p.dir,
                        email: typeof p.email === "string" ? p.email : "",
                    })),
                });
            }
        });
    };
    // Opens Surfingkeys' start page in profile `message.profile`: in that profile's last
    // active window, which comes forward, or a new one when it has none.
    //
    // The page, because the browser opens a tab in an EXISTING window only for a URL it
    // accepts from a command line: chrome://newtab is dropped there, and with no URL it
    // always makes a new window. Its address comes from the running extension, as the
    // store build's id differs from the unpacked one. `?focus` is the marker the page
    // moves itself to, to take keyboard focus from the address bar; arriving with it,
    // the page does not move again.
    self.openProfile = function(message, sender, sendResponse) {
        if (chromiumOnly(message, sendResponse)) {
            return;
        }
        if (typeof message.profile !== "string" || !message.profile) {
            _response(message, sendResponse, {error: "no profile was named"});
            return;
        }
        askProfileHost({
            command: "Profile.open",
            profile: message.profile,
            url: chrome.runtime.getURL("pages/newtab.html?focus"),
        }, NATIVE_OPEN_PROFILE_TIMEOUT, function(reply) {
            _response(message, sendResponse, reply.error ? reply : {profile: message.profile});
        });
    };

    // The open tabs of the browser's other profiles, for the palette (ui/palette.js):
    // {peers: [{peer, profile: {dir, name} | null, tabs, error?}]}, or {error, kind}.
    // A private window's palette gets none, as it gets no history or bookmarks either.
    self.getPeerTabs = function(message, sender, sendResponse) {
        if (chromiumOnly(message, sendResponse, "listing the other profiles' tabs")) {
            return;
        }
        if (sender.tab && sender.tab.incognito) {
            _response(message, sendResponse, {peers: []});
            return;
        }
        askProfileHost({command: "Peers.tabs"}, NATIVE_PEER_TABS_TIMEOUT, function(reply) {
            if (reply.error) {
                _response(message, sendResponse, reply);
                return;
            }
            const peers = reply.data && Array.isArray(reply.data.peers) ? reply.data.peers : [];
            _response(message, sendResponse, {peers: peers.filter((p) => p && Number.isInteger(p.peer) && Array.isArray(p.tabs)).map((p) => {
                const profile = p.profile && typeof p.profile.dir === "string"
                    ? {dir: p.profile.dir, name: typeof p.profile.name === "string" && p.profile.name ? p.profile.name : p.profile.dir}
                    : null;
                const tabs = p.tabs.filter((t) => t && Number.isInteger(t.id) && Number.isInteger(t.windowId) && typeof t.url === "string")
                    .map((t) => ({
                        id: t.id,
                        windowId: t.windowId,
                        title: typeof t.title === "string" ? t.title : "",
                        url: t.url,
                        favIconUrl: typeof t.favIconUrl === "string" ? t.favIconUrl : "",
                    }));
                return typeof p.error === "string" ? {peer: p.peer, profile, tabs, error: p.error} : {peer: p.peer, profile, tabs};
            })});
        }, "this server.lua cannot list the other profiles' tabs yet, update it");
    };
    // Switches to tab `message.tabId` of the profile whose host is `message.peer`:
    // {tab: what that profile observed}, or {error} saying why not.
    self.activatePeerTab = function(message, sender, sendResponse) {
        if (chromiumOnly(message, sendResponse, "switching to another profile's tab")) {
            return;
        }
        if (sender.tab && sender.tab.incognito) {
            _response(message, sendResponse, {error: "not from a private window"});
            return;
        }
        if (!Number.isInteger(message.peer) || !Number.isInteger(message.tabId)) {
            _response(message, sendResponse, {error: "no tab was named"});
            return;
        }
        const ask = {command: "Peers.activate", peer: message.peer, tabId: message.tabId};
        if (Number.isInteger(message.windowId)) {
            ask.windowId = message.windowId;
        }
        askProfileHost(ask, NATIVE_PEER_ACTIVATE_TIMEOUT, function(reply) {
            _response(message, sendResponse, reply.error ? reply : {tab: reply.data});
        }, "this server.lua cannot switch to another profile's tab yet, update it");
    };

    // What the native host asks of THIS profile, for another profile's palette. Never a
    // private window's tabs: the palette that lists them is not private.
    //
    // Titles and URLs are cut to a size, and an address longer than that is left out
    // rather than cut: the host hands every profile's tabs over in one message of at
    // most 1 MB, and a cut address would be copied or matched as if it were the real one.
    const PEER_TITLE_MAX = 300;
    const PEER_URL_MAX = 8192;
    const PEER_ICON_MAX = 1024;
    function wellFormed(text) {
        // a title cut inside a surrogate pair is no longer valid UTF-16
        return typeof text.toWellFormed === "function" ? text.toWellFormed() : text;
    }
    function shareableTabs(tabs) {
        return (tabs || []).filter((t) => t && !t.incognito).map((t) => {
            const tab = {
                id: t.id,
                windowId: t.windowId,
                title: wellFormed(String(t.title || "").slice(0, PEER_TITLE_MAX)),
                url: String(t.url || t.pendingUrl || ""),
            };
            if (typeof t.favIconUrl === "string" && /^https?:/.test(t.favIconUrl) && t.favIconUrl.length <= PEER_ICON_MAX) {
                tab.favIconUrl = t.favIconUrl;
            }
            return tab;
        }).filter((t) => t.url.length <= PEER_URL_MAX);
    }
    // Most recently used first, as this profile's own palette orders them.
    function tabsForPeer() {
        return new Promise((resolve) => {
            if (typeof self.tabSwitcherTabs === "function") {
                self.tabSwitcherTabs({needResponse: true}, {}, (resp) => {
                    resolve({data: {tabs: shareableTabs(resp && resp.tabs)}});
                });
                return;
            }
            chrome.tabs.query({}, (tabs) => {
                if (chrome.runtime.lastError) {
                    resolve({error: chrome.runtime.lastError.message});
                    return;
                }
                const recent = (tabs || []).slice().sort((x, y) => (y.lastAccessed || 0) - (x.lastAccessed || 0));
                resolve({data: {tabs: shareableTabs(recent)}});
            });
        });
    }
    // Brings tab `request.tabId` forward, and reports what it observes afterwards. The
    // id comes from another process: one this profile has no tab for is refused, never
    // passed on. The tab's window is read anew, since it may have moved since it was
    // listed.
    function activateForPeer(request) {
        return new Promise((resolve) => {
            if (!Number.isInteger(request.tabId)) {
                resolve({error: "no tab was named"});
                return;
            }
            chrome.tabs.get(request.tabId, (tab) => {
                if (chrome.runtime.lastError || !tab || tab.incognito) {
                    resolve({error: "that tab is no longer open"});
                    return;
                }
                chrome.tabs.update(tab.id, {active: true}, () => {
                    void chrome.runtime.lastError;
                    chrome.windows.update(tab.windowId, {focused: true}, () => {
                        void chrome.runtime.lastError;
                        chrome.tabs.get(tab.id, (after) => {
                            if (chrome.runtime.lastError || !after) {
                                resolve({error: "that tab closed as it was being switched to"});
                                return;
                            }
                            chrome.windows.get(after.windowId, (win) => {
                                const focused = !chrome.runtime.lastError && !!(win && win.focused);
                                resolve(after.active
                                    ? {data: {tabId: after.id, windowId: after.windowId, active: true, focused}}
                                    : {error: "the browser did not switch to that tab"});
                            });
                        });
                    });
                });
            });
        });
    }
    // The host cannot tell which profile it serves, and this extension does not know the
    // name of its profile's folder either. So it writes a fresh random token to its own
    // storage, and the host finds the profile folder holding it (server.lua's
    // Profile.identify): once each time a host connects, and when the host asks.
    //
    // The token lives in LOCAL storage only, and only until the host has looked: it is no
    // setting. Settings are copied between local and sync storage while it is there --
    // a page loading reads them -- and _save leaves it out of both directions, since
    // nothing here removes a copy that reaches sync storage.
    let identifying = false;
    function identifyToHost() {
        if (identifying) {
            return;
        }
        identifying = true;
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
        chrome.storage.local.set({[PROFILE_TOKEN_KEY]: token}, () => {
            if (chrome.runtime.lastError) {
                identifying = false;
                return;
            }
            askProfileHost({command: "Profile.identify", token, extensionId: chrome.runtime.id}, NATIVE_IDENTIFY_TIMEOUT, () => {
                identifying = false;
                chrome.storage.local.remove(PROFILE_TOKEN_KEY, () => void chrome.runtime.lastError);
            });
        });
    }
    if (browser.name === "Chrome" && nativeHost && nativeHost.answer && nativeHost.onConnect) {
        nativeHost.answer({
            "Tabs.list": tabsForPeer,
            "Tabs.activate": activateForPeer,
            "Profile.identify": function() {
                identifyToHost();
                return {data: true};
            },
        });
        nativeHost.onConnect(identifyToHost);
    }

    var userAgent;
    function onBeforeSendHeaders(details) {
        for (var i = 0; i < details.requestHeaders.length; ++i) {
            if (details.requestHeaders[i].name === 'User-Agent') {
                details.requestHeaders[i].value = userAgent;
                break;
            }
        }
        return {requestHeaders: details.requestHeaders};
    }

    // Safari writes through the native app, which sets the system pasteboard
    // directly, rather than through navigator.clipboard.writeText here: that call
    // runs in the background page, which by the time this message arrives has none
    // of the user activation the original keypress had, and WebKit enforces that
    // requirement strictly enough that the write fails unpredictably. Firefox's
    // background page is not held to that, so it keeps the direct call.
    //
    // Native contract: {command: "Clipboard.write", text}, answered with {} on
    // success or {error} on failure
    self.writeClipboard = function (message, sender, sendResponse) {
        if (browser.name === "Safari") {
            chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {command: "Clipboard.write", text: message.text}, function(response) {
                if (chrome.runtime.lastError) {
                    _response(message, sendResponse, {error: chrome.runtime.lastError.message});
                    return;
                }
                _response(message, sendResponse, response);
            });
        } else {
            navigator.clipboard.writeText(message.text).then(
                () => _response(message, sendResponse, {}),
                (err) => _response(message, sendResponse, {error: err && err.message ? err.message : String(err)})
            );
        }
    };
    self.readClipboard = function (message, sender, sendResponse) {
        // only for Safari
        chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {command: "Clipboard.read"}, function(response) {
            _response(message, sendResponse, response);
        });
    };

    self.getContainerName = browser._getContainerName(self, _response);
    self.getContainers = browser._getContainers ? browser._getContainers(self, _response) : function(message, sender, sendResponse) {
        _response(message, sendResponse, { containers: [] });
    };
    chrome.runtime.setUninstallURL("http://brookhong.github.io/2018/01/30/why-did-you-uninstall-surfingkeys.html");

    self.connectNative = function (message, sender, sendResponse) {
        if (browser.nvimServer && browser.nvimServer.instance) {
            browser.nvimServer.instance.then(({url, nm}) => {
                nm.postMessage({
                    mode: message.mode
                });
                _response(message, sendResponse, {
                    url,
                });
            }).catch((error) => {
                neovimUnavailable(error && error.message);
            });
        } else {
            // No instance means the host could not be started (see nvim.js).
            neovimUnavailable(browser.nvimServer && browser.nvimServer.failure);
        }
        // Every path answers: without an answer the neovim page waits forever and
        // stays blank.
        function neovimUnavailable(failure) {
            const reason = (failure || "the native messaging host is not installed")
                .replace(/\.$/, "")
                .replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]);
            _response(message, sendResponse, {
                error: `<p>Neovim is not available: ${reason}.</p>`
                    + `<p>It needs <code>nvim</code> and Surfingkeys' native messaging host installed for this browser;`
                    + ` see <a href="https://github.com/brookhong/Surfingkeys/blob/master/src/nvim/server/Readme.md" target="_blank">src/nvim/server/Readme.md</a>.</p>`,
            });
        }
    };
    /*
     * What a tab's frontend asks of the page it sits on (a theme pick, a palette
     * action), handed to that page's top frame (front.js). Only the frontend may
     * ask: these write settings, and the frontend's usual way to the page,
     * postMessage, is open to the page itself.
     */
    self.frontendRequest = function(message, sender) {
        if (sender.tab && chrome.runtime.getURL("pages/frontend.html") === sender.url) {
            sendTabMessage(sender.tab.id, 0, {
                subject: 'frontendRequest',
                request: message.request,
                name: message.name
            });
        }
    };
    browser.extendBackground && browser.extendBackground(self, _response);
}

export {
    _save,
    dictFromArray,
    extendObject,
    getSubSettings,
    start
};
