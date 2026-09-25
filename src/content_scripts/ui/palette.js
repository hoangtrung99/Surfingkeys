// Command Palette: an omnibar type that puts open tabs first (most recently
// used first, the current one marked), then offers to open what was typed as a
// URL, "!alias query" for any search alias, and a web search as the last row.
import { RUNTIME, runtime } from '../common/runtime.js';
import {
    attachFaviconToImgSrc,
    constructSearchURL,
    createElementWithContent,
    htmlEncode,
} from '../common/utils.js';
import KeyboardUtils from '../common/keyboardUtils';

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
    e.textContent = text;
    return e;
}

export default function createPalette(omnibar, front, searchEngine) {
    const self = {
        prompt: '',
        focusFirstCandidate: true,
        omnibarPosition: 'middle',
    };
    const ui = document.getElementById('sk_omnibar');
    // the count goes where every omnibar type shows one; listResults never writes it
    const count = ui.querySelector('#sk_omnibarSearchArea .resultPage');
    let tabs = null, seq = 0, lastPointer = null, pendingEnter = null;

    function matchTabs(query) {
        const terms = fold(query).split(/\s+/).filter((t) => t.length);
        if (!terms.length) {
            return tabs.slice();
        }
        const scored = [];
        tabs.forEach((t, i) => {
            const title = fold(t.title || ''), host = hostOf(t.url).toLowerCase(), url = fold(t.url || '');
            let score = 0;
            for (const term of terms) {
                if (title.startsWith(term)) {
                    score += 4;
                } else if (title.includes(term)) {
                    score += 3;
                } else if (host.includes(term)) {
                    score += 2;
                } else if (url.includes(term)) {
                    score += 1;
                } else {
                    return;  // every word must match somewhere
                }
            }
            scored.push({t, i, score});
        });
        scored.sort((a, b) => (b.score - a.score) || (a.i - b.i));
        return scored.map((s) => s.t);
    }

    const MAX_ROWS = 50;  // the rest is one more keystroke away
    function buildItems(query, matched) {
        const bang = query.match(/^!(\S+)\s+(.+)$/);
        if (bang && searchEngine.aliases.hasOwnProperty(bang[1])) {
            return [{kind: 'search', alias: bang[1], query: bang[2]}];
        }
        const items = matched.slice(0, MAX_ROWS).map((tab) => ({kind: 'tab', tab}));
        if (query.length) {
            // "github.com" usually means the open GitHub tab: offer to open the
            // address only after the tabs it matches
            if (omnibar.isUrl(query)) {
                items.push({kind: 'url', url: /^[a-z][\w+.-]*:/i.test(query) ? query : 'https://' + query});
            }
            items.push({kind: 'search', alias: runtime.conf.defaultSearchEngine, query});
        }
        return items;
    }

    function urlOf(item) {
        if (item.kind === 'tab') {
            return item.tab.url;
        }
        return item.kind === 'url' ? item.url
            : constructSearchURL(searchEngine.aliases[item.alias].url, encodeURIComponent(item.query));
    }

    function render(item, rxp) {
        const li = document.createElement('li');
        li.item = item;
        li.url = urlOf(item);  // what <Ctrl-c> copies
        const row = el('div', 'sk_palette_row', '');
        let title, host = '';
        if (item.kind === 'tab') {
            const icon = document.createElement('img');
            icon.className = 'icon';
            attachFaviconToImgSrc(item.tab, icon);
            li.append(icon);
            title = item.tab.title || item.tab.url;
            host = hostOf(item.tab.url);
        } else {
            li.append(el('div', 'icon', ''));
            title = item.kind === 'url' ? `Open ${item.url}`
                : `Search ${engineName(searchEngine.aliases[item.alias])} for “${item.query}”`;
            li.classList.add('sk_palette_action');
        }
        // titles come from web pages: encode, then let highlight() add its spans
        row.append(createElementWithContent('span', omnibar.highlight(rxp, htmlEncode(title)), {class: 'sk_palette_title'}));
        host && row.append(el('span', 'sk_palette_host', host));
        li.append(row);
        if (item.kind === 'tab' && (item.tab.current || item.tab.otherWindow)) {
            li.append(el('span', 'sk_palette_badge', item.tab.current ? 'Current' : 'Other window'));
        }
        return li;
    }

    function activate(item, tab) {
        if (item.kind === 'tab') {
            if (!item.tab.current) {
                RUNTIME('focusTab', {windowId: item.tab.windowId, tabId: item.tab.id});
            }
        } else {
            RUNTIME('openLink', {tab: tab || {tabbed: true, active: true}, url: urlOf(item)});
        }
    }

    self.onOpen = function() {
        ui.classList.add('sk_palette');
        omnibar.input.placeholder = 'Search tabs, type a URL, or !g to search';
        const mine = ++seq;
        RUNTIME('tabSwitcherTabs', {}, (resp) => {
            if (mine === seq) {  // not closed or reopened meanwhile
                tabs = (resp && resp.tabs) || [];
                self.onInput();
            }
        });
    };

    self.onClose = function() {
        seq++;
        ui.classList.remove('sk_palette');
        count.textContent = '';
        tabs = lastPointer = pendingEnter = null;
    };

    self.onInput = function() {
        if (!tabs) {
            return;  // rendered once the tab list arrives
        }
        const query = omnibar.input.value.trim();
        const terms = query.split(/\s+/).filter((t) => t.length).map(escapeRegExp);
        const rxp = terms.length ? new RegExp(terms.join('|'), 'gi') : null;
        const matched = matchTabs(query);
        const items = buildItems(query, matched);
        omnibar.listResults(items, (item) => render(item, rxp));
        const lis = Array.from(omnibar.resultsDiv.querySelectorAll('li'));
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
        // Enter on an empty query goes back to the previous tab, not the one already open.
        if (!query && lis.length > 1 && lis[0].item.kind === 'tab' && lis[0].item.tab.current) {
            lis[0].classList.remove('focused');
            omnibar.focusItem(lis[1]);
        }
        count.textContent = query ? `${matched.length} of ${tabs.length} tabs` : `${tabs.length} tabs`;
        if (pendingEnter) {  // Enter was pressed before the tab list arrived
            const keys = pendingEnter;
            pendingEnter = null;
            self.onEnter.call(keys) && front.hidePopup();
        }
    };

    // Space would expand a leading search alias ("g ", "gh ") into a search
    // engine; here a query like "gh issues" should keep filtering tabs.
    // The palette shortcut pressed again closes it.
    self.onKeydown = function(evt) {
        if ((evt.metaKey || evt.ctrlKey) && evt.shiftKey && evt.keyCode === 80) {  // the letter P on any layout
            evt.preventDefault();
            front.hidePopup();
            return true;
        }
        return evt.keyCode === KeyboardUtils.keyCodes.space;
    };

    // Sent by the browser shortcut and the page mappings (content_scripts/tabSwitcher.js).
    front._actions['togglePalette'] = function() {
        if (ui.style.display !== 'none' && ui.classList.contains('sk_palette')) {
            front.hidePopup();
        } else {
            front._actions['openOmnibar']({type: 'Palette'});
        }
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
            if (fi.item.kind === 'tab') {
                return true;  // the user is leaving this tab: nothing to keep open
            }
        } else if (omnibar.input.value.trim()) {
            activate({kind: 'search', alias: runtime.conf.defaultSearchEngine, query: omnibar.input.value.trim()}, how);
        }
        return how.active;
    };

    // Keys typed in the page before this input took focus (content_scripts/tabSwitcher.js).
    // They were all typed before anything that reached the input, but can arrive
    // after it, so they go in front.
    front._actions['paletteTypeAhead'] = function(message) {
        if (ui.style.display !== 'none' && ui.classList.contains('sk_palette') && typeof message.text === 'string') {
            const input = omnibar.input;
            input.value = message.text + input.value;
            input.setSelectionRange(input.value.length, input.value.length);
            omnibar.triggerInput();
        }
    };

    return self;
}
