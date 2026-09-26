// Command Palette, modelled on Arc's Command Bar: one flat list, no headers.
//
// Empty input: recently used tabs, the current one left out, so Enter goes back
// to the previous tab. Typing: matching tabs, then history and bookmark pages,
// then "Open URL" when the input looks like one, then a web search, then the
// search engine's suggestions. Tab on an empty input lists actions instead.
//
// Nothing here that acts is reachable over window.postMessage, which the page can
// post to like any content script: typed-ahead keys come over chrome.runtime.
import { RUNTIME, runtime } from '../common/runtime.js';
import {
    attachFaviconToImgSrc,
    constructSearchURL,
    createElementWithContent,
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
    let seq = 0, lastPointer = null, pendingEnter = null, pendingTab = false, early = null;
    let suggestions = [], sugFor = '', sugSeq = 0, sugTimer = null;

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
        {name: 'Zoom In', keys: 'zi', run: () => once('setZoom', {zoomFactor: 0.1})},
        {name: 'Zoom Out', keys: 'zo', run: () => once('setZoom', {zoomFactor: -0.1})},
        {name: 'Reset Zoom', keys: 'zr', run: () => once('setZoom', {zoomFactor: 0})},
        {name: 'View Source', keys: 'gs', run: () => RUNTIME('viewSource', {tab: {tabbed: true}})},
        {name: 'Change Theme…', keys: ';T', also: 'color colour scheme appearance dark light', run: () => setTimeout(() => front._actions['openOmnibar']({type: 'Themes'}), 100)},
    ].map((a) => prep(Object.assign({kind: 'action', key: a.name}, a), a.name + ' ' + (a.also || ''), ''));

    function urlOf(item) {
        if (item.kind === 'tab' || item.kind === 'page' || item.kind === 'url') {
            return item.url;
        }
        const engine = (item.kind === 'search' || item.kind === 'suggestion') && searchEngine.aliases[item.alias];
        return engine ? constructSearchURL(engine.url, encodeURIComponent(item.query)) : '';
    }

    function buildItems(query) {
        const terms = fold(query).split(/\s+/).filter((t) => t.length);
        if (actionsMode) {
            return terms.length ? ACTIONS.filter((a) => score(a, terms) >= 0) : ACTIONS.slice();
        }
        const others = tabs.filter((t) => !t.current);
        if (!terms.length) {
            return others.slice(0, EMPTY_TABS).map((tab) => ({kind: 'tab', key: 'tab' + tab.id, tab, url: tab.url}));
        }
        const bang = query.match(/^!(\S+)\s+(.+)$/);
        if (bang && searchEngine.aliases.hasOwnProperty(bang[1])) {
            return [{kind: 'search', key: 'search', alias: bang[1], query: bang[2]}].concat(suggestionItems(bang[1], bang[2]));
        }
        const ranked = (list, tie) => list.map((it) => [it, score(it, terms)]).filter((p) => p[1] >= 0)
            .sort((a, b) => (b[1] - a[1]) || tie(a[0], b[0])).map((p) => p[0]);
        const items = ranked(others, (a, b) => a.mru - b.mru).slice(0, MAX_TABS)
            .map((tab) => ({kind: 'tab', key: 'tab' + tab.id, tab, url: tab.url}));
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

    const LABELS = {tab: 'Switch to Tab', page: 'Open', url: 'Open URL'};

    function render(item, rxp) {
        const li = document.createElement('li');
        li.item = item;
        li.classList.add('sk_palette_kind_' + (item.kind === 'page' ? (item.page.bookmark ? 'bookmark' : 'history') : item.kind));
        const url = urlOf(item);
        if (url) {
            li.url = url;  // what <Ctrl-c> copies; never set li.uid: <Ctrl-D> deletes every listed uid
        }
        let icon;
        if (item.kind === 'tab' || item.kind === 'page') {
            icon = document.createElement('img');
            icon.className = 'icon';
            attachFaviconToImgSrc(item.kind === 'tab' ? item.tab : {url: item.url, favIconUrl: ''}, icon);
        } else {
            icon = el('div', 'icon');
        }
        const title = item.kind === 'tab' ? (item.tab.title || item.url)
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

    function activate(item, how) {
        if (item.kind === 'tab') {
            RUNTIME('focusTab', {windowId: item.tab.windowId, tabId: item.tab.id});
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
        pendingTab = false;
        pages = [];
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
        const lis = Array.from(omnibar.resultsDiv.querySelectorAll('li'));
        // a late arrival (history, suggestions) re-renders: the focus stays where it was
        const again = keep && lis.find((li) => li.item.key === keep);
        if (again && !again.classList.contains('focused')) {
            lis.forEach((li) => li.classList.remove('focused'));
            omnibar.focusItem(again);
        }
        lis.forEach((li) => {
            li.onclick = () => {
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
        if (pendingTab) {  // Tab was typed ahead, before the tab list arrived
            pendingTab = false;
            self.onTab();
            return;
        }
        if (pendingEnter) {  // Enter was pressed before the tab list arrived
            const keys = pendingEnter;
            pendingEnter = null;
            self.onEnter.call(keys) && front.hidePopup();
        }
    }
    self.onInput = () => update(false);

    // Tab on an empty input lists the actions, as in Arc.
    self.onTab = function() {
        if (!actionsMode && tabs && omnibar.input.value === '') {
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
            tabs ? self.onTab() : (pendingTab = true);
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
