// The browser adapters start() is booted with (src/background/chrome.js and
// firefox.js): where the settings come from when local and sync storage
// disagree, the PAC script the proxy settings turn into, and how history is
// searched. start() itself is replaced, so loading an adapter only hands its
// object over.
import { createChromeMock } from './chromeMock.js';

jest.mock('../../src/background/start.js', () => Object.assign({}, jest.requireActual('../../src/background/start.js'), {
    start: jest.fn(),
}));
jest.mock('../../src/background/nvim.js', () => ({ createNvimServer: jest.fn(() => 'nvim server') }));
jest.mock('../../src/background/tabSwitcher.js', () => ({ __esModule: true, default: jest.fn() }));

const { start } = require('../../src/background/start.js');
require('../../src/background/chrome.js');
require('../../src/background/firefox.js');
// taken now: the jest config clears mock calls before every test
const [[chromeAdapter], [firefoxAdapter]] = start.mock.calls;

let chrome;
beforeEach(() => {
    chrome = createChromeMock();
    global.chrome = chrome;
});

// chrome.runtime.lastError is set only while the callback runs, as in Chrome
function failWrites(area, message) {
    area.set = jest.fn((items, cb) => {
        chrome.runtime.lastError = { message };
        try {
            cb && cb();
        } finally {
            chrome.runtime.lastError = undefined;
        }
    });
}

function load(adapter, keys, defaults) {
    const cb = jest.fn();
    adapter.loadRawSettings(keys, cb, defaults);
    return cb;
}

describe('the Chrome adapter', () => {
    test('boots start() as Chrome, with the tab switcher as its extension', () => {
        expect(chromeAdapter).toEqual(expect.objectContaining({
            name: 'Chrome',
            detectTabTitleChange: true,
            nvimServer: 'nvim server',
            extendBackground: require('../../src/background/tabSwitcher.js').default,
        }));
        expect(chromeAdapter._setNewTabUrl()).toBe('chrome://newtab/');
        expect(chromeAdapter._getContainerName()).toBeUndefined();
    });

    describe('loadRawSettings', () => {
        test('local saved later wins, over the defaults, and is copied to sync', () => {
            chrome.storage.local.data.savedAt = 20;
            Object.assign(chrome.storage.local.data, { theme: 'nord', smoothScroll: false });
            Object.assign(chrome.storage.sync.data, { savedAt: 10, theme: 'old' });
            const cb = load(chromeAdapter, ['theme', 'smoothScroll', 'hintAlign'], { hintAlign: 'center', theme: 'none' });
            expect(cb).toHaveBeenCalledWith({ theme: 'nord', smoothScroll: false, hintAlign: 'center' });
            expect(chrome.storage.sync.data).toEqual({ savedAt: 20, theme: 'nord', smoothScroll: false });
        });

        test('local saved later: a failed sync write is reported with the settings', () => {
            Object.assign(chrome.storage.local.data, { savedAt: 20, theme: 'nord' });
            failWrites(chrome.storage.sync, 'QUOTA_BYTES quota exceeded');
            const cb = load(chromeAdapter, ['theme']);
            expect(cb).toHaveBeenCalledWith({
                theme: 'nord',
                error: 'Settings sync may not work thoroughly because of: QUOTA_BYTES quota exceeded',
            });
        });

        test('local saved later: the snippets file stays out of sync', () => {
            Object.assign(chrome.storage.local.data, {
                savedAt: 20, theme: 'nord', localPath: 'http://localhost/sk.js', snippets: 'mapkey()',
            });
            const cb = load(chromeAdapter, null);
            expect(cb.mock.calls[0][0]).toEqual(expect.objectContaining({ localPath: 'http://localhost/sk.js', snippets: 'mapkey()' }));
            expect(chrome.storage.sync.data).toEqual({ savedAt: 20, theme: 'nord' });
        });

        // _save() strips localPath and snippets before writing to sync and skips a
        // write left with savedAt alone: it must still call back, or these settings
        // are never answered
        test('local saved later with only a snippets file still answers', () => {
            Object.assign(chrome.storage.local.data, { savedAt: 20, localPath: 'http://localhost/sk.js', snippets: 'mapkey()' });
            const cb = load(chromeAdapter, ['localPath']);
            expect(cb).toHaveBeenCalledWith({ localPath: 'http://localhost/sk.js' });
        });

        test('sync saved later wins and is copied to local, keeping this machine\'s localPath', () => {
            Object.assign(chrome.storage.local.data, { savedAt: 10, theme: 'old', localPath: 'file:///mine.js' });
            Object.assign(chrome.storage.sync.data, { savedAt: 30, theme: 'nord', localPath: 'file:///other-machine.js' });
            const cb = load(chromeAdapter, ['theme']);
            expect(cb).toHaveBeenCalledWith({ theme: 'nord' });
            expect(chrome.storage.local.data).toEqual({ savedAt: 30, theme: 'nord', localPath: 'file:///mine.js' });
        });

        test('saved at the same time: local, and nothing is written', () => {
            Object.assign(chrome.storage.local.data, { savedAt: 10, theme: 'local' });
            Object.assign(chrome.storage.sync.data, { savedAt: 10, theme: 'sync' });
            const cb = load(chromeAdapter, 'theme');
            expect(cb).toHaveBeenCalledWith({ theme: 'local' });
            expect(chrome.storage.local.set).not.toHaveBeenCalled();
            expect(chrome.storage.sync.set).not.toHaveBeenCalled();
        });

        test('a fresh profile gets the defaults', () => {
            const cb = load(chromeAdapter, null, { theme: 'none' });
            expect(cb).toHaveBeenCalledWith({ theme: 'none' });
        });
    });

    describe('_applyProxySettings', () => {
        // the PAC script as Chrome runs it: its own global scope, FindProxyForURL(url, host)
        function pac() {
            const [{ value, scope }] = chrome.proxy.settings.set.mock.calls[0];
            expect(scope).toBe('regular');
            expect(value.mode).toBe('pac_script');
            // eslint-disable-next-line no-new-func
            return new Function(`${value.pacScript.data}; return FindProxyForURL;`)();
        }

        test.each([undefined, 'clear'])('proxyMode %s clears the proxy', (proxyMode) => {
            chromeAdapter._applyProxySettings({ proxyMode });
            expect(chrome.proxy.settings.clear).toHaveBeenCalledWith({ scope: 'regular' });
            expect(chrome.proxy.settings.set).not.toHaveBeenCalled();
        });

        test('always: every host through the first proxy', () => {
            chromeAdapter._applyProxySettings({ proxyMode: 'always', proxy: ['PROXY a:1'], autoproxy_hosts: [[]] });
            const find = pac();
            expect(find('https://x.test/', 'x.test')).toBe('PROXY a:1');
        });

        test('byhost: listed hosts, their subdomains and patterns through their proxy, the rest direct', () => {
            chromeAdapter._applyProxySettings({
                proxyMode: 'byhost',
                proxy: ['PROXY one:1', 'SOCKS5 two:2'],
                autoproxy_hosts: [['example.com', '.*\\.google\\.com'], ['other.test']],
            });
            const find = pac();
            expect(find('', 'example.com')).toBe('PROXY one:1');
            expect(find('', 'a.b.example.com')).toBe('PROXY one:1');
            expect(find('', 'mail.google.com')).toBe('PROXY one:1');
            expect(find('', 'other.test')).toBe('SOCKS5 two:2');
            expect(find('', 'www.other.test')).toBe('SOCKS5 two:2');
            expect(find('', 'notexample.com')).toBe('DIRECT');
            expect(find('', 'google.com')).toBe('DIRECT');
        });

        test('bypass: listed hosts and their subdomains direct, the rest through the proxy', () => {
            chromeAdapter._applyProxySettings({
                proxyMode: 'bypass',
                proxy: ['PROXY one:1'],
                autoproxy_hosts: [['intranet.test', '.*\\.local']],
            });
            const find = pac();
            expect(find('', 'intranet.test')).toBe('DIRECT');
            expect(find('', 'wiki.intranet.test')).toBe('DIRECT');
            expect(find('', 'printer.local')).toBe('DIRECT');
            expect(find('', 'example.com')).toBe('PROXY one:1');
        });

        test('bypass with no pattern does not match every host', () => {
            chromeAdapter._applyProxySettings({ proxyMode: 'bypass', proxy: ['PROXY one:1'], autoproxy_hosts: [['intranet.test']] });
            expect(pac()('', 'example.com')).toBe('PROXY one:1');
        });

        test('another mode (system, direct) is passed to Chrome as is', () => {
            chromeAdapter._applyProxySettings({ proxyMode: 'system', proxy: [], autoproxy_hosts: [] });
            expect(chrome.proxy.settings.set.mock.calls[0][0].value.mode).toBe('system');
        });
    });

    describe('getLatestHistoryItem', () => {
        const item = (title, lastVisitTime) => ({ title, url: `https://${title}.test/`, lastVisitTime });

        test('reads older pages until enough items match', () => {
            const pages = [
                [item('apple', 900)].concat(Array.from({ length: 19 }, (_, i) => item('plum' + i, 800 - i))),
                [item('pineapple', 500), item('grape', 400), item('applesauce', 300)],
            ];
            chrome.history.search = jest.fn((q, cb) => cb(pages.shift()));
            const cb = jest.fn();
            chromeAdapter.getLatestHistoryItem('a', 2, cb);
            // one letter: ten times as many as wanted, filtered here
            expect(chrome.history.search.mock.calls[0][0]).toEqual(expect.objectContaining({ startTime: 0, text: '', maxResults: 20 }));
            expect(chrome.history.search.mock.calls[1][0].endTime).toBeCloseTo(782 - 0.01);
            expect(cb).toHaveBeenCalledWith([expect.objectContaining({ title: 'apple' }), expect.objectContaining({ title: 'pineapple' })]);
        });

        test('stops when history runs out', () => {
            chrome.history.search = jest.fn((q, cb) => cb([item('kiwi', 5)]));
            const cb = jest.fn();
            chromeAdapter.getLatestHistoryItem('zz', 3, cb);
            expect(chrome.history.search).toHaveBeenCalledTimes(1);
            expect(chrome.history.search.mock.calls[0][0].maxResults).toBe(300);
            expect(cb).toHaveBeenCalledWith([]);
        });
    });
});

describe('the Firefox adapter', () => {
    test('boots start() as Firefox, with no tab switcher and no proxy', () => {
        expect(firefoxAdapter.name).toBe('Firefox');
        expect(firefoxAdapter.extendBackground).toBeUndefined();
        expect(firefoxAdapter._setNewTabUrl()).toBe('about:newtab');
        firefoxAdapter._applyProxySettings({ proxyMode: 'always' });
        expect(chrome.proxy.settings.set).not.toHaveBeenCalled();
    });

    test('loadRawSettings reads local storage only', () => {
        Object.assign(chrome.storage.local.data, { savedAt: 1, theme: 'nord' });
        Object.assign(chrome.storage.sync.data, { savedAt: 99, theme: 'sync' });
        const cb = load(firefoxAdapter, ['theme', 'hintAlign'], { hintAlign: 'left' });
        expect(cb).toHaveBeenCalledWith({ theme: 'nord', hintAlign: 'left' });
        expect(chrome.storage.sync.get).not.toHaveBeenCalled();
    });

    test('getLatestHistoryItem lets history search', () => {
        chrome.history.search = jest.fn((q, cb) => cb([{ url: 'https://a.test/' }]));
        const cb = jest.fn();
        firefoxAdapter.getLatestHistoryItem('a', 5, cb);
        expect(chrome.history.search).toHaveBeenCalledWith({ startTime: 0, text: 'a', maxResults: 5 }, expect.any(Function));
        expect(cb).toHaveBeenCalledWith([{ url: 'https://a.test/' }]);
    });

    test.each([
        ['_getContainerName', { name: 'Work' }, { cookieStoreId: 'c1' }, 'get', { name: 'Work' }],
        ['_getContainers', [{ name: 'Work' }], {}, 'query', { containers: [{ name: 'Work' }] }],
    ])('%s answers from contextualIdentities', async (name, found, tab, method, answer) => {
        global.browser = { contextualIdentities: { [method]: jest.fn(() => Promise.resolve(found)) } };
        try {
            const sendResponse = jest.fn();
            const _response = (m, send, result) => send(result);
            firefoxAdapter[name]({}, _response)({}, { tab }, sendResponse);
            await Promise.resolve();
            await Promise.resolve();
            expect(sendResponse).toHaveBeenCalledWith(answer);
        } finally {
            delete global.browser;
        }
    });

    test('_getContainerName answers null when the container is gone', async () => {
        global.browser = { contextualIdentities: { get: jest.fn(() => Promise.reject(new Error('gone'))) } };
        try {
            const sendResponse = jest.fn();
            firefoxAdapter._getContainerName({}, (m, send, result) => send(result))({}, { tab: { cookieStoreId: 'x' } }, sendResponse);
            await Promise.resolve();
            await Promise.resolve();
            expect(sendResponse).toHaveBeenCalledWith({ name: null });
        } finally {
            delete global.browser;
        }
    });
});
