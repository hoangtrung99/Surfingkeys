// The Command Palette (ui/palette.js) in the real frontend: what it lists for a
// query, what Enter, the actions and <Ctrl-d> ask the background for, and the
// races between keys and the tab list that arrives after the palette opens.
import path from 'path';
import { bootFrontend } from '../helpers/bootFrontend.js';
import { BOOT_TIMEOUT } from '../helpers/jsdomEnv.js';

const SRC = path.resolve(__dirname, '../../src');

const GOOGLE = {
    alias: 'g',
    prompt: 'google',
    url: 'https://www.google.com/search?q=',
    suggestionURL: 'https://www.google.com/complete/search?client=chrome-omni&q=',
};

// MRU order as background/tabSwitcher.js answers it: the palette's own tab first
const tab = (id, title, url, extra) => Object.assign({ id, windowId: 1, title, url, favIconUrl: '' }, extra);
const CURRENT = tab(1, 'Here — current', 'https://here.test/now', { current: true });
const TABS = [
    CURRENT,
    tab(2, 'Kế hoạch tuần', 'https://docs.google.com/plan'),
    tab(3, 'Inbox', 'https://mail.test/inbox'),
    tab(4, 'Đà Nẵng travel', 'https://travel.test/danang', { windowId: 2, otherWindow: true }),
    tab(5, 'Figma — design', 'https://figma.test/file'),
    tab(6, 'Open page', 'https://open.test/a'),
    tab(7, 'Seven', 'https://seven.test/'),
    tab(8, 'Eight', 'https://eight.test/'),
    tab(9, 'Nine', 'https://nine.test/'),
    tab(10, 'Ten', 'https://ten.test/'),
];

let f, RUNTIME, toPage, data;

const ui = () => document.getElementById('sk_omnibar');
const input = () => ui().querySelector('#sk_omnibarSearchArea input');
const prompt = () => ui().querySelector('#sk_omnibarSearchArea>span.prompt');
const hint = () => ui().querySelector('#sk_omnibarSearchArea .resultPage');
const lis = () => Array.from(ui().querySelectorAll('#sk_omnibarSearchResult li'));
const isOpen = () => ui().style.display !== 'none' && ui().classList.contains('sk_palette');
const titleOf = (li) => li.querySelector('.sk_palette_title').textContent;
const labelOf = (li) => {
    const label = li.querySelector('.sk_palette_label');
    return label ? label.textContent : '';
};
const titles = () => lis().map(titleOf);
const focused = () => ui().querySelector('#sk_omnibarSearchResult li.focused');
const sentAll = (action) => f.sent.filter((m) => m.action === action);
const sentOne = (action) => {
    const all = sentAll(action);
    expect(all).toHaveLength(1);
    return all[0];
};
// what the palette asked the page for (front.contentCommand posts to the top frame)
const toContent = (action) => toPage.mock.calls.map((c) => c[0].surfingkeys_uihost_data)
    .filter((d) => d && d.action === action);

async function open() {
    f.post({ action: 'togglePalette' });
    await f.settle();
}

// a keystroke's worth of input: the value changes, then the input event
async function type(text) {
    input().value = text;
    input().setSelectionRange(text.length, text.length);
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await f.settle();
}

function rowTitled(title) {
    const li = lis().find((l) => titleOf(l) === title);
    expect(li).toBeDefined();
    return li;
}

beforeAll(async () => {
    f = await bootFrontend();
    RUNTIME = require(path.join(SRC, 'content_scripts/common/runtime.js')).RUNTIME;
    toPage = jest.spyOn(window, 'postMessage').mockImplementation(() => {});
    f.post({ action: 'initFrontend', origin: 'http://localhost', winSize: [1280, 800] });
    f.post(Object.assign({ action: 'addSearchAlias' }, GOOGLE));
    Element.prototype.scrollIntoView = jest.fn();
}, BOOT_TIMEOUT);

beforeEach(() => {
    data = { tabs: TABS, history: [], bookmarks: [] };
    f.answers.tabSwitcherTabs = () => ({ tabs: data.tabs });
    f.answers.getHistory = () => ({ history: data.history });
    f.answers.getBookmarks = () => ({ bookmarks: data.bookmarks });
    f.held.length = 0;
});

afterEach(async () => {
    f.Front.hidePopup();
    await f.settle();
});

describe('empty input', () => {
    test('lists the other tabs in MRU order, at most 8, the current one left out', async () => {
        await open();
        expect(isOpen()).toBe(true);
        expect(titles()).toEqual(TABS.slice(1, 9).map((t) => t.title));
        expect(lis().every((li) => labelOf(li) === 'Switch to Tab')).toBe(true);
        expect(focused()).toBe(lis()[0]);
        expect(hint().textContent).toBe('Actions Tab');
        expect(input().placeholder).toBe('Search or enter URL…');
    });

    test('marks a tab of another window', async () => {
        await open();
        expect(rowTitled('Đà Nẵng travel').querySelector('.sk_palette_meta').textContent).toBe('Other window');
        expect(rowTitled('Inbox').querySelector('.sk_palette_meta')).toBeNull();
    });

    test('togglePalette closes an open palette', async () => {
        await open();
        await open();
        expect(ui().style.display).toBe('none');
        expect(ui().classList.contains('sk_palette')).toBe(false);
    });
});

describe('ranking', () => {
    const RANKED = [
        CURRENT,
        tab(21, 'Zeta', 'https://z.test/docs/page'),  // URL only
        tab(22, 'Other', 'https://docs.example.test/'),  // host
        tab(23, 'Read the docs', 'https://r.test/'),  // title contains
        tab(24, 'Docs home', 'https://d.test/'),  // title start
    ];

    test('title start > title contains > host > url', async () => {
        data.tabs = RANKED;
        await open();
        await type('docs');
        expect(titles().slice(0, 4)).toEqual(['Docs home', 'Read the docs', 'Other', 'Zeta']);
    });

    test('every term must match', async () => {
        data.tabs = RANKED;
        await open();
        await type('docs home');
        expect(lis().filter((li) => labelOf(li) === 'Switch to Tab').map(titleOf)).toEqual(['Docs home']);
        await type('docs nowhere');
        expect(lis().filter((li) => labelOf(li) === 'Switch to Tab')).toHaveLength(0);
    });

    test('diacritics and đ are folded', async () => {
        await open();
        await type('ke hoach');
        expect(titleOf(lis()[0])).toBe('Kế hoạch tuần');
        await type('da nang');
        expect(titleOf(lis()[0])).toBe('Đà Nẵng travel');
    });

    test('the best match is focused on every keystroke', async () => {
        data.tabs = RANKED;
        await open();
        await type('docs');
        expect(titleOf(focused())).toBe('Docs home');
        await type('read');
        expect(titleOf(focused())).toBe('Read the docs');
    });
});

describe('history and bookmarks', () => {
    const many = (n, prefix) => Array.from({ length: n }, (_, i) => tab(100 + i, `${prefix} ${i}`, `https://m${i}.test/`));

    test('at most 5 tab rows and 3 page rows', async () => {
        data.tabs = [CURRENT].concat(many(7, 'match tab'));
        data.history = Array.from({ length: 6 }, (_, i) => ({ title: `match page ${i}`, url: `https://h${i}.test/` }));
        await open();
        await type('match');
        expect(lis().filter((li) => labelOf(li) === 'Switch to Tab')).toHaveLength(5);
        expect(lis().filter((li) => labelOf(li) === 'Open')).toHaveLength(3);
    });

    test('a page open as a tab is not listed from history, whatever its scheme, www, slash or fragment', async () => {
        data.history = [
            { title: 'Open page', url: 'http://www.open.test/a/#top' },
            { title: 'Open page elsewhere', url: 'https://open.test/b' },
        ];
        await open();
        await type('open page');
        expect(lis().map((li) => [titleOf(li), labelOf(li)])).toEqual(expect.arrayContaining([
            ['Open page', 'Switch to Tab'],
            ['Open page elsewhere', 'Open'],
        ]));
        expect(lis().filter((li) => labelOf(li) === 'Open').map(titleOf)).toEqual(['Open page elsewhere']);
    });

    test('bookmark > typed > recent among equal matches', async () => {
        data.history = [
            { title: 'Guide recent', url: 'https://g1.test/', lastVisitTime: 300 },
            { title: 'Guide typed', url: 'https://g2.test/', typedCount: 2, lastVisitTime: 100 },
            { title: 'Guide old', url: 'https://g3.test/', lastVisitTime: 200 },
        ];
        data.bookmarks = [{ title: 'root', children: [{ title: 'Guide mark', url: 'https://g4.test/' }] }];
        await open();
        await type('guide');
        const pages = lis().filter((li) => labelOf(li) === 'Open');
        expect(pages.map(titleOf)).toEqual(['Guide mark', 'Guide typed', 'Guide recent']);
        expect(pages[0].querySelector('.sk_palette_meta').textContent).toBe('Bookmark');
        expect(pages[0].classList.contains('sk_palette_kind_bookmark')).toBe(true);
        expect(pages[1].classList.contains('sk_palette_kind_history')).toBe(true);
    });

    test('nothing is read from history or bookmarks in a private window', async () => {
        data.tabs = [Object.assign({}, CURRENT, { incognito: true })].concat(TABS.slice(1));
        await open();
        expect(sentAll('tabSwitcherTabs')).toHaveLength(1);
        expect(sentAll('getHistory')).toHaveLength(0);
        expect(sentAll('getBookmarks')).toHaveLength(0);
    });
});

describe('URL and search rows', () => {
    test.each([
        ['example.org/docs', 'https://example.org/docs'],
        ['example.org:8080/x', 'https://example.org:8080/x'],
        ['mailto:me@example.org', 'mailto:me@example.org'],
        ['https://x.test/a', 'https://x.test/a'],
    ])('%s opens %s', async (query, url) => {
        await open();
        await type(query);
        const row = lis().find((li) => labelOf(li) === 'Open URL');
        expect(titleOf(row)).toBe(url);
        row.onclick();
        expect(sentOne('openLink')).toEqual(expect.objectContaining({ url, tab: { tabbed: true, active: true } }));
    });

    test('a query that is no URL gets a web search row and no URL row', async () => {
        await open();
        await type('best pizza');
        expect(lis().some((li) => labelOf(li) === 'Open URL')).toBe(false);
        const search = lis().find((li) => labelOf(li) === 'Search Google');
        expect(titleOf(search)).toBe('best pizza');
        expect(search.url).toBe('https://www.google.com/search?q=best%20pizza');
    });

    test('!g foo searches that engine and nothing else', async () => {
        await open();
        await type('!g inbox');
        expect(lis().map(labelOf)).toEqual(['Search Google']);
        expect(titles()).toEqual(['inbox']);
    });

    test('!zz with an unknown alias filters like any query', async () => {
        data.tabs = [CURRENT, tab(30, '!zz inbox notes', 'https://zz.test/')];
        await open();
        await type('!zz inbox');
        expect(lis().map((li) => [titleOf(li), labelOf(li)])).toEqual([
            ['!zz inbox notes', 'Switch to Tab'],
            ['!zz inbox', 'Search Google'],
        ]);
    });

    test('a title is shown as text: only the highlight spans are markup', async () => {
        data.tabs = [CURRENT, tab(31, 'AT&T <b>x</b> <img src=x onerror=alert(1)>', 'https://att.test/')];
        await open();
        await type('t');
        const title = lis()[0].querySelector('.sk_palette_title');
        expect(title.textContent).toBe('AT&T <b>x</b> <img src=x onerror=alert(1)>');
        const markup = Array.from(title.querySelectorAll('*'));
        expect(markup.length).toBeGreaterThan(0);
        expect(markup.every((e) => e.localName === 'span' && e.className === 'omnibar_highlight')).toBe(true);
        expect(markup.map((e) => e.textContent.toLowerCase())).toEqual(markup.map(() => 't'));
    });

    test('a highlighted piece of a title is shown as text too', async () => {
        data.tabs = [CURRENT, tab(32, 'AT&T <b>x</b> news', 'https://att.test/')];
        await open();
        await type('&t <b>x');
        const row = lis().find((li) => titleOf(li) === 'AT&T <b>x</b> news');
        const spans = Array.from(row.querySelectorAll('.sk_palette_title > *'));
        expect(spans.map((e) => [e.localName, e.className, e.textContent])).toEqual([
            ['span', 'omnibar_highlight', '&T'],
            ['span', 'omnibar_highlight', '<b>x'],
        ]);
        expect(spans.every((e) => e.children.length === 0)).toBe(true);
    });
});

describe('search suggestions', () => {
    const TIMEOUT = 200;  // runtime.conf.omnibarSuggestionTimeout

    async function withFakeTimers(fn) {
        jest.useFakeTimers();
        try {
            await fn();
        } finally {
            jest.useRealTimers();
        }
    }

    // the page's answer to the palette's getSearchSuggestions request
    async function answerSuggestions(request, list) {
        f.post({ id: request.id, data: list });
        await f.settle();
    }

    test('come after the typing settles, at most 3, without repeating the query', () => withFakeTimers(async () => {
        f.answers.request = () => ({ text: 'raw' });
        await open();
        await type('pi');
        await type('pizza');
        jest.advanceTimersByTime(TIMEOUT - 1);
        await f.settle();
        expect(sentAll('request')).toHaveLength(0);
        jest.advanceTimersByTime(1);
        await f.settle();
        expect(sentOne('request').url).toBe(GOOGLE.suggestionURL + 'pizza');
        const [request] = toContent('getSearchSuggestions');
        expect(request).toEqual(expect.objectContaining({ query: 'pizza', response: { text: 'raw' } }));
        await answerSuggestions(request, ['PIZZA', 'pizza hut', ' pizza hut ', '', 'pizza near me', 'pizza dough', 'more']);
        const sugs = lis().filter((li) => li.classList.contains('sk_palette_kind_suggestion'));
        expect(sugs.map(titleOf)).toEqual(['pizza hut', 'pizza near me', 'pizza dough']);
        expect(sugs.map(labelOf)).toEqual(['Search', 'Search', 'Search']);
        expect(sugs[0].url).toBe('https://www.google.com/search?q=pizza%20hut');
    }));

    test('a reply for an older query is dropped', () => withFakeTimers(async () => {
        f.answers.request = () => ({});
        await open();
        await type('pizza');
        jest.advanceTimersByTime(TIMEOUT);
        await f.settle();
        const [stale] = toContent('getSearchSuggestions');
        await type('pasta');
        await answerSuggestions(stale, ['pizza hut']);
        expect(lis().some((li) => li.classList.contains('sk_palette_kind_suggestion'))).toBe(false);
    }));

    test('a late reply keeps the focus where it was', () => withFakeTimers(async () => {
        f.answers.request = () => ({});
        await open();
        await type('inbox');
        expect(titleOf(focused())).toBe('Inbox');
        jest.advanceTimersByTime(TIMEOUT);
        await f.settle();
        await answerSuggestions(toContent('getSearchSuggestions')[0], ['inbox zero']);
        expect(titles()).toContain('inbox zero');
        expect(titleOf(focused())).toBe('Inbox');
    }));

    test('the !alias engine is asked with the query after it', () => withFakeTimers(async () => {
        f.answers.request = () => ({});
        await open();
        await type('!g kittens');
        jest.advanceTimersByTime(TIMEOUT);
        await f.settle();
        expect(sentOne('request').url).toBe(GOOGLE.suggestionURL + 'kittens');
        await answerSuggestions(toContent('getSearchSuggestions')[0], ['kittens cute']);
        expect(titles()).toEqual(['kittens', 'kittens cute']);
    }));

    test.each([
        ['a query under 2 characters', 'p', {}],
        ['a URL', 'example.org/docs', {}],
        ['omnibarSuggestion off', 'pizza', { omnibarSuggestion: false }],
        ['a private window', 'pizza', { incognito: true }],
    ])('none for %s', (name, query, opts) => withFakeTimers(async () => {
        const conf = require(path.join(SRC, 'content_scripts/common/runtime.js')).runtime.conf;
        const saved = conf.omnibarSuggestion;
        if (opts.omnibarSuggestion === false) {
            conf.omnibarSuggestion = false;
        }
        if (opts.incognito) {
            data.tabs = [Object.assign({}, CURRENT, { incognito: true })].concat(TABS.slice(1));
        }
        try {
            await open();
            await type(query);
            jest.advanceTimersByTime(TIMEOUT * 5);
            await f.settle();
            expect(sentAll('request')).toHaveLength(0);
            expect(lis().length).toBeGreaterThan(0);
        } finally {
            conf.omnibarSuggestion = saved;
        }
    }));
});

describe('Enter', () => {
    test('on a tab row switches to it and closes', async () => {
        await open();
        const events = f.press('<Enter>', { target: input() });
        expect(sentOne('focusTab')).toEqual(expect.objectContaining({ windowId: 1, tabId: 2 }));
        expect(events[0].defaultPrevented).toBe(false);
        expect(ui().style.display).toBe('none');
    });

    test('on a page row opens it in a new active tab', async () => {
        data.history = [{ title: 'Recipes', url: 'https://food.test/recipes' }];
        await open();
        await type('recipes');
        f.press('<Enter>', { target: input() });
        expect(sentOne('openLink')).toEqual(expect.objectContaining({
            url: 'https://food.test/recipes', tab: { tabbed: true, active: true },
        }));
        expect(ui().style.display).toBe('none');
    });

    test('Ctrl-Enter opens in the background and keeps the palette', async () => {
        await open();
        await type('best pizza');
        f.press('<Ctrl-Enter>', { target: input() });
        expect(sentOne('openLink')).toEqual(expect.objectContaining({
            url: 'https://www.google.com/search?q=best%20pizza', tab: { tabbed: true, active: false },
        }));
        expect(isOpen()).toBe(true);
    });

    test('Shift-Enter opens in the current tab', async () => {
        await open();
        await type('best pizza');
        f.press('<Shift-Enter>', { target: input() });
        expect(sentOne('openLink').tab).toEqual({ tabbed: false, active: true });
    });

    test('before the tab list arrives, it waits for the list and then runs', async () => {
        delete f.answers.tabSwitcherTabs;
        await open();
        f.press('<Enter>', { target: input() });
        expect(sentAll('focusTab')).toHaveLength(0);
        expect(isOpen()).toBe(true);
        f.held.find((h) => h.message.action === 'tabSwitcherTabs').respond({ tabs: TABS });
        await f.settle();
        expect(sentOne('focusTab').tabId).toBe(2);
        expect(ui().style.display).toBe('none');
    });

    test('a tab list that comes after the palette closed is ignored', async () => {
        delete f.answers.tabSwitcherTabs;
        await open();
        const first = f.held.find((h) => h.message.action === 'tabSwitcherTabs');
        await open();  // closes
        await open();  // and again
        first.respond({ tabs: [CURRENT, tab(40, 'Stale', 'https://stale.test/')] });
        await f.settle();
        expect(lis()).toHaveLength(0);
        f.held.filter((h) => h.message.action === 'tabSwitcherTabs').pop().respond({ tabs: TABS });
        await f.settle();
        expect(titleOf(lis()[0])).toBe('Kế hoạch tuần');
        expect(titles()).not.toContain('Stale');
    });
});

describe('keys', () => {
    test('the palette shortcut again (Ctrl-Shift-P) closes it', async () => {
        await open();
        const [down] = f.press('<Ctrl-P>', { target: input() });
        expect(down.defaultPrevented).toBe(true);
        expect(ui().style.display).toBe('none');
    });

    test('Space never expands a search alias', async () => {
        await open();
        await type('g');
        f.press('<Space>', { target: input() });
        expect(prompt().textContent).toBe('');
        expect(isOpen()).toBe(true);
        await type('g issues');
        expect(lis().find((li) => labelOf(li) === 'Search Google')).toBeDefined();
    });

    test('Ctrl-d on a tab row closes that tab and drops the row', async () => {
        await open();
        f.press('<Ctrl-d>', { target: input() });
        expect(sentOne('closeTabByIds').tabIds).toEqual([2]);
        expect(titles()).not.toContain('Kế hoạch tuần');
        expect(titleOf(focused())).toBe('Inbox');
    });

    test('Ctrl-d on a history row forgets that URL', async () => {
        data.history = [{ title: 'Recipes', url: 'https://food.test/recipes' }];
        await open();
        await type('recipes');
        f.press('<Ctrl-d>', { target: input() });
        expect(sentOne('removeURL').uid).toBe('Hhttps://food.test/recipes');
        expect(titles()).not.toContain('Recipes');
    });

    test('Ctrl-d on a bookmark row deletes nothing', async () => {
        data.bookmarks = [{ title: 'Recipes', url: 'https://food.test/recipes' }];
        await open();
        await type('recipes');
        f.press('<Ctrl-d>', { target: input() });
        expect(sentAll('removeURL')).toHaveLength(0);
        expect(sentAll('closeTabByIds')).toHaveLength(0);
        expect(titles()).toContain('Recipes');
    });
});

// Chromium: the tabs of the browser's other open profiles, from the native host
// (background getPeerTabs), after this profile's tabs.
describe("the browser's other profiles", () => {
    const PEERS = [
        { peer: 41, profile: { dir: 'Profile 1', name: 'Work' }, tabs: [
            tab(7, 'Quarterly plan', 'https://docs.test/plan', { windowId: 3 }),
            tab(8, 'Inbox — work', 'https://mail.test/work', { windowId: 3 }),
            tab(9, 'Q3', 'https://plan.test/q3', { windowId: 4 }),
        ] },
        // its name could not be found
        { peer: 42, profile: null, tabs: [tab(5, 'Unnamed one', 'https://unnamed.test/')] },
        // did not answer in time: left out
        { peer: 43, profile: { dir: 'Profile 3', name: 'Slow' }, tabs: [], error: 'that profile did not answer within 1.5 seconds' },
    ];
    const headings = () => Array.from(ui().querySelectorAll('.sk_palette_group')).map((h) => h.textContent);
    // the list as shown: headings and rows, in order
    const shown = () => Array.from(ui().querySelector('#sk_omnibarSearchResult>ul').children)
        .map((c) => (c.classList.contains('sk_palette_group') ? `# ${c.textContent}` : titleOf(c)));
    const notice = () => {
        const n = ui().querySelector('.sk_palette_notice');
        return n ? n.textContent : null;
    };
    const metaOf = (li) => li.querySelector('.sk_palette_meta').textContent;
    const answerPeers = (peers) => f.held.filter((h) => h.message.action === 'getPeerTabs').pop().respond({ peers });
    const answerSwitch = (reply) => f.held.filter((h) => h.message.action === 'activatePeerTab').pop().respond(reply);

    beforeEach(() => {
        f.answers.getPeerTabs = () => ({ peers: PEERS });
    });
    afterEach(() => {
        delete f.answers.getPeerTabs;
    });

    test('empty input: this profile\'s tabs, then each other profile\'s under a heading naming it', async () => {
        await open();
        expect(sentAll('getPeerTabs')).toHaveLength(1);
        expect(shown()).toEqual(TABS.slice(1, 9).map((t) => t.title).concat([
            '# Tabs in Work', 'Quarterly plan', 'Inbox — work', 'Q3',
            '# Tabs in another profile', 'Unnamed one',
        ]));
        expect(['Quarterly plan', 'Q3'].map((t) => metaOf(rowTitled(t)))).toEqual(['Work', 'Work']);
        expect(metaOf(rowTitled('Unnamed one'))).toBe('Another profile');
        expect(labelOf(rowTitled('Q3'))).toBe('Switch to Tab');
        // the first row is still this profile's last tab
        expect(focused()).toBe(lis()[0]);
    });

    test('asked only once this profile\'s tabs are in', async () => {
        delete f.answers.tabSwitcherTabs;
        await open();
        expect(sentAll('getPeerTabs')).toHaveLength(0);
        f.held.find((h) => h.message.action === 'tabSwitcherTabs').respond({ tabs: TABS });
        await f.settle();
        expect(sentAll('getPeerTabs')).toHaveLength(1);
    });

    test('typing filters and ranks within each group, as for this profile\'s tabs', async () => {
        await open();
        await type('plan');
        // a title hit beats a host hit; the unnamed profile has no match and no heading
        expect(shown().slice(0, 4)).toEqual(['Kế hoạch tuần', '# Tabs in Work', 'Quarterly plan', 'Q3']);
        expect(headings()).toEqual(['Tabs in Work']);
    });

    test('moving through the rows passes over the headings', async () => {
        await open();
        for (let i = 0; i < 8; i++) {
            f.press('<Ctrl-n>', { target: input() });
        }
        expect(titleOf(focused())).toBe('Quarterly plan');
        for (let i = 0; i < 3; i++) {
            f.press('<Ctrl-n>', { target: input() });
        }
        expect(titleOf(focused())).toBe('Unnamed one');
        expect(ui().querySelectorAll('.focused')).toHaveLength(1);
    });

    test('Enter on another profile\'s tab asks that profile to switch, and closes once it has', async () => {
        delete f.answers.getPeerTabs;
        await open();
        answerPeers(PEERS);
        await f.settle();
        await type('quarterly');
        f.press('<Enter>', { target: input() });
        expect(sentOne('activatePeerTab')).toEqual(expect.objectContaining({ peer: 41, tabId: 7, windowId: 3 }));
        expect(sentAll('focusTab')).toHaveLength(0);
        expect(isOpen()).toBe(true);
        await f.settle();
        expect(notice()).toBe('Switching to Work…');
        answerSwitch({ tab: { tabId: 7, windowId: 3, active: true, focused: true } });
        await f.settle();
        expect(ui().style.display).toBe('none');
    });

    test('a switch that failed is said, the palette stays, and the row stays the one Enter picks', async () => {
        await open();
        await type('quarterly');
        f.press('<Enter>', { target: input() });
        await f.settle();
        answerSwitch({ error: 'that tab is no longer open' });
        await f.settle();
        expect(isOpen()).toBe(true);
        expect(notice()).toBe('Could not switch to that tab: that tab is no longer open.');
        expect(ui().querySelector('.sk_palette_notice').classList.contains('sk_palette_error')).toBe(true);
        expect(titleOf(focused())).toBe('Quarterly plan');
        f.press('<Enter>', { target: input() });
        expect(sentAll('activatePeerTab')).toHaveLength(2);
        // typing clears what was said
        answerSwitch({ error: 'that profile is no longer open' });
        await f.settle();
        await type('quarterly p');
        expect(notice()).toBeNull();
    });

    // that profile had the request and did not answer in time: it may still switch
    test('a switch that profile has not confirmed is said as such, not as a failure, and the palette stays', async () => {
        await open();
        await type('quarterly');
        f.press('<Enter>', { target: input() });
        await f.settle();
        answerSwitch({ error: 'Surfingkeys in that profile did not confirm the switch within 2.5 seconds', kind: 'pending' });
        await f.settle();
        expect(isOpen()).toBe(true);
        expect(notice()).toBe('Quarterly plan: not confirmed yet — that profile may still switch to it.');
        expect(ui().querySelector('.sk_palette_notice').classList.contains('sk_palette_error')).toBe(false);
        expect(titleOf(focused())).toBe('Quarterly plan');
        // and Enter asks again
        f.press('<Enter>', { target: input() });
        expect(sentAll('activatePeerTab')).toHaveLength(2);
    });

    test('a click switches the same way, one switch at a time', async () => {
        await open();
        rowTitled('Q3').onclick();
        rowTitled('Quarterly plan').onclick();
        f.press('<Enter>', { target: input() });
        expect(sentOne('activatePeerTab')).toEqual(expect.objectContaining({ peer: 41, tabId: 9, windowId: 4 }));
        expect(isOpen()).toBe(true);
        await f.settle();
        expect(titleOf(focused())).toBe('Q3');
    });

    test('a list or a switch answered after the palette closed acts on nothing', async () => {
        delete f.answers.getPeerTabs;
        await open();
        const firstList = f.held.filter((h) => h.message.action === 'getPeerTabs').pop();
        await open();  // closes
        await open();  // and again
        firstList.respond({ peers: [{ peer: 99, profile: { dir: 'Old', name: 'Stale' }, tabs: [tab(1, 'Stale tab', 'https://stale.test/')] }] });
        await f.settle();
        expect(headings()).toEqual([]);
        answerPeers(PEERS);
        await f.settle();
        expect(headings()).toEqual(['Tabs in Work', 'Tabs in another profile']);

        await type('quarterly');
        f.press('<Enter>', { target: input() });
        const pending = f.held.filter((h) => h.message.action === 'activatePeerTab').pop();
        await open();  // closes
        await open();
        pending.respond({ tab: { tabId: 7, windowId: 3, active: true, focused: true } });
        await f.settle();
        expect(isOpen()).toBe(true);
        expect(notice()).toBeNull();
    });

    test('a list arriving late keeps the focus where it was', async () => {
        delete f.answers.getPeerTabs;
        await open();
        await type('inbox');
        expect(titleOf(focused())).toBe('Inbox');
        f.press('<Tab>', { target: input() });
        const picked = titleOf(focused());
        answerPeers(PEERS);
        await f.settle();
        expect(titles()).toContain('Inbox — work');
        expect(titleOf(focused())).toBe(picked);
    });

    test('Ctrl-d on another profile\'s tab closes nothing', async () => {
        await open();
        await type('quarterly');
        f.press('<Ctrl-d>', { target: input() });
        expect(sentAll('closeTabByIds')).toHaveLength(0);
        expect(titles()).toContain('Quarterly plan');
    });

    test('a private window\'s palette does not ask for them', async () => {
        data.tabs = [Object.assign({}, CURRENT, { incognito: true })].concat(TABS.slice(1));
        await open();
        expect(sentAll('getPeerTabs')).toHaveLength(0);
        expect(headings()).toEqual([]);
    });
});

describe('actions', () => {
    async function openActions() {
        await open();
        f.press('<Tab>', { target: input() });
        await f.settle();
    }

    test('Tab on an empty input lists the 28 actions under an Actions chip', async () => {
        await openActions();
        expect(titles()).toEqual([
            'Copy URL', 'Copy URL as Markdown', 'Reload', 'Duplicate Tab', 'Pin / Unpin Tab',
            'Mute / Unmute Tab', 'Close Tab', 'Close Other Tabs', 'Close Tabs to the Right',
            'Close Tabs to the Left', 'Reopen Closed Tab', 'Move Tab to New Window', 'Move Tab to Window…',
            'Gather All Windows', 'Switch Profile…', 'Zoom In', 'Zoom Out', 'Reset Zoom', 'View Source', 'Change Theme…',
            'Auto Theme (Follow System Light / Dark)', 'Settings…', 'Settings: Appearance', 'Settings: Keys', 'Settings: Sites',
            'Disable / Enable Surfingkeys on This Site', 'Keyboard Shortcuts…', 'Show All Key Mappings',
        ]);
        expect(prompt().textContent).toBe('Actions');
        expect(prompt().classList.contains('sk_palette_chip')).toBe(true);
        expect(input().placeholder).toBe('Search actions…');
        expect(hint().textContent).toBe('');
        expect(rowTitled('Close Tab').querySelector('kbd').textContent).toBe('x');
    });

    test('Tab with text typed moves through the rows instead', async () => {
        await open();
        await type('inbox');
        f.press('<Tab>', { target: input() });
        expect(prompt().textContent).toBe('');
    });

    test('filters by name and by the extra words', async () => {
        await openActions();
        await type('dark');
        expect(titles()).toEqual(['Change Theme…', 'Auto Theme (Follow System Light / Dark)']);
        await type('undo');
        expect(titles()).toEqual(['Reopen Closed Tab']);
    });

    test('Backspace on an empty input leaves the actions', async () => {
        await openActions();
        const [down] = f.press('<Backspace>', { target: input() });
        expect(down.defaultPrevented).toBe(true);
        expect(prompt().textContent).toBe('');
        expect(prompt().classList.contains('sk_palette_chip')).toBe(false);
        expect(titleOf(lis()[0])).toBe('Kế hoạch tuần');
    });

    test('Enter runs the focused action and closes', async () => {
        await openActions();
        await type('duplicate');
        f.press('<Enter>', { target: input() });
        expect(sentAll('duplicateTab')).toHaveLength(1);
        expect(ui().style.display).toBe('none');
    });

    test.each([
        ['Duplicate Tab', 'duplicateTab', {}],
        ['Pin / Unpin Tab', 'togglePinTab', {}],
        ['Mute / Unmute Tab', 'muteTab', {}],
        ['Close Other Tabs', 'tabOnly', {}],
        ['Close Tabs to the Right', 'closeTabsToRight', {}],
        ['Close Tabs to the Left', 'closeTabsToLeft', {}],
        ['Reopen Closed Tab', 'openLast', {}],
        ['Move Tab to New Window', 'moveToWindow', { windowId: -1 }],
        ['Gather All Windows', 'gatherWindows', {}],
        ['View Source', 'viewSource', { tab: { tabbed: true } }],
    ])('%s sends %s', async (name, action, args) => {
        await openActions();
        rowTitled(name).onclick();
        expect(sentOne(action)).toEqual(expect.objectContaining(args));
    });

    test.each([
        ['Close Tab', 'closeTab', {}],
        ['Reload', 'reloadTab', { nocache: false }],
        ['Zoom In', 'setZoom', { zoomFactor: 0.1 }],
        ['Zoom Out', 'setZoom', { zoomFactor: -0.1 }],
        ['Reset Zoom', 'setZoom', { zoomFactor: 0 }],
    ])('%s acts once whatever count was pending', async (name, action, args) => {
        await openActions();
        RUNTIME.repeats = 0;
        rowTitled(name).onclick();
        expect(sentOne(action)).toEqual(expect.objectContaining(Object.assign({ repeats: 1 }, args)));
    });

    test('Copy URL copies the current tab\'s URL, as Markdown too', async () => {
        await openActions();
        rowTitled('Copy URL').onclick();
        expect(f.board.text).toBe(CURRENT.url);
        await openActions();
        rowTitled('Copy URL as Markdown').onclick();
        expect(f.board.text).toBe(`[${CURRENT.title}](${CURRENT.url})`);
    });

    test('Move Tab to Window… opens the window list once the palette is gone', async () => {
        jest.useFakeTimers();
        try {
            f.answers.getWindows = () => ({ windows: [{ id: 2, tabs: [{ title: 'Other', url: 'https://other.test/' }] }] });
            await openActions();
            rowTitled('Move Tab to Window…').onclick();
            expect(ui().style.display).toBe('none');
            jest.advanceTimersByTime(100);
            await f.settle();
            expect(ui().style.display).toBe('');
            expect(ui().classList.contains('sk_palette')).toBe(false);
            expect(prompt().textContent).toMatch(/^Move current tab to window/);
        } finally {
            jest.useRealTimers();
        }
    });

    test('Change Theme… opens the theme list once the palette is gone', async () => {
        jest.useFakeTimers();
        try {
            await openActions();
            rowTitled('Change Theme…').onclick();
            expect(ui().style.display).toBe('none');
            jest.advanceTimersByTime(100);
            await f.settle();
            expect(ui().style.display).toBe('');
            expect(ui().classList.contains('sk_palette')).toBe(false);
            expect(input().placeholder).toBe('Search themes…');
        } finally {
            jest.useRealTimers();
        }
    });

    test('Switch Profile… opens the profile list once the palette is gone', async () => {
        jest.useFakeTimers();
        try {
            f.answers.getProfiles = () => ({ profiles: [
                { dir: 'Default', name: 'Person 1', email: '' },
                { dir: 'Profile 1', name: 'Work', email: 'ann@example.com' },
            ] });
            await openActions();
            rowTitled('Switch Profile…').onclick();
            expect(ui().style.display).toBe('none');
            jest.advanceTimersByTime(100);
            await f.settle();
            expect(ui().style.display).toBe('');
            expect(ui().classList.contains('sk_palette')).toBe(false);
            expect(input().placeholder).toBe('Switch to profile…');
            expect(lis().map((li) => li.querySelector('.title').textContent)).toEqual(['Person 1', 'Work']);
            // nothing is opened until a row is picked
            expect(sentAll('openProfile')).toHaveLength(0);

            await type('work');
            f.press('<Enter>', { target: input() });
            // open until the browser has taken it
            expect(sentOne('openProfile')).toEqual(expect.objectContaining({ profile: 'Profile 1' }));
            expect(ui().style.display).toBe('');
            f.held.find((h) => h.message.action === 'openProfile').respond({ profile: 'Profile 1' });
            await f.settle();
            expect(ui().style.display).toBe('none');
        } finally {
            jest.useRealTimers();
            delete f.answers.getProfiles;
        }
    });
});

describe('keys typed in the page before the palette had focus', () => {
    // the top frame hands them over through the background (tabSwitcherPaletteTypeAhead),
    // which sends them to the tab as a runtime message
    const typeAhead = async (keys) => {
        f.deliver(Object.assign({ subject: 'paletteTypeAhead' }, keys));
        await f.settle();
    };

    test('go in front of what reached the input', async () => {
        await open();
        await type('box');
        await typeAhead({ text: 'in' });
        expect(input().value).toBe('inbox');
        expect(titleOf(focused())).toBe('Inbox');
    });

    test('then Enter runs on the result', async () => {
        await open();
        await typeAhead({ text: 'inbox', then: 'Enter' });
        expect(sentOne('focusTab').tabId).toBe(3);
        expect(ui().style.display).toBe('none');
    });

    test('then Shift-Enter flips new tab / current tab', async () => {
        await open();
        await typeAhead({ text: 'best pizza', then: 'Enter', shift: true });
        expect(sentOne('openLink').tab).toEqual({ tabbed: false, active: true });
    });

    test('then Escape closes', async () => {
        await open();
        await typeAhead({ text: 'x', then: 'Escape' });
        expect(ui().style.display).toBe('none');
    });

    test('then Tab lists the actions, also when it comes before the tab list', async () => {
        delete f.answers.tabSwitcherTabs;
        await open();
        await typeAhead({ text: '', then: 'Tab' });
        // the mode switches at once (the rows are drawn with the tab list)
        expect(prompt().textContent).toBe('Actions');
        // and the list arriving later leaves it there
        f.held.find((h) => h.message.action === 'tabSwitcherTabs').respond({ tabs: TABS });
        await f.settle();
        expect(prompt().textContent).toBe('Actions');
        expect(lis()).toHaveLength(28);
    });

    test('posted by the page over window.postMessage, they do nothing', async () => {
        await open();
        f.post({ action: 'paletteTypeAhead', text: 'inbox', then: 'Enter' });
        await f.settle();
        expect(input().value).toBe('');
        expect(sentAll('focusTab')).toHaveLength(0);
        expect(isOpen()).toBe(true);
    });

    describe('arriving while the palette is closed', () => {
        const T0 = 1700000000000;
        let now;
        beforeEach(() => {
            now = T0;
            jest.spyOn(Date, 'now').mockImplementation(() => now);
        });
        afterEach(() => {
            Date.now.mockRestore();
        });

        // they take another road than the open and can overtake it
        test('run once the open lands within a second', async () => {
            await typeAhead({ text: 'inbox', then: 'Enter' });
            expect(f.sent).toEqual([]);
            expect(ui().style.display).toBe('none');
            now = T0 + 999;
            await open();
            expect(sentOne('focusTab').tabId).toBe(3);
            expect(ui().style.display).toBe('none');
        });

        test('are dropped when no open follows within a second', async () => {
            await typeAhead({ text: 'inbox', then: 'Enter' });
            expect(f.sent).toEqual([]);
            expect(ui().style.display).toBe('none');
            now = T0 + 1000;
            await open();
            expect(isOpen()).toBe(true);
            expect(input().value).toBe('');
            expect(sentAll('focusTab')).toHaveLength(0);
        });

        test('are not typed into another omnibar that is shown', async () => {
            f.post({ action: 'openOmnibar', type: 'Themes' });
            await f.settle();
            await typeAhead({ text: 'inbox', then: 'Enter' });
            expect(input().value).toBe('');
            expect(sentAll('focusTab')).toHaveLength(0);
            expect(ui().style.display).toBe('');
            f.Front.hidePopup();
            await f.settle();
            // and are gone by the time a later palette opens
            now = T0 + 1000;
            await open();
            expect(input().value).toBe('');
            expect(sentAll('focusTab')).toHaveLength(0);
        });
    });
});

describe('the default search alias removed', () => {
    const DDG = { alias: 'd', prompt: 'duckduckgo', url: 'https://duckduckgo.com/?q=' };

    // an exception in the input handler is kept as the test's failure, not
    // reported as one outside it
    async function withoutGoogle(others, body) {
        const thrown = [];
        const keep = (e) => {
            e.preventDefault();
            thrown.push(e.error);
        };
        window.addEventListener('error', keep);
        others.forEach((engine) => f.post(Object.assign({ action: 'addSearchAlias' }, engine)));
        f.post({ action: 'removeSearchAlias', alias: 'g' });
        try {
            await body();
            expect(thrown).toEqual([]);
        } finally {
            window.removeEventListener('error', keep);
            others.forEach((engine) => f.post({ action: 'removeSearchAlias', alias: engine.alias }));
            f.post(Object.assign({ action: 'addSearchAlias' }, GOOGLE));
        }
    }

    test('typing still lists matches, and searches with the first engine left', async () => {
        await withoutGoogle([DDG], async () => {
            await open();
            await type('figma');
            expect(titles()).toContain('Figma — design');
            await type('best pizza');
            expect(lis().map((li) => li.url)).toContain('https://duckduckgo.com/?q=best%20pizza');
            f.press('<Enter>', { target: input() });
            expect(sentOne('openLink')).toEqual(expect.objectContaining({ url: 'https://duckduckgo.com/?q=best%20pizza' }));
        });
    });

    test('with no engine left, typing lists matches and Enter opens no search', async () => {
        await withoutGoogle([], async () => {
            await open();
            await type('figma');
            expect(titles()).toContain('Figma — design');
            await type('best pizza');
            expect(lis()).toEqual([]);
            f.press('<Enter>', { target: input() });
            expect(sentAll('openLink')).toEqual([]);
        });
    });
});

describe('Tab before the tab list', () => {
    test('Tab pressed before the tab list arrives lists the actions', async () => {
        delete f.answers.tabSwitcherTabs;
        await open();
        const [down] = f.press('<Tab>', { target: input() });
        expect(down.defaultPrevented).toBe(true);
        expect(prompt().textContent).toBe('Actions');
        f.held.find((h) => h.message.action === 'tabSwitcherTabs').respond({ tabs: TABS });
        await f.settle();
        expect(prompt().textContent).toBe('Actions');
        // what is typed next filters the actions, not the tabs
        await type('duplicate');
        expect(titles()).toEqual(['Duplicate Tab']);
    });
});
