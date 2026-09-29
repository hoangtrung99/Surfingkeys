// The page side of the Command Palette and the Visual Tab Switcher
// (content_scripts/tabSwitcher.js, front.js): one browser shortcut press acts
// once, and nothing the page can do ends in a palette action or a settings write.
const mockRUNTIME = jest.fn();
const mockHandlers = {};
let mockGuid = 0;

jest.mock('../../src/content_scripts/common/runtime.js', () => ({
    RUNTIME: (...args) => mockRUNTIME(...args),
    dispatchSKEvent: jest.fn(),
    runtime: {
        conf: {},
        on: (subject, fn) => { mockHandlers[subject] = fn; },
        postTopMessage: jest.fn(),
        getTopURL: (cb) => cb('https://page.example/'),
    },
}));

jest.mock('../../src/content_scripts/common/mode.js', () => {
    class FakeMode {
        constructor(name) {
            this.name = name;
            this.listeners = {};
            FakeMode.made.push(this);
        }
        addEventListener(type, fn) {
            this.listeners[type] = fn;
            return this;
        }
        enter() {}
        exit() {}
    }
    FakeMode.made = [];
    FakeMode.isOrphaned = () => false;
    FakeMode.showStatus = () => {};
    return { __esModule: true, default: FakeMode };
});

jest.mock('../../src/content_scripts/common/utils.js', () => ({
    ...jest.requireActual('../../src/content_scripts/common/utils.js'),
    generateQuickGuid: () => `guid${++mockGuid}`,
}));

const Mode = require('../../src/content_scripts/common/mode.js').default;

const command = (msg) => mockHandlers.tabSwitcherCommand(msg, {}, () => {});
const relay = (data) => mockHandlers.tabSwitcherRelay({ data });
const holdMode = () => Mode.made.find((m) => m.name === 'PaletteTypeAhead');
const key = (k, more) => {
    const e = { key: k, isTrusted: true, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...more };
    holdMode().listeners.keydown(e);
    return e;
};

describe('content_scripts/tabSwitcher.js in the top frame', () => {
    let host, mapped;

    beforeAll(() => {
        jest.useFakeTimers();
        jest.spyOn(document, 'hasFocus').mockReturnValue(true);  // focus in the page itself
        host = { command: jest.fn(), afterCommands: jest.fn((cb) => cb()) };
        const api = { mapkey: jest.fn() };
        require('../../src/content_scripts/tabSwitcher.js').default(api, host);
        mapped = Object.fromEntries(api.mapkey.mock.calls.map(([keys, , fn]) => [keys, fn]));
    });
    afterAll(() => {
        jest.useRealTimers();
    });
    beforeEach(() => {
        jest.runOnlyPendingTimers();  // the hold of a previous test ends
        host.command.mockClear();
        host.afterCommands.mockClear();
        mockRUNTIME.mockClear();
    });

    const actions = () => host.command.mock.calls.map(([args]) => args.action);

    // An iframe inside a shadow root holds the focus: the top frame sees the shadow
    // host as its active element and acts at once, and the iframe relays the same press.
    test('a press relayed again by a second frame opens the palette once', () => {
        command({ action: 'openPalette', cmdId: 'p1' });
        relay({ open: 'openPalette', cmdId: 'p1' });
        expect(actions()).toEqual(['togglePalette']);
        command({ action: 'openPalette', cmdId: 'p2' });  // the next press closes it
        expect(actions()).toEqual(['togglePalette', 'togglePalette']);
    });

    test('…and opens the switcher once, keeping its session for the Alt release', () => {
        command({ action: 'openSwitcher', cmdId: 's1' });
        relay({ open: 'openSwitcher', altHeld: true, cmdId: 's1' });
        expect(actions()).toEqual(['openSwitcher']);
        const session = host.command.mock.calls[0][0].session;
        relay({ altUp: true, at: 5 });
        expect(mockRUNTIME).toHaveBeenCalledWith('tabSwitcherModifierUp', { session, at: 5 });
    });

    test('the page mappings, which carry no cmdId, act on every press', () => {
        mapped['<Ctrl-P>']();
        jest.runOnlyPendingTimers();
        mapped['<Ctrl-P>']();
        expect(actions()).toEqual(['togglePalette', 'togglePalette']);
    });

    test('typed-ahead keys reach the frontend over chrome.runtime, never postMessage', () => {
        command({ action: 'openPalette', cmdId: 't1' });
        ['f', 'i', 'g'].forEach((k) => key(k));
        key('Enter');
        jest.runOnlyPendingTimers();
        expect(actions()).toEqual(['togglePalette']);
        expect(host.afterCommands).toHaveBeenCalledTimes(1);
        expect(mockRUNTIME).toHaveBeenCalledWith('tabSwitcherPaletteTypeAhead', { text: 'fig', then: 'Enter', shift: false });
    });

    test('keys the page makes up are not held, so they reach no palette', () => {
        command({ action: 'openPalette', cmdId: 'u1' });
        const made = ['h', 'i', 'Enter'].map((k) => key(k, { isTrusted: false }));
        expect(made.map((e) => e.sk_stopPropagation)).toEqual([undefined, undefined, undefined]);
        jest.runOnlyPendingTimers();
        expect(host.afterCommands).not.toHaveBeenCalled();
        expect(mockRUNTIME).not.toHaveBeenCalledWith('tabSwitcherPaletteTypeAhead', expect.anything());
    });
});

describe('front.js: what the frontend asks of the page', () => {
    let front, normal;

    beforeAll(() => {
        global.chrome = { runtime: { id: 'x', getURL: (p) => 'chrome-extension://x/' + p.replace(/^\//, '') } };
        normal = { toggleBlocklist: jest.fn() };
        front = require('../../src/content_scripts/front.js').default({}, normal, {}, {}, {});
        front.pickTheme = jest.fn();
    });
    beforeEach(() => {
        front.pickTheme.mockClear();
        normal.toggleBlocklist.mockClear();
    });

    // the page posts to its own window like any content script
    function pagePosts(data) {
        window.dispatchEvent(new MessageEvent('message', { data, source: window }));
    }

    test('the page cannot pick a theme or toggle the blocklist', () => {
        pagePosts({ surfingkeys_content_data: { action: 'pickTheme', name: 'nord' } });
        pagePosts({ surfingkeys_content_data: { action: 'toggleBlocklist' } });
        pagePosts({ surfingkeys_uihost_data: { toContent: true, action: 'pickTheme', name: 'nord' } });
        expect(front.pickTheme).not.toHaveBeenCalled();
        expect(normal.toggleBlocklist).not.toHaveBeenCalled();
    });

    test('the frontend can, through the background', () => {
        mockHandlers.frontendRequest({ request: 'pickTheme', name: 'nord' });
        expect(front.pickTheme).toHaveBeenCalledWith('nord');
        mockHandlers.frontendRequest({ request: 'toggleBlocklist' });
        expect(normal.toggleBlocklist).toHaveBeenCalledTimes(1);
        mockHandlers.frontendRequest({ request: 'no such thing' });
    });
});
