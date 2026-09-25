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
    let tabs = null, footer = null, count = null, seq = 0, lastPointer = null;

    function buildFooter() {
        const f = el('div', 'sk_palette_footer', '');
        count = el('span', 'sk_palette_count', '');
        const hint = (keys, label) => {
            const span = el('span', 'sk_palette_key', '');
            keys.forEach((k) => span.append(el('kbd', '', k)));
            span.append(label);
            return span;
        };
        f.append(count, hint(['↑', '↓'], 'navigate'), hint(['↵'], 'select'), hint(['esc'], 'close'));
        return f;
    }

    function matchTabs(query) {
        const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length);
        if (!terms.length) {
            return tabs.slice();
        }
        const scored = [];
        tabs.forEach((t, i) => {
            const title = (t.title || '').toLowerCase(), host = hostOf(t.url).toLowerCase(), url = (t.url || '').toLowerCase();
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

    function buildItems(query) {
        const bang = query.match(/^!(\S+)\s+(.+)$/);
        if (bang && searchEngine.aliases.hasOwnProperty(bang[1])) {
            return [{kind: 'search', alias: bang[1], query: bang[2]}];
        }
        const items = matchTabs(query).map((tab) => ({kind: 'tab', tab}));
        if (query.length) {
            if (omnibar.isUrl(query)) {
                items.unshift({kind: 'url', url: /^[a-z][\w+.-]*:/i.test(query) ? query : 'https://' + query});
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
        if (item.kind === 'tab' && item.tab.current) {
            li.append(el('span', 'sk_palette_badge', 'Current'));
        }
        return li;
    }

    function activate(item) {
        if (item.kind === 'tab') {
            if (!item.tab.current) {
                RUNTIME('focusTab', {windowId: item.tab.windowId, tabId: item.tab.id});
            }
        } else {
            RUNTIME('openLink', {tab: {tabbed: true, active: true}, url: urlOf(item)});
        }
    }

    self.onOpen = function() {
        self.onClose();  // defensive: never two footers
        ui.classList.add('sk_palette');
        omnibar.input.placeholder = 'Search tabs, type a URL, or !g to search';
        footer = buildFooter();
        ui.append(footer);
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
        footer && footer.remove();
        footer = count = tabs = lastPointer = null;
    };

    self.onInput = function() {
        if (!tabs) {
            return;  // rendered once the tab list arrives
        }
        const query = omnibar.input.value.trim();
        const terms = query.split(/\s+/).filter((t) => t.length).map(escapeRegExp);
        const rxp = terms.length ? new RegExp(terms.join('|'), 'gi') : null;
        const items = buildItems(query);
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
        const matched = items.filter((i) => i.kind === 'tab').length;
        count.textContent = query ? `${matched} of ${tabs.length} tabs` : `${tabs.length} tabs`;
    };

    // Space would expand a leading search alias ("g ", "gh ") into a search
    // engine; here a query like "gh issues" should keep filtering tabs.
    // The palette shortcut pressed again closes it.
    self.onKeydown = function(evt) {
        if ((evt.metaKey || evt.ctrlKey) && evt.shiftKey && evt.code === 'KeyP') {
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

    self.onEnter = function() {
        const fi = omnibar.resultsDiv.querySelector('li.focused');
        if (fi && fi.item) {
            activate(fi.item);
        } else if (omnibar.input.value.trim()) {
            activate({kind: 'search', alias: runtime.conf.defaultSearchEngine, query: omnibar.input.value.trim()});
        }
        return true;
    };

    return self;
}
