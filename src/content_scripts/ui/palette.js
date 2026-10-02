// Command Palette, modelled on Arc's Command Bar: one flat list, with one heading
// per other browser profile.
//
// Empty input: recently used tabs, the current one left out, so Enter goes back
// to the previous tab. Typing: matching tabs, then history and bookmark pages,
// then "Open URL" when the input looks like one, then a web search, then the
// search engine's suggestions. Tab on an empty input lists actions instead.
//
// On Chromium, the tabs of the browser's other open profiles follow this profile's,
// under a heading naming each profile. They come from the native host, after this
// profile's tabs are shown; picking one brings that profile's window forward.
//
// Nothing here that acts is reachable over window.postMessage, which the page can
// post to like any content script: typed-ahead keys come over chrome.runtime, and
// actions that belong to the page (a blocklist toggle, its key mappings) go to it
// the same way (frontendRequest).
import { RUNTIME, runtime } from '../common/runtime.js';
import {
    attachFaviconToImgSrc,
    constructSearchURL,
    createElementWithContent,
    getBrowserName,
    htmlEncode,
} from '../common/utils.js';
import KeyboardUtils from '../common/keyboardUtils';

const EMPTY_TABS = 8;
const MAX_TABS = 5;
const MAX_PAGES = 3;
const MAX_SUGGESTIONS = 3;
const HISTORY_SNAPSHOT = 1000;  // filtered locally on every keystroke, no round trip
const EARLY_TYPE_AHEAD_MS = 1000;

function hostOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
        return '';
    }
}

// "ke hoach" finds "Kế hoạch": compare without diacritics (đ does not decompose).
function fold(s) {
    return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Same page whatever the scheme, "www.", trailing slash or #fragment.
function pageKey(url) {
    try {
        const u = new URL(url);
        return u.hostname.toLowerCase().replace(/^www\./, '') + u.pathname.replace(/\/$/, '') + u.search;
    } catch (e) {
        return url;
    }
}

// "host/path", cut in the middle when long: the end of a path is what tells pages apart.
function shortPath(url) {
    let text;
    try {
        const u = new URL(url);
        text = u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname) + u.search;
    } catch (e) {
        text = url;
    }
    if (text.length <= 48) {
        return text;
    }
    const head = text.slice(0, text.indexOf('/', text.indexOf('/') + 1) + 1 || 24);
    return head.slice(0, 30) + '…' + text.slice(-16);
}

// Alias prompts are "name<separator>" until the engine's favicon arrives, then
// an <img alt="name">.
function engineName(alias) {
    const prompt = (alias && alias.prompt) || '';
    const m = prompt.match(/alt="([^"]*)"/) || prompt.match(/^([^<]*)/);
    const name = (m && m[1]) || 'the web';
    return name.charAt(0).toUpperCase() + name.slice(1);
}

function el(tag, className, text) {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) {
        e.textContent = text;
    }
    return e;
}

// Highlight on the raw title, then escape each piece: highlighting the escaped
// title would match inside "&amp;" and show "AT&amp;T".
function highlight(rxp, text) {
    if (!rxp) {
        return htmlEncode(text);
    }
    let out = '', last = 0;
    text.replace(rxp, (m, offset) => {
        out += htmlEncode(text.slice(last, offset)) + '<span class="omnibar_highlight">' + htmlEncode(m) + '</span>';
        last = offset + m.length;
        return m;
    });
    return out + htmlEncode(text.slice(last));
}

// Every term must match somewhere; a title start beats a title hit beats the host beats the URL.
function score(item, terms) {
    let total = 0;
    for (const term of terms) {
        if (item.fTitle.startsWith(term)) {
            total += 4;
        } else if (item.fTitle.includes(term)) {
            total += 3;
        } else if (item.fHost.includes(term)) {
            total += 2;
        } else if (item.fUrl.includes(term)) {
            total += 1;
        } else {
            return -1;
        }
    }
    return total;
}

function prep(item, title, url) {
    item.fTitle = fold(title || '');
    item.fHost = hostOf(url || '').toLowerCase();
    item.fUrl = fold(url || '');
    return item;
}

export default function createPalette(omnibar, front, searchEngine) {
    const self = {
        prompt: '',
        focusFirstCandidate: true,
        omnibarPosition: 'middle',
    };
    const ui = document.getElementById('sk_omnibar');
    const hint = ui.querySelector('#sk_omnibarSearchArea .resultPage');
    let tabs = null, current = null, pages = [], actionsMode = false;
    let seq = 0, lastPointer = null, pendingEnter = null, early = null;
    let suggestions = [], sugFor = '', sugSeq = 0, sugTimer = null;
    // the other profiles' tabs, [{peer, name, tabs}], and the line above the rows
    // while switching to one of them, or saying why that failed
    let peers = [], notice = null, switching = false;

    // Each acts on the tab that hosts the palette. RUNTIME copies RUNTIME.repeats
    // into close/reload/zoom requests, and in this frame it is 0 or undefined
    // after navigation keys: those would close nothing and zoom by zero.
    const once = (action, args) => {
        RUNTIME.repeats = 1;
        RUNTIME(action, args);
    };
    const ACTIONS = [
        {name: 'Copy URL', keys: 'yy', run: () => omnibar.copy(current.url)},
        {name: 'Copy URL as Markdown', run: () => omnibar.copy(`[${current.title}](${current.url})`)},
        {name: 'Reload', keys: 'r', also: 'refresh', run: () => once('reloadTab', {nocache: false})},
        {name: 'Duplicate Tab', keys: 'yt', run: () => RUNTIME('duplicateTab')},
        {name: 'Pin / Unpin Tab', keys: 'Alt-p', run: () => RUNTIME('togglePinTab')},
        {name: 'Mute / Unmute Tab', keys: 'Alt-m', also: 'sound audio', run: () => RUNTIME('muteTab')},
        {name: 'Close Tab', keys: 'x', run: () => once('closeTab')},
        {name: 'Close Other Tabs', keys: 'gxx', run: () => RUNTIME('tabOnly')},
        {name: 'Close Tabs to the Right', keys: 'gx$', run: () => RUNTIME('closeTabsToRight')},
        {name: 'Close Tabs to the Left', keys: 'gx0', run: () => RUNTIME('closeTabsToLeft')},
        {name: 'Reopen Closed Tab', keys: 'X', also: 'restore undo', run: () => RUNTIME('openLast')},
        {name: 'Move Tab to New Window', run: () => RUNTIME('moveToWindow', {windowId: -1})},
        // another omnibar type may only open once this one has closed, or it opens
        // without this handler's onClose and keeps the palette's look
        {name: 'Move Tab to Window…', keys: 'W', run: () => setTimeout(() => front._actions['openOmnibar']({type: 'Windows'}), 100)},
        {name: 'Gather All Windows', keys: ';gw', also: 'merge', run: () => RUNTIME('gatherWindows')},
        // Not gated on the browser: nothing but the Chromium build installs a way to
        // open the palette (tabSwitcher.js), and that is the one browser it works in.
        {name: 'Switch Profile…', keys: 'gP', also: 'browser profile person account user window', run: () => setTimeout(() => front._actions['openOmnibar']({type: 'Profiles'}), 100)},
        {name: 'Zoom In', keys: 'zi', run: () => once('setZoom', {zoomFactor: 0.1})},
        {name: 'Zoom Out', keys: 'zo', run: () => once('setZoom', {zoomFactor: -0.1})},
        {name: 'Reset Zoom', keys: 'zr', run: () => once('setZoom', {zoomFactor: 0})},
        {name: 'View Source', keys: 'gs', run: () => RUNTIME('viewSource', {tab: {tabbed: true}})},
        {name: 'Change Theme…', keys: ';T', also: 'color colour scheme appearance dark light', run: () => setTimeout(() => front._actions['openOmnibar']({type: 'Themes'}), 100)},
        {name: 'Auto Theme (Follow System Light / Dark)', also: 'color colour scheme appearance os automatic', run: () => RUNTIME('frontendRequest', {request: 'pickTheme', name: 'auto'})},
        {name: 'Settings…', keys: ';e', also: 'options preferences', run: () => openSettings('')},
        {name: 'Settings: Appearance', also: 'options preferences', run: () => openSettings('appearance')},
        {name: 'Settings: Keys', also: 'options preferences remap', run: () => openSettings('keys')},
        {name: 'Settings: Sites', also: 'options preferences blocklist', run: () => openSettings('sites')},
        // the page's own frame toggles it: from this frame it would turn Surfingkeys off everywhere
        {name: 'Disable / Enable Surfingkeys on This Site', keys: 'Alt-s', also: 'turn off on toggle blocklist', run: () => RUNTIME('frontendRequest', {request: 'toggleBlocklist'})},
        {name: 'Keyboard Shortcuts…', also: 'browser commands hotkeys', run: () => RUNTIME('openLink', {tab: {tabbed: true, active: true}, url: 'chrome://extensions/shortcuts'})},
        // the page lists them: it holds the user's own mappings
        {name: 'Show All Key Mappings', keys: '?', also: 'help usage', run: () => RUNTIME('frontendRequest', {request: 'showUsage'})},
    ].map((a) => prep(Object.assign({kind: 'action', key: a.name}, a), a.name + ' ' + (a.also || ''), ''));

    // the settings page opens on the section named in its hash
    function openSettings(section) {
        RUNTIME('openLink', {tab: {tabbed: true, active: true}, url: '/pages/options.html' + (section && '#' + section)});
    }

    function urlOf(item) {
        if (item.kind === 'tab' || item.kind === 'peer' || item.kind === 'page' || item.kind === 'url') {
            return item.url;
        }
        const engine = (item.kind === 'search' || item.kind === 'suggestion') && searchEngine.aliases[item.alias];
        return engine ? constructSearchURL(engine.url, encodeURIComponent(item.query)) : '';
    }

    const profileName = (group) => group.name || 'another profile';

    // Each other profile's tabs under a heading naming it: at most `limit`, in the
    // order `rank` puts them, as this profile's own tabs are.
    function peerItems(limit, rank) {
        const items = [];
        peers.forEach((group) => {
            const rows = rank(group.tabs).slice(0, limit);
            if (rows.length) {
                items.push({kind: 'heading', key: 'heading' + group.peer, group});
                rows.forEach((tab) => items.push({kind: 'peer', key: `peer${group.peer}:${tab.id}`, group, tab, url: tab.url}));
            }
        });
        return items;
    }

    function buildItems(query) {
        const terms = fold(query).split(/\s+/).filter((t) => t.length);
        if (actionsMode) {
            return terms.length ? ACTIONS.filter((a) => score(a, terms) >= 0) : ACTIONS.slice();
        }
        const others = tabs.filter((t) => !t.current);
        if (!terms.length) {
            return others.slice(0, EMPTY_TABS).map((tab) => ({kind: 'tab', key: 'tab' + tab.id, tab, url: tab.url}))
                .concat(peerItems(EMPTY_TABS, (list) => list));
        }
        const bang = query.match(/^!(\S+)\s+(.+)$/);
        if (bang && searchEngine.aliases.hasOwnProperty(bang[1])) {
            return [{kind: 'search', key: 'search', alias: bang[1], query: bang[2]}].concat(suggestionItems(bang[1], bang[2]));
        }
        const ranked = (list, tie) => list.map((it) => [it, score(it, terms)]).filter((p) => p[1] >= 0)
            .sort((a, b) => (b[1] - a[1]) || tie(a[0], b[0])).map((p) => p[0]);
        const items = ranked(others, (a, b) => a.mru - b.mru).slice(0, MAX_TABS)
            .map((tab) => ({kind: 'tab', key: 'tab' + tab.id, tab, url: tab.url}));
        items.push(...peerItems(MAX_TABS, (list) => ranked(list, (a, b) => a.mru - b.mru)));
        // an open tab is the better answer than its history entry
        const open = new Set(tabs.map((t) => t.pageKey));
        const pageRows = ranked(pages.filter((p) => !open.has(p.pageKey)),
            (a, b) => (b.bookmark - a.bookmark) || ((b.typedCount > 0) - (a.typedCount > 0)) || ((b.lastVisitTime || 0) - (a.lastVisitTime || 0)));
        items.push(...pageRows.slice(0, MAX_PAGES).map((page) => ({kind: 'page', key: 'page' + page.pageKey, page, url: page.url})));
        if (omnibar.isUrl(query)) {
            // a scheme, but not host:port ("localhost:3000")
            const url = /^[a-z][\w+.-]*:(?!\d)/i.test(query) ? query : 'https://' + query;
            items.push({kind: 'url', key: 'url', url});
        }
        const alias = searchEngine.defaultAlias();
        if (!alias) {
            return items;
        }
        items.push({kind: 'search', key: 'search', alias, query});
        return items.concat(suggestionItems(alias, query));
    }

    function suggestionItems(alias, query) {
        if (sugFor !== alias + '\n' + query) {
            return [];
        }
        const seen = new Set([fold(query)]);
        return suggestions.filter((s) => typeof s === 'string' && s.trim() && !seen.has(fold(s.trim())) && seen.add(fold(s.trim())))
            .slice(0, MAX_SUGGESTIONS).map((s) => ({kind: 'suggestion', key: 'sug' + s, alias, query: s.trim()}));
    }

    // The engine's suggestions for a settled query. Late or stale replies are
    // dropped; they only ever append below the search row, so nothing jumps.
    function fetchSuggestions(alias, query) {
        clearTimeout(sugTimer);
        const engine = searchEngine.aliases[alias];
        const mine = ++sugSeq;
        if (!engine || !engine.suggestionURL || !runtime.conf.omnibarSuggestion || query.length < 2
            || omnibar.isUrl(query) || (current && current.incognito) || sugFor === alias + '\n' + query) {
            return;
        }
        sugTimer = setTimeout(() => {
            const requestUrl = constructSearchURL(engine.suggestionURL, encodeURIComponent(query));
            RUNTIME('request', {method: 'get', url: requestUrl}, (resp) => {
                front.contentCommand({action: 'getSearchSuggestions', url: engine.suggestionURL, query, requestUrl, response: resp}, (r) => {
                    if (mine === sugSeq && tabs) {
                        suggestions = Array.isArray(r && r.data) ? r.data : [];
                        sugFor = alias + '\n' + query;
                        update(true);
                    }
                });
            });
        }, runtime.conf.omnibarSuggestionTimeout);
    }

    const LABELS = {tab: 'Switch to Tab', peer: 'Switch to Tab', page: 'Open', url: 'Open URL'};

    function render(item, rxp) {
        // Not an <li>: the omnibar moves the selection over the list's <li>s only, so
        // Tab and the arrows pass over it.
        if (item.kind === 'heading') {
            return el('div', 'sk_palette_group', `Tabs in ${profileName(item.group)}`);
        }
        const li = document.createElement('li');
        li.item = item;
        li.classList.add('sk_palette_kind_' + (item.kind === 'page' ? (item.page.bookmark ? 'bookmark' : 'history') : item.kind));
        const url = urlOf(item);
        if (url) {
            li.url = url;  // what <Ctrl-c> copies; never set li.uid: <Ctrl-D> deletes every listed uid
        }
        let icon;
        if (item.kind === 'tab' || item.kind === 'peer' || item.kind === 'page') {
            icon = document.createElement('img');
            icon.className = 'icon';
            attachFaviconToImgSrc(item.kind === 'page' ? {url: item.url, favIconUrl: ''} : item.tab, icon);
        } else {
            icon = el('div', 'icon');
        }
        const title = item.kind === 'tab' || item.kind === 'peer' ? (item.tab.title || item.url)
            : item.kind === 'page' ? (item.page.title || shortPath(item.url))
                : item.kind === 'action' ? item.name
                    : item.kind === 'url' ? item.url : item.query;
        const row = el('div', 'sk_palette_row');
        // titles come from web pages: every piece is encoded, only the spans are markup
        row.append(createElementWithContent('span', highlight(rxp, title), {class: 'sk_palette_title'}));
        if (item.kind === 'page') {
            row.append(el('span', 'sk_palette_sub', shortPath(item.url)));
        }
        li.append(icon, row);
        const meta = item.kind === 'tab' && item.tab.otherWindow ? 'Other window'
            : item.kind === 'peer' ? (item.group.name || 'Another profile')
                : item.kind === 'page' && item.page.bookmark ? 'Bookmark' : '';
        meta && li.append(el('span', 'sk_palette_meta', meta));
        if (item.kind === 'action') {
            if (item.keys) {
                const keys = el('span', 'sk_palette_keys');
                keys.append(el('kbd', '', item.keys));
                li.append(keys);
            }
        } else {
            const label = item.kind === 'search' ? `Search ${engineName(searchEngine.aliases[item.alias])}`
                : item.kind === 'suggestion' ? 'Search' : LABELS[item.kind];
            li.append(el('span', 'sk_palette_label', label));
        }
        return li;
    }

    // The profile holding the tab brings it forward, and the palette closes once that
    // profile says it has. A failure -- the tab or the profile gone since the list was
    // read, no host -- stays here, said above the rows. One switch at a time.
    function switchToPeer(item) {
        if (switching) {
            return;
        }
        switching = true;
        const mine = seq;
        notice = {text: `Switching to ${profileName(item.group)}…`};
        update(true);
        RUNTIME('activatePeerTab', {peer: item.group.peer, tabId: item.tab.id, windowId: item.tab.windowId}, (r) => {
            if (mine !== seq) {
                return;  // closed or reopened meanwhile
            }
            switching = false;
            if (r && !r.error) {
                notice = null;
                front.hidePopup();
                return;
            }
            notice = {text: `Could not switch to that tab: ${(r && r.error) || 'no answer'}.`, error: true};
            update(true);
        });
    }

    function activate(item, how) {
        if (item.kind === 'tab') {
            RUNTIME('focusTab', {windowId: item.tab.windowId, tabId: item.tab.id});
        } else if (item.kind === 'peer') {
            switchToPeer(item);
        } else if (item.kind === 'action') {
            item.run();
        } else if (urlOf(item)) {
            RUNTIME('openLink', {tab: how || {tabbed: true, active: true}, url: urlOf(item)});
        }
    }

    function setMode(actions) {
        actionsMode = actions;
        const prompt = omnibar.promptSpan;
        prompt.classList.toggle('sk_palette_chip', actions);
        prompt.textContent = actions ? 'Actions' : '';
        omnibar.input.placeholder = actions ? 'Search actions…' : 'Search or enter URL…';
        omnibar.input.value = '';
        update(false);
    }

    self.onOpen = function() {
        ui.classList.add('sk_palette');
        actionsMode = false;
        omnibar.promptSpan.classList.remove('sk_palette_chip');
        omnibar.input.placeholder = 'Search or enter URL…';
        const mine = ++seq;
        pages = [];
        RUNTIME('tabSwitcherTabs', {}, (resp) => {
            if (mine !== seq) {
                return;  // closed or reopened meanwhile
            }
            tabs = ((resp && resp.tabs) || []).map((t, i) => Object.assign(prep(t, t.title, t.url), {mru: i, pageKey: pageKey(t.url)}));
            current = tabs.find((t) => t.current) || null;
            update(false);
            if (current && current.incognito) {
                return;  // no history, bookmarks or suggestions in a private window
            }
            let history = null, bookmarks = null;
            const merge = () => {
                if (mine !== seq || !history || !bookmarks) {
                    return;
                }
                const seen = new Set();
                pages = bookmarks.concat(history).filter((p) => p.url && !seen.has(p.pageKey) && seen.add(p.pageKey));
                update(true);
            };
            RUNTIME('getHistory', {query: '', maxResults: HISTORY_SNAPSHOT}, (r) => {
                history = ((r && r.history) || []).map((h) => Object.assign(prep(h, h.title, h.url), {bookmark: false, pageKey: pageKey(h.url)}));
                merge();
            });
            RUNTIME('getBookmarks', {}, (r) => {
                const flat = [];
                const walk = (nodes) => (nodes || []).forEach((n) => (n.url ? flat.push(n) : walk(n.children)));
                walk(r && r.bookmarks);
                bookmarks = flat.map((b) => Object.assign(prep(b, b.title, b.url), {bookmark: true, pageKey: pageKey(b.url)}));
                merge();
            });
            if (getBrowserName() !== 'Chrome') {
                return;
            }
            // after this profile's tabs, which never wait for it; a profile whose tabs
            // could not be read gets no group
            RUNTIME('getPeerTabs', {}, (r) => {
                if (mine !== seq) {
                    return;
                }
                peers = ((r && Array.isArray(r.peers)) ? r.peers : [])
                    .filter((p) => !p.error && Array.isArray(p.tabs) && p.tabs.length)
                    .map((p) => ({
                        peer: p.peer,
                        name: p.profile ? p.profile.name : null,
                        tabs: p.tabs.map((t, i) => Object.assign(prep(t, t.title, t.url), {mru: i})),
                    }));
                update(true);
            });
        });
    };

    self.onClose = function() {
        seq++;
        sugSeq++;
        clearTimeout(sugTimer);
        ui.classList.remove('sk_palette');
        omnibar.promptSpan.classList.remove('sk_palette_chip');
        hint.textContent = '';
        tabs = current = lastPointer = pendingEnter = null;
        pages = [];
        peers = [];
        notice = null;
        switching = false;
        suggestions = [];
        sugFor = '';
        actionsMode = false;
    };

    // keepFocus: rows arriving late (history, suggestions) must not move the
    // selection; a new keystroke starts over from the best match.
    function update(keepFocus) {
        if (!tabs) {
            return;  // rendered once the tab list arrives
        }
        const query = omnibar.input.value.trim();
        const focused = keepFocus && omnibar.resultsDiv.querySelector('li.focused');
        const keep = focused && focused.item && focused.item.key;
        const terms = query.split(/\s+/).filter((t) => t.length).map(escapeRegExp);
        const rxp = terms.length ? new RegExp(terms.join('|'), 'gi') : null;
        const items = buildItems(query);
        omnibar.listResults(items, (item) => render(item, rxp));
        // listResults gives every row it is handed a click that types into the input
        omnibar.resultsDiv.querySelectorAll('.sk_palette_group').forEach((heading) => {
            heading.onclick = null;
        });
        if (notice) {
            omnibar.resultsDiv.prepend(el('div', 'sk_palette_notice' + (notice.error ? ' sk_palette_error' : ''), notice.text));
        }
        const lis = Array.from(omnibar.resultsDiv.querySelectorAll('li'));
        // a late arrival (history, suggestions) re-renders: the focus stays where it was
        const again = keep && lis.find((li) => li.item.key === keep);
        if (again && !again.classList.contains('focused')) {
            lis.forEach((li) => li.classList.remove('focused'));
            omnibar.focusItem(again);
        }
        lis.forEach((li) => {
            li.onclick = () => {
                if (li.item.kind === 'peer') {
                    // the row clicked is the one a failure is said for, and Enter retries
                    if (!switching) {
                        lis.forEach((x) => x.classList.remove('focused'));
                        li.classList.add('focused');
                        activate(li.item);
                    }
                    return;
                }
                activate(li.item);
                front.hidePopup();
            };
            // mousemove, not mouseenter: every keystroke re-renders the rows under a resting pointer
            li.onmousemove = (e) => {
                if (lastPointer && (lastPointer[0] !== e.screenX || lastPointer[1] !== e.screenY) && !li.classList.contains('focused')) {
                    lis.forEach((x) => x.classList.remove('focused'));
                    li.classList.add('focused');
                }
                lastPointer = [e.screenX, e.screenY];
            };
        });
        hint.textContent = '';
        if (!actionsMode && !query) {
            hint.append('Actions ', el('kbd', '', 'Tab'));
        }
        if (!keepFocus && !actionsMode && query) {
            const bang = query.match(/^!(\S+)\s+(.+)$/);
            bang && searchEngine.aliases.hasOwnProperty(bang[1])
                ? fetchSuggestions(bang[1], bang[2]) : fetchSuggestions(searchEngine.defaultAlias(), query);
        }
        if (pendingEnter) {  // Enter was pressed before the tab list arrived
            const keys = pendingEnter;
            pendingEnter = null;
            self.onEnter.call(keys) && front.hidePopup();
        }
    }
    self.onInput = () => {
        notice = switching ? notice : null;
        update(false);
    };

    // Tab on an empty input lists the actions, as in Arc; they need no tab list,
    // so a Tab that beats it switches at once and what is typed next filters them.
    self.onTab = function() {
        if (!actionsMode && omnibar.input.value === '') {
            setMode(true);
            return true;
        }
        return false;
    };

    // <Ctrl-d>: forget a history page, or close a listed tab.
    self.onDelete = function(li) {
        const item = li && li.item;
        if (!item || !(item.kind === 'tab' || (item.kind === 'page' && !item.page.bookmark))) {
            return false;
        }
        if (item.kind === 'tab') {
            RUNTIME('closeTabByIds', {tabIds: [item.tab.id]});
            tabs = tabs.filter((t) => t !== item.tab);
        } else {
            RUNTIME('removeURL', {uid: 'H' + item.url});
            pages = pages.filter((p) => p !== item.page);
        }
        const next = li.nextElementSibling;
        li.classList.remove('focused');
        next && next.item && omnibar.focusItem(next);
        update(true);
        return true;
    };

    // The palette shortcut pressed again closes it.
    self.onKeydown = function(evt) {
        if ((evt.metaKey || evt.ctrlKey) && evt.shiftKey && evt.keyCode === 80) {  // the letter P on any layout
            evt.preventDefault();
            front.hidePopup();
            return true;
        }
        if (evt.keyCode === KeyboardUtils.keyCodes.backspace && actionsMode && omnibar.input.value === '') {
            evt.preventDefault();
            setMode(false);
            return true;
        }
        // Space would expand a leading search alias ("g ", "gh ") into a search
        // engine; here a query like "gh issues" should keep filtering.
        return evt.keyCode === KeyboardUtils.keyCodes.space;
    };

    // Like every omnibar: Ctrl-Enter opens in the background and keeps the
    // palette open, Shift-Enter flips new tab / current tab.
    self.onEnter = function() {
        if (!tabs) {
            pendingEnter = {tabbed: this.tabbed, activeTab: this.activeTab};
            return false;
        }
        const how = {tabbed: !!this.tabbed, active: this.activeTab !== false};
        const fi = omnibar.resultsDiv.querySelector('li.focused');
        if (fi && fi.item) {
            activate(fi.item, how);
            if (fi.item.kind === 'tab' || fi.item.kind === 'action') {
                return true;
            }
            if (fi.item.kind === 'peer') {
                return false;  // closed by switchToPeer once that profile has switched
            }
        } else if (omnibar.input.value.trim() && !actionsMode) {
            activate({kind: 'search', alias: searchEngine.defaultAlias(), query: omnibar.input.value.trim()}, how);
        }
        return how.active;
    };

    const isOpen = () => ui.style.display !== 'none' && ui.classList.contains('sk_palette');

    // Keys typed in the page before this input took focus (content_scripts/tabSwitcher.js).
    // They were all typed before anything that reached the input, but can arrive
    // after it, so they go in front.
    function typeAhead(message) {
        if (typeof message.text !== 'string') {
            return;
        }
        const input = omnibar.input;
        input.value = message.text + input.value;
        input.setSelectionRange(input.value.length, input.value.length);
        omnibar.triggerInput();
        if (message.then === 'Enter') {
            self.onEnter.call({tabbed: !!(omnibar.tabbed ^ !!message.shift), activeTab: true}) && front.hidePopup();
        } else if (message.then === 'Escape') {
            front.hidePopup();
        } else if (message.then === 'Tab') {
            self.onTab();
        }
    }
    // Over chrome.runtime from the top frame, never postMessage: an Enter here picks
    // a tab or opens a URL, and the page could post one. It takes another road than
    // the open before it and can land first; it then waits for that open, briefly.
    runtime.on('paletteTypeAhead', function(message) {
        if (isOpen()) {
            typeAhead(message);
        } else {
            early = {message, at: Date.now()};
        }
    });

    // Sent by the browser shortcut and the page mappings (content_scripts/tabSwitcher.js).
    front._actions['togglePalette'] = function() {
        if (isOpen()) {
            front.hidePopup();
        } else {
            front._actions['openOmnibar']({type: 'Palette'});
            const keys = early && Date.now() - early.at < EARLY_TYPE_AHEAD_MS && early.message;
            early = null;
            keys && isOpen() && typeAhead(keys);
        }
    };

    return self;
}
