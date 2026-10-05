// The new tab page as the pages that lead to it see it (common/newTabPage.js):
// the note the page leaves when it opens as the browser's new tab, the wait for
// it before the page moves on (newtab/page.js), which builds ship the page, and
// the help page's link to its setup (start.js).
import fs from 'fs';
import path from 'path';

// the browser, and so the build, the page runs in (jsdom's user agent names none)
let mockBrowserName = 'Chrome';
jest.mock('../../src/content_scripts/common/browserName.js', () => ({getBrowserName: () => mockBrowserName}));
// marked is an ES module jest does not load; the guide's list items and links
// are all these tests read
jest.mock('marked', () => ({marked: {parse: (md) => md.split('\n').filter((l) => l.startsWith('* '))
    .map((l) => `<li>${l.slice(2).replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')}</li>`).join('')}}));

const START_HTML = fs.readFileSync(path.join(__dirname, '../../src/pages/start.html'), 'utf8');
const NEWTAB_HTML = fs.readFileSync(path.join(__dirname, '../../src/pages/newtab.html'), 'utf8');
const GUIDE = START_HTML.match(/<template id="quickIntroSource">([\s\S]*?)<\/template>/)[1];
const PAGE = 'chrome-extension://surfingkeys/pages/newtab.html';

// what these pages reach: chrome.tabs.getCurrent (`getCurrent`, null for none),
// the background (`answers` by action) and storage
function mockChrome({getCurrent, answers = {}} = {}) {
    global.chrome = {
        runtime: {
            id: 'surfingkeys',
            lastError: undefined,
            getManifest: () => ({version: '1.2.3'}),
            getURL: (p) => `chrome-extension://surfingkeys/${p.replace(/^\//, '')}`,
            sendMessage: jest.fn((message, cb) => {
                const answer = answers[message.action];
                cb && answer && cb(answer(message));
            }),
            onMessage: {addListener: jest.fn()},
        },
        tabs: getCurrent === null ? {create: jest.fn()} : {create: jest.fn(), getCurrent: jest.fn(getCurrent || (() => {}))},
        storage: {local: {get: jest.fn((keys, cb) => cb({}))}, onChanged: {addListener: jest.fn()}},
    };
}

function load(file) {
    let mod;
    jest.isolateModules(() => {
        mod = require(`../../src/content_scripts/${file}`);
    });
    return mod;
}

let common;
beforeEach(() => {
    window.localStorage.clear();
    mockBrowserName = 'Chrome';
    mockChrome();
    common = load('common/newTabPage.js');
});
afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

const answering = (url) => (cb) => cb({id: 5, url});

describe('the new tab address', () => {
    test.each(['chrome://newtab/', 'chrome://newtab', 'CHROME://NEWTAB/'])('%p is the browser\'s new tab', (url) => {
        expect(common.isBrowserNewTab(url)).toBe(true);
    });

    test.each([PAGE, `${PAGE}?focus`, 'chrome://new-tab-page/', 'chrome://newtab/x', 'https://newtab.example/', 'about:blank', '', undefined])('%p is not', (url) => {
        expect(common.isBrowserNewTab(url)).toBe(false);
    });
});

describe('noting the page as the new tab', () => {
    test('notes the time when the browser shows the page as its new tab, then goes on', () => {
        mockChrome({getCurrent: answering('chrome://newtab/')});
        jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
        const done = jest.fn();
        common.noteIfNewTab(done);
        expect(done).toHaveBeenCalledTimes(1);
        expect(window.localStorage.getItem(common.SEEN_KEY)).toBe('1700000000000');
        expect(common.lastSeenAsNewTab()).toBe(1700000000000);
    });

    test.each([PAGE, `${PAGE}?a=1`])('notes nothing for the page opened any other way: %p', (url) => {
        mockChrome({getCurrent: answering(url)});
        const done = jest.fn();
        common.noteIfNewTab(done);
        expect(done).toHaveBeenCalledTimes(1);
        expect(common.lastSeenAsNewTab()).toBeNull();
    });

    test('notes nothing when the browser answers with an error', () => {
        mockChrome({getCurrent: (cb) => {
            chrome.runtime.lastError = {message: 'No current tab'};
            cb(undefined);
            chrome.runtime.lastError = undefined;
        }});
        const done = jest.fn();
        common.noteIfNewTab(done);
        expect(done).toHaveBeenCalledTimes(1);
        expect(common.lastSeenAsNewTab()).toBeNull();
    });

    test('never waits longer than SEEN_WAIT_MS, and still notes an answer that comes later', () => {
        jest.useFakeTimers();
        let answer;
        mockChrome({getCurrent: (cb) => {
            answer = cb;
        }});
        const done = jest.fn();
        common.noteIfNewTab(done);
        jest.advanceTimersByTime(common.SEEN_WAIT_MS - 1);
        expect(done).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(done).toHaveBeenCalledTimes(1);
        answer({url: 'chrome://newtab/'});
        expect(done).toHaveBeenCalledTimes(1);
        expect(common.lastSeenAsNewTab()).not.toBeNull();
    });

    test('goes on at once where there is no chrome.tabs to ask', () => {
        mockChrome({getCurrent: null});
        const done = jest.fn();
        common.noteIfNewTab(done);
        expect(done).toHaveBeenCalledTimes(1);
        expect(common.lastSeenAsNewTab()).toBeNull();
    });

    test('goes on with storage blocked', () => {
        mockChrome({getCurrent: answering('chrome://newtab/')});
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        const done = jest.fn();
        common.noteIfNewTab(done);
        expect(done).toHaveBeenCalledTimes(1);
        expect(common.lastSeenAsNewTab()).toBeNull();
    });
});

describe('the new tab page', () => {
    function boot() {
        document.documentElement.innerHTML = NEWTAB_HTML.replace(/^[\s\S]*?<html[^>]*>/, '').replace(/<\/html>[\s\S]*$/, '').replace(/<script[^>]*><\/script>/g, '');
        return load('newtab/page.js');
    }

    test('goes on to itself with the marker once the browser has answered, and does nothing else', () => {
        let answer;
        mockChrome({getCurrent: (cb) => {
            answer = cb;
        }});
        const page = boot();
        const loc = {search: '', href: PAGE, replace: jest.fn()};
        expect(page.startNewTab(loc, document)).toBe(false);
        expect(chrome.tabs.getCurrent).toHaveBeenCalledTimes(1);
        expect(loc.replace).not.toHaveBeenCalled();
        answer({url: 'chrome://newtab/'});
        expect(loc.replace).toHaveBeenCalledWith(`${PAGE}?focus`);
        expect(common.lastSeenAsNewTab()).not.toBeNull();
        expect(document.querySelectorAll('script[src="../content.js"]')).toHaveLength(0);
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
    });

    test('opened with the marker (Preview, the startup page), it stays and asks nothing', () => {
        mockChrome({getCurrent: answering('chrome://newtab/')});
        const page = boot();
        const loc = {search: '?focus', href: `${PAGE}?focus`, replace: jest.fn()};
        expect(page.startNewTab(loc, document)).toBe(true);
        expect(loc.replace).not.toHaveBeenCalled();
        expect(chrome.tabs.getCurrent).not.toHaveBeenCalled();
        expect(common.lastSeenAsNewTab()).toBeNull();
    });
});

describe('which builds ship the page', () => {
    test.each([['Chrome', true], ['Firefox', false], ['Safari', false], ['Safari-iOS', false]])('%s: %p', (browser, ships) => {
        mockBrowserName = browser;
        expect(common.shipsNewTabPage()).toBe(ships);
    });
});

describe('the help page', () => {
    test('the quick guide links to the setup, and a build without the page leaves only that line out', () => {
        expect(common.guideForBuild(GUIDE, true)).toBe(GUIDE);
        const without = common.guideForBuild(GUIDE, false);
        expect(GUIDE).toContain('](options.html#newtab)');
        expect(without).not.toContain('newtab');
        expect(without.split('\n')).toEqual(GUIDE.split('\n').filter((l) => !l.includes('options.html#newtab')));
        expect(without.split('\n')).toHaveLength(GUIDE.split('\n').length - 1);
    });

    function openHelp(browser) {
        mockBrowserName = browser;
        mockChrome({answers: {getTopSites: () => ({urls: []})}});
        document.documentElement.innerHTML = START_HTML.replace(/^[\s\S]*?<html[^>]*>/, '').replace(/<\/html>[\s\S]*$/, '').replace(/<script[^>]*><\/script>/g, '');
        window.history.replaceState(null, '', '/pages/start.html');
        load('start.js');
        return Array.from(document.querySelectorAll('#quickIntro li'));
    }

    test('shows the link in the Chromium build', () => {
        const items = openHelp('Chrome');
        const link = document.querySelector('#quickIntro a[href="options.html#newtab"]');
        expect(link.textContent).toBe('New tab page');
        expect(items.map((li) => li.textContent)).toContain('New tab page: your bookmarks bar and top sites, with Surfingkeys\' keys, on every new tab (Helium) or when the browser starts.');
        expect(document.getElementById('welcomeNewTab').hidden).toBe(false);
    });

    test.each(['Firefox', 'Safari', 'Safari-iOS'])('leaves it out in %s, and nothing else', (browser) => {
        const withLink = openHelp('Chrome').length;
        const items = openHelp(browser);
        expect(document.querySelector('#quickIntro a[href="options.html#newtab"]')).toBeNull();
        expect(items).toHaveLength(withLink - 1);
        expect(document.getElementById('welcomeNewTab').hidden).toBe(true);
    });
});
