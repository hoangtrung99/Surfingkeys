// Background side of the palette and the switcher (src/background/tabSwitcher.js):
// the most-recently-used list and how it survives a worker restart, the browser
// shortcuts, the tab thumbnails and their capture budget, and the relays.
import installTabSwitcher from '../../src/background/tabSwitcher.js';
import { start } from '../../src/background/start.js';
import { createBrowserStub, createChromeMock } from './chromeMock.js';

// the windows as the user sees them: window 1 focused, window 2 behind it
const TABS = [
    { id: 1, windowId: 1, active: false, title: 'One', url: 'https://one.test/', lastAccessed: 100 },
    { id: 2, windowId: 1, active: true, title: 'Two', url: 'https://two.test/', lastAccessed: 200 },
    { id: 3, windowId: 1, active: false, title: 'Three', url: '', pendingUrl: 'https://three.test/', lastAccessed: 300 },
    { id: 4, windowId: 2, active: true, title: 'Four', url: 'https://four.test/', lastAccessed: 400 },
    { id: 5, windowId: 1, active: false, title: 'Five', url: 'https://five.test/', lastAccessed: 50 },
];

let chrome, self, respond, sessionReads, pageAnswers;

// start.js's _response: the answer goes to the caller
const _response = (message, sendResponse, result) => sendResponse(result);

// chrome.runtime.lastError is set only while the callback runs, as in Chrome
function withLastError(message, cb) {
    chrome.runtime.lastError = { message };
    try {
        cb();
    } finally {
        chrome.runtime.lastError = undefined;
    }
}

/**
 * chromeMock.js plus what tabSwitcher.js uses beyond start.js: storage.session
 * (reads optionally held until flushSession()), tabs.get (answered on a
 * microtask, see flush()), windows.getLastFocused
 * and WINDOW_ID_NONE, commands.getAll, and a tabs.sendMessage whose answer per
 * subject a test sets in `pageAnswers` ({lastError} for a tab with no content
 * script).
 */
function mockChrome({ tabs = TABS, focusedWindow = 1, deferSession = false, session = true, stored = {} } = {}) {
    chrome = createChromeMock({ tabs: tabs.map((t) => Object.assign({}, t)) });
    global.chrome = chrome;
    sessionReads = [];
    pageAnswers = {};
    if (session) {
        const data = Object.assign({}, stored);
        chrome.storage.session = {
            data,
            get: jest.fn((keys, cb) => {
                const names = typeof keys === 'string' ? [keys] : keys;
                const snapshot = {};
                names.forEach((k) => Object.prototype.hasOwnProperty.call(data, k) && (snapshot[k] = data[k]));
                deferSession ? sessionReads.push(() => cb(snapshot)) : cb(snapshot);
            }),
            set: jest.fn((items, cb) => {
                Object.assign(data, JSON.parse(JSON.stringify(items)));
                cb && cb();
            }),
            remove: jest.fn((keys, cb) => {
                [].concat(keys).forEach((k) => delete data[k]);
                cb && cb();
            }),
        };
    }
    // answered after the caller returns, as in Chrome: a callback that asks again
    // must not run inside the first one, where lastError may still be set
    chrome.tabs.get = jest.fn((id, cb) => {
        const t = chrome.state.tabs.find((x) => x.id === id);
        Promise.resolve().then(() => (t ? cb(Object.assign({}, t)) : withLastError(`No tab with id: ${id}.`, () => cb(undefined))));
    });
    chrome.tabs.sendMessage = jest.fn((tabId, message, ...rest) => {
        const cb = rest.find((a) => typeof a === 'function');
        const answer = pageAnswers[message.subject];
        if (!cb) {
            return;
        }
        if (answer && answer.lastError) {
            withLastError(answer.lastError, () => cb(undefined));
        } else {
            cb(typeof answer === 'function' ? answer(tabId, message) : answer);
        }
    });
    chrome.windows.WINDOW_ID_NONE = -1;
    chrome.windows.getLastFocused = jest.fn((cb) => cb({ id: focusedWindow }));
    chrome.commands.getAll = jest.fn((cb) => cb([
        { name: 'commandPalette', shortcut: 'Ctrl+Shift+P' },
        { name: 'tabSwitcher', shortcut: 'Alt+Q' },
        { name: '_execute_action', shortcut: '' },
    ]));
    return chrome;
}

// every answer on a microtask (tabs.get, each promise step of shrink()) and the
// callbacks after it
async function flush() {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve();
    }
}

function flushSession() {
    sessionReads.splice(0).forEach((read) => read());
}

function install(opts) {
    mockChrome(opts);
    self = {};
    installTabSwitcher(self, _response);
    return self;
}

// a request from a content script, as start.js hands it to the handler
function ask(action, message = {}, sender = {}) {
    const sendResponse = jest.fn();
    self[action](Object.assign({ action }, message), sender, sendResponse);
    return sendResponse;
}
const senderTab = (id) => ({ tab: chrome.state.tabs.find((t) => t.id === id), frameId: 0 });
const listedIds = (sender = senderTab(2)) => ask('tabSwitcherTabs', {}, sender).mock.calls[0][0].tabs.map((t) => t.id);
const storedMru = () => chrome.storage.session.data.tabSwitcherMRU;

const activate = (tabId, windowId = 1) => chrome.tabs.onActivated.fire({ tabId, windowId });

// every activation schedules a thumbnail: under real timers it would fire in a
// later test, against that test's chrome
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
});

// the page's messages by subject
const toPage = (subject) => chrome.tabs.sendMessage.mock.calls.filter((c) => c[1].subject === subject);

describe('most recently used tabs', () => {
    test('lists the asking tab first, then MRU, then the rest by lastAccessed', () => {
        install();
        activate(5);
        activate(1);
        const response = ask('tabSwitcherTabs', {}, senderTab(2));
        const { tabs } = response.mock.calls[0][0];
        expect(tabs.map((t) => t.id)).toEqual([2, 1, 5, 4, 3]);
        expect(tabs.map((t) => t.current)).toEqual([true, false, false, false, false]);
        expect(tabs.find((t) => t.id === 4).otherWindow).toBe(true);
        expect(tabs.find((t) => t.id === 1).otherWindow).toBe(false);
        expect(tabs.find((t) => t.id === 3).url).toBe('https://three.test/');
        expect(tabs[0]).toEqual(expect.objectContaining({ title: 'Two', windowId: 1, favIconUrl: undefined }));
    });

    test('the asking tab becomes the most recent, and is stored so', () => {
        install();
        activate(5);
        ask('tabSwitcherTabs', {}, senderTab(2));
        expect(storedMru()).toEqual([2, 5]);
    });

    test('with no sender tab nothing is current or in another window', () => {
        install();
        activate(1);
        const { tabs } = ask('tabSwitcherTabs', {}, {}).mock.calls[0][0];
        expect(tabs.map((t) => t.id)).toEqual([1, 4, 3, 2, 5]);
        expect(tabs.some((t) => t.current || t.otherWindow)).toBe(false);
    });

    test('an activation in a window the user is not in is not recorded', () => {
        install();
        activate(4, 2);
        expect(storedMru()).toEqual([]);
        activate(5, 1);
        expect(storedMru()).toEqual([5]);
    });

    describe('window focus', () => {
        test('records the focused window\'s active tab once the switch has settled', () => {
            install();
            activate(1);
            chrome.windows.onFocusChanged.fire(2);
            jest.advanceTimersByTime(149);
            expect(storedMru()).toEqual([1]);
            jest.advanceTimersByTime(1);
            expect(storedMru()).toEqual([4, 1]);
            activate(1, 2);  // window 2 is now the user's
            expect(storedMru()).toEqual([1, 4]);
        });

        test('the browser losing focus (WINDOW_ID_NONE) records nothing and cancels a pending read', () => {
            install();
            activate(1);
            chrome.windows.onFocusChanged.fire(2);
            chrome.windows.onFocusChanged.fire(-1);
            jest.advanceTimersByTime(1000);
            expect(storedMru()).toEqual([1]);
            expect(chrome.tabs.query).not.toHaveBeenCalled();
        });
    });

    test('with no focused window known, any activation counts', () => {
        mockChrome();
        chrome.windows.getLastFocused = jest.fn((cb) => withLastError('No window', () => cb(undefined)));
        self = {};
        installTabSwitcher(self, _response);
        activate(4, 2);
        expect(storedMru()).toEqual([4]);
    });

    test('a closed tab leaves the list and its thumbnail is dropped', () => {
        install();
        activate(5);
        activate(1);
        chrome.storage.session.data['tabThumb:5'] = { thumb: 'x', url: 'https://five.test/' };
        chrome.tabs.onRemoved.fire(5);
        expect(storedMru()).toEqual([1]);
        expect(chrome.storage.session.remove).toHaveBeenCalledWith('tabThumb:5');
        expect(chrome.storage.session.data['tabThumb:5']).toBeUndefined();
    });

    describe('after a worker restart', () => {
        test('the stored list is merged under activations that came before the read', () => {
            install({ deferSession: true, stored: { tabSwitcherMRU: [3, 4, 5] } });
            activate(5);
            activate(1);
            flushSession();
            expect(storedMru()).toEqual([1, 5, 3, 4]);
        });

        test('a tab closed before the read never comes back', () => {
            install({ deferSession: true, stored: { tabSwitcherMRU: [3, 4, 5] } });
            chrome.tabs.onRemoved.fire(4);
            flushSession();
            expect(storedMru()).toEqual([3, 5]);
        });

        test('the tab list waits for the stored list', () => {
            install({ deferSession: true, stored: { tabSwitcherMRU: [5, 3] } });
            const response = ask('tabSwitcherTabs', {}, senderTab(2));
            expect(response).not.toHaveBeenCalled();
            flushSession();
            expect(response.mock.calls[0][0].tabs.map((t) => t.id)).toEqual([2, 5, 3, 4, 1]);
        });
    });
});

describe('browser shortcuts', () => {
    const command = (name, tab) => chrome.commands.onCommand.fire(name, tab);

    test.each([
        ['commandPalette', 'openPalette'],
        ['tabSwitcher', 'openSwitcher'],
    ])('%s asks the tab\'s frames to %s', (name, action) => {
        install();
        command(name, chrome.state.tabs[1]);
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, { subject: 'tabSwitcherCommand', action, cmdId: expect.any(String) }, expect.any(Function));
    });

    test('each press carries its own cmdId, the same to every frame of the tab', () => {
        install();
        command('commandPalette', chrome.state.tabs[1]);
        command('commandPalette', chrome.state.tabs[1]);
        const ids = toPage('tabSwitcherCommand').map((c) => c[1].cmdId);
        expect(ids).toHaveLength(2);
        ids.forEach((id) => expect(id).toMatch(/\S/));
        expect(ids[0]).not.toBe(ids[1]);
    });

    test('without a tab, the active tab of the last focused window', () => {
        install();
        command('commandPalette', undefined);
        expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true }, expect.any(Function));
        expect(toPage('tabSwitcherCommand').map((c) => c[0])).toEqual([2]);
    });

    test('other commands are left to start.js', () => {
        install();
        command('nextTab', chrome.state.tabs[1]);
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    describe('in a tab with no content script', () => {
        test('the switcher shortcut goes back to the most recent tab still open', async () => {
            install();
            activate(5);
            activate(3);
            activate(1);
            chrome.state.tabs = chrome.state.tabs.filter((t) => t.id !== 3);  // closed, no onRemoved seen yet
            pageAnswers.tabSwitcherCommand = { lastError: 'Could not establish connection.' };
            command('tabSwitcher', chrome.state.tabs[0]);
            await flush();
            expect(chrome.tabs.get.mock.calls.map((c) => c[0])).toEqual([3, 5]);
            expect(chrome.tabs.update).toHaveBeenCalledWith(5, { active: true });
            expect(chrome.windows.update).not.toHaveBeenCalled();
        });

        test('and focuses that tab\'s window when it is another one', async () => {
            install();
            ask('tabSwitcherTabs', {}, senderTab(4));  // used last in window 2
            activate(2);
            pageAnswers.tabSwitcherCommand = { lastError: 'Could not establish connection.' };
            command('tabSwitcher', chrome.state.tabs.find((t) => t.id === 2));
            await flush();
            expect(chrome.tabs.update).toHaveBeenCalledWith(4, { active: true });
            expect(chrome.windows.update).toHaveBeenCalledWith(2, { focused: true });
        });

        test('the palette shortcut does nothing', async () => {
            install();
            activate(5);
            activate(1);
            pageAnswers.tabSwitcherCommand = { lastError: 'Could not establish connection.' };
            command('commandPalette', chrome.state.tabs[0]);
            await flush();
            expect(chrome.tabs.update).not.toHaveBeenCalled();
        });

        test('with nothing else used, nothing happens', async () => {
            install();
            activate(1);
            pageAnswers.tabSwitcherCommand = { lastError: 'Could not establish connection.' };
            command('tabSwitcher', chrome.state.tabs[0]);
            await flush();
            expect(chrome.tabs.update).not.toHaveBeenCalled();
        });
    });

    // the welcome page reports an unassigned shortcut and opens chrome://extensions/shortcuts itself
    test.each([
        ['install with a shortcut left unassigned opens the welcome page', 'install', '', 1],
        ['install with both assigned opens the welcome page too', 'install', 'Alt+Q', 1],
        ['an update opens nothing', 'update', '', 0],
    ])('%s', (name, reason, switcherKey, pages) => {
        install();
        chrome.commands.getAll = jest.fn((cb) => cb([
            { name: 'commandPalette', shortcut: 'Ctrl+Shift+P' },
            { name: 'tabSwitcher', shortcut: switcherKey },
        ]));
        chrome.runtime.onInstalled.fire({ reason });
        const opened = chrome.tabs.create.mock.calls.map((c) => c[0].url);
        expect(opened).toEqual(Array(pages).fill('chrome-extension://surfingkeys/pages/start.html#welcome'));
    });
});

describe('thumbnails', () => {
    const T0 = 1700000000000;
    let canvases, realFileReader;

    // the image pipeline shrink() runs; every step a real Promise, as in Chrome
    function mockImaging({ webp = true } = {}) {
        canvases = [];
        global.fetch = jest.fn((url) => Promise.resolve({ blob: () => Promise.resolve({ type: 'image/jpeg', from: url }) }));
        global.createImageBitmap = jest.fn(() => Promise.resolve({ width: 1760, height: 1100, close: jest.fn() }));
        global.OffscreenCanvas = class {
            constructor(width, height) {
                this.width = width;
                this.height = height;
                this.ctx = { drawImage: jest.fn() };
                canvases.push(this);
            }
            getContext() {
                return this.ctx;
            }
            convertToBlob({ type }) {
                return Promise.resolve({ type: type === 'image/webp' && !webp ? 'image/png' : type });
            }
        };
        global.FileReader = class {
            readAsDataURL(blob) {
                Promise.resolve().then(() => {
                    this.result = `data:${blob.type};base64,THUMB`;
                    this.onload();
                });
            }
        };
    }

    const thumbOf = (id) => chrome.storage.session.data['tabThumb:' + id];
    const captures = () => chrome.tabs.captureVisibleTab.mock.calls.length;

    beforeAll(() => {
        realFileReader = global.FileReader;
    });
    beforeEach(() => {
        jest.useFakeTimers({ now: T0 });
        mockImaging();
    });
    afterEach(() => {
        jest.useRealTimers();
        global.FileReader = realFileReader;
        delete global.fetch;
        delete global.createImageBitmap;
        delete global.OffscreenCanvas;
    });

    async function activateAndShoot(tabId, windowId = 1) {
        activate(tabId, windowId);
        jest.advanceTimersByTime(300);
        await flush();
    }

    test('a tab is shot 300 ms after activation, shrunk to 440 px wide webp, and stored', async () => {
        install();
        activate(2);
        jest.advanceTimersByTime(299);
        expect(captures()).toBe(0);
        jest.advanceTimersByTime(1);
        await flush();
        expect(toPage('tabSwitcherUiVisible')[0]).toEqual([2, { subject: 'tabSwitcherUiVisible' }, { frameId: 0 }, expect.any(Function)]);
        expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(1, { format: 'jpeg', quality: 85 }, expect.any(Function));
        expect([canvases[0].width, canvases[0].height]).toEqual([440, 275]);
        expect(thumbOf(2)).toEqual({ thumb: 'data:image/webp;base64,THUMB', url: 'https://two.test/', at: T0 + 300 });
    });

    test('where the canvas cannot encode webp, jpeg', async () => {
        install();
        mockImaging({ webp: false });
        await activateAndShoot(2);
        expect(thumbOf(2).thumb).toBe('data:image/jpeg;base64,THUMB');
    });

    test('shots are at least 1000 ms apart', async () => {
        install();
        chrome.state.tabs.forEach((t) => { t.active = true; });
        await activateAndShoot(2);
        expect(captures()).toBe(1);
        await activateAndShoot(1);
        expect(captures()).toBe(1);
        jest.advanceTimersByTime(699);
        await flush();
        expect(captures()).toBe(1);
        jest.advanceTimersByTime(1);
        await flush();
        expect(captures()).toBe(2);
        expect(thumbOf(1).at).toBe(T0 + 1300);
    });

    test('a fresh shot of the same page is not taken again within 30 s', async () => {
        install();
        await activateAndShoot(2);
        jest.advanceTimersByTime(5000);
        await activateAndShoot(2);
        expect(captures()).toBe(1);
        jest.advanceTimersByTime(30000);
        await activateAndShoot(2);
        expect(captures()).toBe(2);
    });

    test('a page that finished loading in the active tab is shot again', async () => {
        install();
        await activateAndShoot(2);
        chrome.state.tabs[1].url = 'https://two.test/next';
        chrome.tabs.onUpdated.fire(2, { status: 'complete' }, chrome.state.tabs[1]);
        jest.advanceTimersByTime(1000);
        await flush();
        expect(captures()).toBe(2);
        expect(thumbOf(2).url).toBe('https://two.test/next');
        chrome.tabs.onUpdated.fire(1, { status: 'complete' }, chrome.state.tabs[0]);  // in the background
        chrome.tabs.onUpdated.fire(2, { status: 'loading' }, chrome.state.tabs[1]);
        jest.advanceTimersByTime(5000);
        await flush();
        expect(captures()).toBe(2);
    });

    test.each([
        ['an incognito tab', (t) => { t.incognito = true; }],
        ['a browser page', (t) => { t.url = 'chrome://settings/'; }],
        ['a tab no longer active', (t) => { t.active = false; }],
    ])('%s is not shot', async (name, change) => {
        install();
        change(chrome.state.tabs[1]);
        await activateAndShoot(2);
        expect(captures()).toBe(0);
        expect(thumbOf(2)).toBeUndefined();
    });

    test('a file: page is shot', async () => {
        install();
        chrome.state.tabs[1].url = 'file:///home/me/notes.html';
        await activateAndShoot(2);
        expect(thumbOf(2).url).toBe('file:///home/me/notes.html');
    });

    test('not while a Surfingkeys panel is on screen, nor when the page does not answer', async () => {
        install();
        pageAnswers.tabSwitcherUiVisible = { visible: true };
        await activateAndShoot(2);
        pageAnswers.tabSwitcherUiVisible = { lastError: 'Could not establish connection.' };
        chrome.state.tabs[0].active = true;
        jest.advanceTimersByTime(2000);
        await activateAndShoot(1);
        expect(toPage('tabSwitcherUiVisible').map((c) => c[0])).toEqual([2, 1]);
        expect(captures()).toBe(0);
    });

    test('a shot is dropped when the tab navigated while it was taken', async () => {
        install();
        chrome.tabs.captureVisibleTab = jest.fn((windowId, opts, cb) => {
            chrome.state.tabs[1].url = 'https://two.test/elsewhere';
            cb('data:image/jpeg;base64,RAW');
        });
        await activateAndShoot(2);
        expect(captures()).toBe(1);
        expect(thumbOf(2)).toBeUndefined();
    });

    test('a shot is dropped when the tab closed while it was shrunk', async () => {
        install();
        activate(2);
        jest.advanceTimersByTime(300);
        chrome.tabs.onRemoved.fire(2);
        await flush();
        expect(captures()).toBe(1);
        expect(thumbOf(2)).toBeUndefined();
    });

    test('a failed capture stores nothing and frees the next one', async () => {
        install();
        chrome.tabs.captureVisibleTab = jest.fn((windowId, opts, cb) => withLastError('quota', () => cb(undefined)));
        await activateAndShoot(2);
        expect(thumbOf(2)).toBeUndefined();
        chrome.state.tabs[0].active = true;
        jest.advanceTimersByTime(1000);
        await activateAndShoot(1);
        expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(2);
    });

    test('only the 80 most recent tabs keep a thumbnail', async () => {
        const many = Array.from({ length: 82 }, (_, i) => ({ id: 100 + i, windowId: 1, active: true, url: `https://t${i}.test/` }));
        install({ tabs: many });
        many.forEach((t) => activate(t.id));
        many.slice(0, 2).forEach((t) => { chrome.storage.session.data['tabThumb:' + t.id] = { thumb: 'old' }; });
        jest.advanceTimersByTime(300);
        await flush();
        expect(thumbOf(181)).toBeDefined();
        expect(chrome.storage.session.remove).toHaveBeenCalledWith(['tabThumb:101', 'tabThumb:100']);
        expect(thumbOf(100)).toBeUndefined();
        expect(thumbOf(101)).toBeUndefined();
    });

    describe('Surfingkeys\' own screenshots (captureVisibleTab)', () => {
        function installWithUpstream() {
            mockChrome();
            const upstream = jest.fn();
            self = { captureVisibleTab: upstream, getCaptureSize: jest.fn() };
            upstream.size = self.getCaptureSize;
            installTabSwitcher(self, _response);
            return upstream;
        }

        test('wait out the gap after a thumbnail', async () => {
            const upstream = installWithUpstream();
            await activateAndShoot(2);  // shot at T0 + 300
            const sendResponse = jest.fn();
            self.captureVisibleTab({ action: 'captureVisibleTab' }, {}, sendResponse);
            expect(upstream).not.toHaveBeenCalled();
            jest.advanceTimersByTime(999);
            expect(upstream).not.toHaveBeenCalled();
            jest.advanceTimersByTime(1);
            expect(upstream).toHaveBeenCalledWith({ action: 'captureVisibleTab' }, {}, sendResponse);
        });

        test('run at once when no thumbnail was shot lately, and pause thumbnails for 2 s', async () => {
            const upstream = installWithUpstream();
            self.getCaptureSize({ action: 'getCaptureSize' }, {}, jest.fn());
            expect(upstream.size).toHaveBeenCalledTimes(1);
            self.captureVisibleTab({ action: 'captureVisibleTab' }, {}, jest.fn());
            expect(upstream).toHaveBeenCalledTimes(1);
            activate(2);
            jest.advanceTimersByTime(1999);
            await flush();
            expect(captures()).toBe(0);
            jest.advanceTimersByTime(1);
            await flush();
            expect(captures()).toBe(1);
        });

        test('cancel a thumbnail already scheduled', async () => {
            const upstream = installWithUpstream();
            activate(2);
            jest.advanceTimersByTime(100);
            self.captureVisibleTab({ action: 'captureVisibleTab' }, {}, jest.fn());
            expect(upstream).toHaveBeenCalledTimes(1);
            jest.advanceTimersByTime(10000);
            await flush();
            expect(captures()).toBe(0);
        });
    });

    test('are read back from storage.session for the tabs asked', async () => {
        install();
        await activateAndShoot(2);
        const response = ask('tabSwitcherThumbnails', { tabIds: [2, 1] });
        expect(response).toHaveBeenCalledWith({ thumbs: { 2: thumbOf(2) } });
    });

    test('are kept in memory where storage.session is missing', async () => {
        install({ session: false });
        activate(2);
        jest.advanceTimersByTime(300);
        await flush();
        expect(ask('tabSwitcherThumbnails', { tabIds: [2, 1] })).toHaveBeenCalledWith({
            thumbs: { 2: { thumb: 'data:image/webp;base64,THUMB', url: 'https://two.test/', at: T0 + 300 } },
        });
        chrome.tabs.onRemoved.fire(2);
        expect(ask('tabSwitcherThumbnails', { tabIds: [2] })).toHaveBeenCalledWith({ thumbs: {} });
    });
});

describe('relays', () => {
    test('a subframe\'s report goes to the top frame of the same tab', () => {
        install();
        ask('tabSwitcherRelay', { data: { altUp: true, at: 5 } }, { tab: { id: 4 }, frameId: 7 });
        expect(toPage('tabSwitcherRelay')).toEqual([[4, { subject: 'tabSwitcherRelay', data: { altUp: true, at: 5 } }, { frameId: 0 }, expect.any(Function)]]);
    });

    test('the top frame\'s Alt release goes to the tab (the frontend hears it)', () => {
        install();
        ask('tabSwitcherModifierUp', { session: 's1', at: 9 }, { tab: { id: 4 }, frameId: 0 });
        expect(toPage('tabSwitcherModifierUp')).toEqual([[4, { subject: 'tabSwitcherModifierUp', session: 's1', at: 9 }, expect.any(Function)]]);
    });

    test('the top frame\'s typed-ahead keys go to the tab as paletteTypeAhead (the frontend takes them)', () => {
        install();
        ask('tabSwitcherPaletteTypeAhead', { text: 'ab', then: 'Enter', shift: true }, { tab: { id: 4 }, frameId: 0 });
        expect(toPage('paletteTypeAhead')).toEqual([[4, { subject: 'paletteTypeAhead', text: 'ab', then: 'Enter', shift: true }, expect.any(Function)]]);
    });

    test('without a sender tab nothing is sent', () => {
        install();
        ask('tabSwitcherRelay', { data: {} }, {});
        ask('tabSwitcherModifierUp', { session: 's1', at: 9 }, {});
        ask('tabSwitcherPaletteTypeAhead', { text: 'ab', then: 'Enter' }, {});
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });
});

describe('installed by start() as the Chrome adapter does', () => {
    test('the tab list is reachable through runtime.onMessage', () => {
        mockChrome();
        start(createBrowserStub({ extendBackground: installTabSwitcher }));
        activate(5);
        const sendResponse = jest.fn();
        const message = { action: 'tabSwitcherTabs', needResponse: true };
        chrome.runtime.onMessage.listeners[0](message, senderTab(2), sendResponse);
        expect(sendResponse).toHaveBeenCalledTimes(1);
        expect(sendResponse.mock.calls[0][0].tabs.map((t) => t.id)).toEqual([2, 5, 4, 3, 1]);
    });

    test('its own screenshot is answered and holds thumbnails back for 2 s', async () => {
        mockChrome();
        start(createBrowserStub({ extendBackground: installTabSwitcher }));
        pageAnswers.tabSwitcherUiVisible = { visible: true };  // stop before the image work
        const sendResponse = jest.fn();
        chrome.runtime.onMessage.listeners[0]({ action: 'captureVisibleTab', needResponse: true }, senderTab(2), sendResponse);
        expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(null, { format: 'png' }, expect.any(Function));
        expect(sendResponse).toHaveBeenCalledWith({ dataUrl: 'data:image/png;base64,AAA' });
        activate(2);
        jest.advanceTimersByTime(1999);
        await flush();
        expect(toPage('tabSwitcherUiVisible')).toHaveLength(0);
        jest.advanceTimersByTime(1);
        await flush();
        expect(toPage('tabSwitcherUiVisible')).toHaveLength(1);
    });
});
