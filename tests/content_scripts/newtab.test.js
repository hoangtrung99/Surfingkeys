// The new tab page (pages/newtab.html, content_scripts/newtab/*), against its
// real markup.
import fs from 'fs';
import path from 'path';
import { PALETTES } from '../../src/content_scripts/common/themes.js';

const NEWTAB_HTML = fs.readFileSync(path.join(__dirname, '../../src/pages/newtab.html'), 'utf8');
const ORIGIN = 'chrome-extension://surfingkeys';
const PAGE = `${ORIGIN}/pages/newtab.html`;

function makeEvent() {
    const listeners = [];
    return {listeners, addListener: jest.fn((fn) => listeners.push(fn)), fire: (...args) => listeners.forEach((fn) => fn(...args))};
}

const bm = (id, title, url) => ({id, title, url});
const folder = (id, title, children, extra) => Object.assign({id, title, children}, extra);

// Chrome 134+: the local bar and an account bar, both marked bookmarks-bar
const TREE = [folder('0', '', [
    folder('1', 'Bookmarks bar', [
        bm('11', 'Local one', 'https://local.example/'),
        folder('12', 'Work', [
            bm('121', 'Docs', 'https://docs.example/'),
            folder('122', 'Deeper', [
                bm('1221', 'Deep', 'https://deep.example/'),
                folder('1222', 'Deepest', [bm('12221', 'Bottom', 'https://bottom.example/')]),
            ]),
            folder('123', 'Nothing', []),
        ]),
        bm('13', 'Settings', 'chrome://settings/'),
        bm('14', 'Bookmarklet', 'javascript:alert(1)'),
        bm('15', '', 'https://icon-only.example/'),
    ], {folderType: 'bookmarks-bar', syncing: false}),
    folder('2', 'Other bookmarks', [bm('21', 'Not on the bar', 'https://other.example/')], {folderType: 'other', syncing: false}),
    folder('30', 'Bookmarks bar', [bm('31', 'Account one', 'https://account.example/')], {folderType: 'bookmarks-bar', syncing: true}),
])];

// Every setup boots the page into the same jsdom document and window, so the
// listeners one test's page added are taken off before the next test boots its own.
const added = [];
function trackListeners() {
    [document, window].forEach((target) => {
        const add = target.addEventListener;
        jest.spyOn(target, 'addEventListener').mockImplementation(function(type, fn, opts) {
            added.push([target, type, fn, opts]);
            return add.call(this, type, fn, opts);
        });
    });
}

const bgOf = (id) => PALETTES[id].surface || PALETTES[id].bg;

function setup({tree = TREE, sites = [], storage = {}, cache, answerStorage = true, tabs = [{id: 5, index: 2, windowId: 1}]} = {}) {
    trackListeners();
    const local = Object.assign({}, storage);
    let currentTree = tree;
    global.chrome = {
        runtime: {
            id: 'surfingkeys',
            lastError: undefined,
            getURL: (p) => `${ORIGIN}${p}`,
            sendMessage: jest.fn(),
            onMessage: makeEvent(),
        },
        storage: {
            local: {
                get: jest.fn((keys, cb) => {
                    const picked = {};
                    [].concat(keys).forEach((k) => {
                        k in local && (picked[k] = local[k]);
                    });
                    answerStorage && cb(picked);
                }),
            },
            onChanged: makeEvent(),
        },
        bookmarks: {
            getTree: jest.fn((cb) => cb(currentTree)),
            onCreated: makeEvent(),
            onRemoved: makeEvent(),
            onChanged: makeEvent(),
            onMoved: makeEvent(),
            onChildrenReordered: makeEvent(),
            onImportBegan: makeEvent(),
            onImportEnded: makeEvent(),
        },
        topSites: {get: jest.fn((cb) => cb(sites))},
        tabs: {
            getCurrent: jest.fn((cb) => cb({id: 5, index: 2, windowId: 1})),
            query: jest.fn((query, cb) => cb(tabs.filter((t) => t.windowId === query.windowId))),
            update: jest.fn((...args) => args.find((a) => typeof a === 'function')()),
            create: jest.fn((props, cb) => cb && cb()),
        },
        windows: {create: jest.fn((props, cb) => cb && cb())},
    };
    localStorage.clear();
    cache && localStorage.setItem('sk_newtab_tokens', cache);
    document.documentElement.className = '';
    document.documentElement.innerHTML = NEWTAB_HTML.replace(/<script[^>]*><\/script>/g, '');
    const loc = {search: '?focus', href: `${PAGE}?focus`, replace: jest.fn()};
    let page, started;
    jest.isolateModules(() => {
        page = require('../../src/content_scripts/newtab/page.js');
        started = page.startNewTab(loc, document);
    });
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));
    return {page, started, loc, $, $$, setTree: (t) => {
        currentTree = t;
    }};
}

const barLabels = ($$) => $$('#sk_bar_items > li > .sk_bm').map((el) => el.textContent || el.getAttribute('aria-label'));
const button = ($$, text) => $$('button.sk_bm').find((b) => b.textContent === text);
const link = ($$, text) => $$('a.sk_bm').find((a) => a.textContent === text);
const ownEntries = (menu) => Array.from(menu.querySelectorAll(':scope > li > .sk_bm')).map((el) => el.textContent);
const click = (el, init) => el.dispatchEvent(new MouseEvent('click', Object.assign({bubbles: true, cancelable: true}, init)));

// jsdom cannot follow a link; a web link is the browser's to follow, so the
// test only records whether the page tried to stop it
function watchDefault() {
    const seen = [];
    const listener = (e) => {
        seen.push(e.defaultPrevented);
        e.preventDefault();
    };
    document.addEventListener('click', listener);
    document.addEventListener('auxclick', listener);
    return {seen, done: () => {
        document.removeEventListener('click', listener);
        document.removeEventListener('auxclick', listener);
    }};
}

afterEach(() => {
    jest.restoreAllMocks();
    added.splice(0).forEach(([target, type, fn, opts]) => target.removeEventListener(type, fn, opts));
    jest.useRealTimers();
    delete window.matchMedia;
});

describe('focus', () => {
    test('a page without the marker goes on to itself with it, and does nothing else', () => {
        const {page} = setup();
        chrome.storage.local.get.mockClear();
        chrome.bookmarks.getTree.mockClear();
        document.body.innerHTML = '';
        const loc = {search: '', href: PAGE, replace: jest.fn()};
        expect(page.startNewTab(loc, document)).toBe(false);
        expect(loc.replace).toHaveBeenCalledWith(`${PAGE}?focus`);
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
        expect(chrome.bookmarks.getTree).not.toHaveBeenCalled();
        expect(document.querySelector('script')).toBeNull();
    });

    test('a page with the marker stays, and loads Surfingkeys', () => {
        const {started, loc, $} = setup();
        expect(started).toBe(true);
        expect(loc.replace).not.toHaveBeenCalled();
        expect($('body > script').getAttribute('src')).toBe('../content.js');
    });

    test('the marker is a query parameter of its own, added to what the address has', () => {
        const {page} = setup();
        expect(page.hasFocusMarker('?focus')).toBe(true);
        expect(page.hasFocusMarker('?a=1&focus=')).toBe(true);
        expect(page.hasFocusMarker('')).toBe(false);
        expect(page.hasFocusMarker('?unfocus')).toBe(false);
        expect(page.focusUrl(`${PAGE}#top`)).toBe(`${PAGE}?focus#top`);
        expect(page.focusUrl(`${PAGE}?a=1`)).toBe(`${PAGE}?a=1&focus`);
    });
});

describe('top sites', () => {
    test('lists each site with its icon, a title as text', () => {
        const {$, $$} = setup({sites: [
            {url: 'https://a.example/', title: '<img src=x onerror="window.pwned=1">A'},
            {url: 'https://b.example/', title: ''},
        ]});
        expect($('#sk_top').hidden).toBe(false);
        const links = $$('#sk_top li > a');
        expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://a.example/', 'https://b.example/']);
        expect(links[0].textContent).toBe('<img src=x onerror="window.pwned=1">A');
        expect(links[1].textContent).toBe('https://b.example/');
        expect($$('#sk_top img').map((i) => i.getAttribute('src'))).toEqual([
            `${ORIGIN}/_favicon/?pageUrl=${encodeURIComponent('https://a.example/')}&size=48`,
            `${ORIGIN}/_favicon/?pageUrl=${encodeURIComponent('https://b.example/')}&size=48`,
        ]);
        expect(window.pwned).toBeUndefined();
    });

    test('hides the section with no sites', () => {
        const {$} = setup({sites: []});
        expect($('#sk_top').hidden).toBe(true);
    });
});

describe('bookmarks bar', () => {
    test('merges the bars, the account\'s first, and leaves the other folders out', () => {
        const {$$} = setup();
        expect(barLabels($$)).toEqual(['Account one', 'Local one', 'Work', 'Settings', 'Bookmarklet', 'https://icon-only.example/']);
        // an empty title shows the icon alone, as on Chrome's bar
        const iconOnly = $$('#sk_bar_items .sk_bm')[5];
        expect(iconOnly.querySelector('.sk_bm_title').textContent).toBe('');
        expect(iconOnly.querySelector('img').getAttribute('src'))
            .toBe(`${ORIGIN}/_favicon/?pageUrl=${encodeURIComponent('https://icon-only.example/')}&size=32`);
    });

    test('takes the folder with id 1 where the API marks no bar', () => {
        const {$$} = setup({tree: [folder('0', '', [
            folder('1', 'Bookmarks Bar', [bm('11', 'Old', 'https://old.example/')]),
            folder('2', 'Other Bookmarks', [bm('21', 'No', 'https://no.example/')]),
        ])]});
        expect(barLabels($$)).toEqual(['Old']);
    });

    test('says where bookmarks go when the bar is empty', () => {
        const {$$} = setup({tree: [folder('0', '', [folder('1', 'Bookmarks bar', [], {folderType: 'bookmarks-bar'})])]});
        expect($$('#sk_bar_items li').map((li) => li.textContent)).toEqual(['Bookmarks you add to the bookmarks bar show up here.']);
    });

    test('a folder opens a dropdown, a folder in it a submenu, and Esc closes them one by one', () => {
        const {$$} = setup();
        const work = button($$, 'Work');
        expect(work.getAttribute('aria-expanded')).toBe('false');
        click(work);
        expect(work.getAttribute('aria-expanded')).toBe('true');
        const menu = document.getElementById(work.getAttribute('aria-controls'));
        expect(Array.from(menu.querySelectorAll(':scope > li > .sk_bm')).map((el) => el.textContent))
            .toEqual(['Docs', 'Deeper', 'Nothing']);

        click(button($$, 'Deeper'));
        expect($$('.sk_menu')).toHaveLength(2);
        expect($$('.sk_menu')[1].textContent).toBe('DeepDeepest');
        // a third level: each menu lies inside the one it came from
        click(button($$, 'Deepest'));
        expect($$('.sk_menu').map(ownEntries)).toEqual([['Docs', 'Deeper', 'Nothing'], ['Deep', 'Deepest'], ['Bottom']]);
        expect(button($$, 'Deeper').getAttribute('aria-expanded')).toBe('true');
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        expect($$('.sk_menu')).toHaveLength(2);

        // another folder at the same depth replaces the submenu
        click(button($$, 'Nothing'));
        expect($$('.sk_menu')).toHaveLength(2);
        expect($$('.sk_menu')[1].textContent).toBe('(empty)');

        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        expect($$('.sk_menu')).toHaveLength(1);
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        expect($$('.sk_menu')).toHaveLength(0);
        expect(work.getAttribute('aria-expanded')).toBe('false');
        expect(work.hasAttribute('aria-controls')).toBe(false);
    });

    test('a submenu opens and closes as the pointer rests, not on a hint\'s mouseover', () => {
        jest.useFakeTimers();
        const {$$} = setup();
        click(button($$, 'Work'));
        const over = (el, type = 'pointerover') => el.dispatchEvent(new Event(type, {bubbles: true}));
        over(button($$, 'Deeper'), 'mouseover');
        jest.advanceTimersByTime(500);
        expect($$('.sk_menu')).toHaveLength(1);
        over(button($$, 'Deeper'));
        jest.advanceTimersByTime(100);
        expect($$('.sk_menu')).toHaveLength(1);
        jest.advanceTimersByTime(150);
        expect($$('.sk_menu').map(ownEntries)[1]).toEqual(['Deep', 'Deepest']);
        // on to a bookmark of the same menu: the submenu goes
        over(link($$, 'Docs'));
        jest.advanceTimersByTime(250);
        expect($$('.sk_menu')).toHaveLength(1);
    });

    test('a second click on a folder closes its menu', () => {
        const {$$} = setup();
        click(button($$, 'Work'));
        click(button($$, 'Work'));
        expect($$('.sk_menu')).toHaveLength(0);
    });

    // resting on it on the way to the click has opened it already
    test('a click on a folder in a menu opens its submenu, and never closes it', () => {
        jest.useFakeTimers();
        const {$$} = setup();
        click(button($$, 'Work'));
        button($$, 'Deeper').dispatchEvent(new Event('pointerover', {bubbles: true}));
        jest.advanceTimersByTime(250);
        expect($$('.sk_menu')).toHaveLength(2);
        click(button($$, 'Deeper'));
        expect($$('.sk_menu').map(ownEntries)).toEqual([['Docs', 'Deeper', 'Nothing'], ['Deep', 'Deepest']]);
        click(button($$, 'Deeper'));
        expect($$('.sk_menu')).toHaveLength(2);
        expect(button($$, 'Deeper').getAttribute('aria-expanded')).toBe('true');
        // a submenu below it stays open too
        click(button($$, 'Deepest'));
        click(button($$, 'Deeper'));
        expect($$('.sk_menu')).toHaveLength(3);
    });

    test('a click outside the menus and the entries closes every menu, one inside a menu does not', () => {
        const {$$, $} = setup();
        click(button($$, 'Work'));
        click(button($$, 'Deeper'));
        $$('.sk_menu')[0].dispatchEvent(new Event('pointerdown', {bubbles: true}));
        expect($$('.sk_menu')).toHaveLength(2);
        $('#content').dispatchEvent(new Event('pointerdown', {bubbles: true}));
        expect($$('.sk_menu')).toHaveLength(0);
    });

    test('a click on the bar\'s empty stretch closes every menu, one on its entries is left to the click', () => {
        const {$$, $} = setup();
        click(button($$, 'Work'));
        button($$, 'Work').dispatchEvent(new Event('pointerdown', {bubbles: true}));
        link($$, 'Local one').dispatchEvent(new Event('pointerdown', {bubbles: true}));
        expect($$('.sk_menu')).toHaveLength(1);
        $('#sk_bar_items').dispatchEvent(new Event('pointerdown', {bubbles: true}));
        expect($$('.sk_menu')).toHaveLength(0);
        click(button($$, 'Work'));
        $('#sk_bar').dispatchEvent(new Event('pointerdown', {bubbles: true}));
        expect($$('.sk_menu')).toHaveLength(0);
    });

    test('scrolling the page closes every menu; scrolling a menu closes only its submenus', () => {
        const {$$} = setup();
        click(button($$, 'Work'));
        click(button($$, 'Deeper'));
        $$('.sk_menu')[0].dispatchEvent(new Event('scroll'));
        expect($$('.sk_menu')).toHaveLength(1);
        // the document's scroll event bubbles to the window
        document.dispatchEvent(new Event('scroll', {bubbles: true}));
        expect($$('.sk_menu')).toHaveLength(0);
        expect(button($$, 'Work').getAttribute('aria-expanded')).toBe('false');
    });

    test('menu entries are links and buttons, so link hints reach them', () => {
        const {$$} = setup();
        click(button($$, 'Work'));
        const entries = $$('.sk_menu .sk_bm');
        expect(entries.map((el) => el.tagName)).toEqual(['A', 'BUTTON', 'BUTTON']);
        expect(entries[0].getAttribute('href')).toBe('https://docs.example/');
    });

    test('a bookmarklet is listed but disabled, and clicking it does nothing', () => {
        const {$$} = setup();
        const b = link($$, 'Bookmarklet');
        expect(b.getAttribute('aria-disabled')).toBe('true');
        expect(b.hasAttribute('href')).toBe(false);
        expect(b.title).toMatch(/cannot run on this page/);
        const watch = watchDefault();
        click(b);
        watch.done();
        expect(watch.seen).toEqual([true]);
        expect(chrome.tabs.update).not.toHaveBeenCalled();
        expect(chrome.tabs.create).not.toHaveBeenCalled();
    });

    test('leaves web links to the browser', () => {
        const {$$} = setup();
        const watch = watchDefault();
        click(link($$, 'Local one'));
        watch.done();
        expect(watch.seen).toEqual([false]);
        expect(chrome.tabs.update).not.toHaveBeenCalled();
    });

    test('opens a chrome:// bookmark through chrome.tabs: here, or in a new tab with Ctrl, Cmd or the middle button', () => {
        const {$$} = setup();
        const settings = link($$, 'Settings');
        expect(settings.getAttribute('href')).toBe('chrome://settings/');
        const watch = watchDefault();
        click(settings);
        expect(chrome.tabs.update).toHaveBeenCalledWith(5, {url: 'chrome://settings/'}, expect.any(Function));
        click(settings, {ctrlKey: true});
        expect(chrome.tabs.create).toHaveBeenLastCalledWith(
            {url: 'chrome://settings/', active: false, index: 3, openerTabId: 5}, expect.any(Function));
        click(settings, {metaKey: true, shiftKey: true});
        expect(chrome.tabs.create).toHaveBeenLastCalledWith(
            {url: 'chrome://settings/', active: true, index: 3, openerTabId: 5}, expect.any(Function));
        settings.dispatchEvent(new MouseEvent('auxclick', {bubbles: true, cancelable: true, button: 1}));
        expect(chrome.tabs.create).toHaveBeenCalledTimes(3);
        click(settings, {shiftKey: true});
        expect(chrome.windows.create).toHaveBeenCalledWith({url: 'chrome://settings/'}, expect.any(Function));
        watch.done();
        expect(watch.seen).toEqual([true, true, true, true, true]);
        expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    });

    // as the browser places the web links it opens from the page
    test('puts a new tab after the ones the page opened before, so a row of them keeps its order', () => {
        const tabs = [
            {id: 4, index: 1, windowId: 1, openerTabId: 5},  // before the page: not after it
            {id: 5, index: 2, windowId: 1},
            {id: 6, index: 3, windowId: 1, openerTabId: 5},
            {id: 7, index: 4, windowId: 1, openerTabId: 5},
            {id: 8, index: 5, windowId: 1},
            {id: 9, index: 0, windowId: 2, openerTabId: 5},
        ];
        const {$$} = setup({tabs});
        click(link($$, 'Settings'), {ctrlKey: true});
        expect(chrome.tabs.query).toHaveBeenCalledWith({windowId: 1}, expect.any(Function));
        expect(chrome.tabs.create).toHaveBeenLastCalledWith(
            {url: 'chrome://settings/', active: false, index: 5, openerTabId: 5}, expect.any(Function));
    });

    test('says so when the browser will not open one', () => {
        const {$, $$} = setup({tree: [folder('0', '', [
            folder('1', 'Bookmarks bar', [bm('11', 'Notes', 'file:///home/me/notes.txt')], {folderType: 'bookmarks-bar'}),
        ])]});
        chrome.tabs.update = jest.fn((id, props, cb) => {
            chrome.runtime.lastError = {message: 'Cannot navigate to a file URL without local file access.'};
            cb();
            chrome.runtime.lastError = undefined;
        });
        click(link($$, 'Notes'));
        expect($('#sk_status').textContent)
            .toBe('Could not open file:///home/me/notes.txt: Cannot navigate to a file URL without local file access.');
    });

    test('opens a top site that is a local file through chrome.tabs too', () => {
        const {$$} = setup({sites: [{url: 'file:///home/me/a.html', title: 'A file'}]});
        click($$('#sk_top a')[0]);
        expect(chrome.tabs.update).toHaveBeenCalledWith(5, {url: 'file:///home/me/a.html'}, expect.any(Function));
    });

    test('moves what does not fit into the "»" menu, cutting at a whole item', () => {
        // each bar item is 100px wide; the row ends at 330px, or at 280px once
        // the "»" button takes its room
        const rect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function() {
            if (this.id === 'sk_bar_items') {
                const right = document.getElementById('sk_bar_more').hidden ? 330 : 280;
                return {left: 0, right, top: 0, bottom: 30, width: right, height: 30};
            }
            if (this.parentElement && this.parentElement.id === 'sk_bar_items') {
                const i = Array.from(this.parentElement.children).indexOf(this);
                return {left: i * 100, right: (i + 1) * 100, top: 0, bottom: 30, width: 100, height: 30};
            }
            return rect.call(this);
        };
        try {
            const {$, $$} = setup();
            expect($('#sk_bar_more').hidden).toBe(false);
            expect($$('#sk_bar_items > li').map((li) => li.hidden)).toEqual([false, false, true, true, true, true]);
            const more = $('#sk_bar_more button');
            click(more);
            const menu = document.getElementById(more.getAttribute('aria-controls'));
            expect(Array.from(menu.querySelectorAll(':scope > li > .sk_bm')).map((el) => el.textContent))
                .toEqual(['Work', 'Settings', 'Bookmarklet', 'https://icon-only.example/']);
            // folders in it open as anywhere else
            click(Array.from(menu.querySelectorAll('button')).find((b) => b.textContent === 'Work'));
            expect($$('.sk_menu')).toHaveLength(2);
        } finally {
            Element.prototype.getBoundingClientRect = rect;
        }
    });

    test('places a menu under its folder, and submenus on one side while there is room', () => {
        // a 900x700 window, the "Work" folder at the bar's right end, every menu 200x100
        const rects = {
            Work: {left: 800, right: 860, top: 4, bottom: 30},
            Deeper: {left: 700, right: 892, top: 60, bottom: 86},
            Deepest: {left: 504, right: 696, top: 90, bottom: 116},
        };
        const rect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function() {
            if (this.classList.contains('sk_menu')) {
                return {left: 0, right: 200, top: 0, bottom: 100, width: 200, height: 100};
            }
            const r = this.tagName === 'BUTTON' && rects[this.textContent];
            return r ? Object.assign({width: r.right - r.left, height: r.bottom - r.top}, r) : rect.call(this);
        };
        const size = (name, value) => Object.defineProperty(document.documentElement, name, {configurable: true, get: () => value});
        size('clientWidth', 900);
        size('clientHeight', 700);
        try {
            const {$$} = setup();
            click(button($$, 'Work'));
            click(button($$, 'Deeper'));
            click(button($$, 'Deepest'));
            expect($$('.sk_menu').map((m) => [m.style.left, m.style.top])).toEqual([
                ['696px', '32px'],  // under the folder, kept inside the window
                ['500px', '55px'],  // no room on the right: to the left
                ['304px', '85px'],  // and on to the left, not back over the menus
            ]);
        } finally {
            Element.prototype.getBoundingClientRect = rect;
            delete document.documentElement.clientWidth;
            delete document.documentElement.clientHeight;
        }
    });

    test('keeps every item in the row when they fit', () => {
        const {$, $$} = setup();
        expect($('#sk_bar_more').hidden).toBe(true);
        expect($$('#sk_bar_items > li').every((li) => !li.hidden)).toBe(true);
    });

    test('draws itself again after bookmarks change elsewhere, once per burst', () => {
        jest.useFakeTimers();
        const {$$, setTree} = setup();
        setTree([folder('0', '', [folder('1', 'Bookmarks bar', [bm('11', 'New', 'https://new.example/')], {folderType: 'bookmarks-bar'})])]);
        chrome.bookmarks.getTree.mockClear();
        chrome.bookmarks.onCreated.fire('11', {});
        chrome.bookmarks.onMoved.fire('11', {});
        expect(barLabels($$)).toContain('Local one');
        jest.advanceTimersByTime(200);
        expect(chrome.bookmarks.getTree).toHaveBeenCalledTimes(1);
        expect(barLabels($$)).toEqual(['New']);
    });

    test('waits for an import to end before drawing again', () => {
        jest.useFakeTimers();
        const {$$} = setup();
        chrome.bookmarks.getTree.mockClear();
        chrome.bookmarks.onImportBegan.fire();
        chrome.bookmarks.onCreated.fire('x', {});
        jest.advanceTimersByTime(500);
        expect(chrome.bookmarks.getTree).not.toHaveBeenCalled();
        chrome.bookmarks.onImportEnded.fire();
        jest.advanceTimersByTime(200);
        expect(chrome.bookmarks.getTree).toHaveBeenCalledTimes(1);
        expect(barLabels($$)).toHaveLength(6);
    });
});

describe('theme', () => {
    test('wears the theme in use, and keeps its colours for the next tab', () => {
        const {$} = setup({storage: {paletteTheme: 'nord'}});
        expect($('#sk_page_tokens').textContent).toContain(`--bg:${bgOf('nord')};`);
        expect(document.documentElement.classList.contains('sk_ready')).toBe(true);
        expect(localStorage.getItem('sk_newtab_tokens')).toBe($('#sk_page_tokens').textContent);
    });

    test('paints in the kept colours before storage answers', () => {
        const kept = ':root{--bg:#123456;}';
        const {$} = setup({cache: kept, answerStorage: false});
        expect($('#sk_page_tokens').textContent).toBe(kept);
        expect(document.documentElement.classList.contains('sk_ready')).toBe(true);
    });

    test('stays hidden for a moment, not in the wrong colours, with nothing kept', () => {
        jest.useFakeTimers();
        setup({answerStorage: false});
        expect(document.documentElement.classList.contains('sk_ready')).toBe(false);
        jest.advanceTimersByTime(300);
        expect(document.documentElement.classList.contains('sk_ready')).toBe(true);
    });

    test('follows Auto: the side of the pair the system is on, as it changes', () => {
        const media = {matches: false, listeners: [], addEventListener: (type, fn) => media.listeners.push(fn)};
        window.matchMedia = jest.fn(() => media);
        const {$} = setup({storage: {paletteTheme: 'auto', paletteThemePair: {dark: 'nord', light: 'dawn'}}});
        expect($('#sk_page_tokens').textContent).toContain(`--bg:${bgOf('dawn')};`);
        media.matches = true;
        media.listeners.forEach((fn) => fn());
        expect($('#sk_page_tokens').textContent).toContain(`--bg:${bgOf('nord')};`);
        // a new pair, picked in the settings
        chrome.storage.onChanged.fire({paletteThemePair: {newValue: {dark: 'gruvbox', light: 'dawn'}}}, 'local');
        expect($('#sk_page_tokens').textContent).toContain(`--bg:${bgOf('gruvbox')};`);
    });

    test('follows a pick made elsewhere', () => {
        const {$} = setup({storage: {paletteTheme: 'nord'}});
        chrome.storage.onChanged.fire({paletteTheme: {newValue: 'latte'}}, 'local');
        expect($('#sk_page_tokens').textContent).toContain(`--bg:${bgOf('latte')};`);
        expect(localStorage.getItem('sk_newtab_tokens')).toContain(`--bg:${bgOf('latte')};`);
    });

    test('works on with storage blocked', () => {
        const getItem = Storage.prototype.getItem, setItem = Storage.prototype.setItem;
        Storage.prototype.getItem = () => {
            throw new Error('denied');
        };
        Storage.prototype.setItem = Storage.prototype.getItem;
        try {
            const {$} = setup({storage: {paletteTheme: 'nord'}});
            expect($('#sk_page_tokens').textContent).toContain(`--bg:${bgOf('nord')};`);
        } finally {
            Storage.prototype.getItem = getItem;
            Storage.prototype.setItem = setItem;
        }
    });
});
