// Background side of the Command Palette (src/background/tabSwitcher.js, and the
// frontendRequest relay in start.js): the relays that keep palette input and theme
// picks off window.postMessage, the id that makes one shortcut press act once, and
// the shortcut the palette gets out of the box.
import installTabSwitcher from '../../src/background/tabSwitcher.js';
import {start} from '../../src/background/start.js';
import {createBrowserStub, createChromeMock} from './chromeMock.js';

const COMMANDS = require('../../src/background/tabSwitcher.commands.json');

function event() {
    const listeners = [];
    return {addListener: (fn) => listeners.push(fn), fire: (...args) => listeners.forEach((fn) => fn(...args))};
}

describe('background/tabSwitcher.js', () => {
    let self, events, shortcuts;

    beforeEach(() => {
        events = {command: event(), installed: event()};
        shortcuts = [];
        global.chrome = {
            runtime: {
                lastError: undefined,
                getURL: (p) => 'chrome-extension://x/' + p.replace(/^\//, ''),
                onInstalled: events.installed,
            },
            commands: {onCommand: events.command, getAll: jest.fn((cb) => cb(shortcuts))},
            tabs: {
                sendMessage: jest.fn(),
                create: jest.fn(),
                query: jest.fn(),
                onActivated: event(),
                onUpdated: event(),
                onRemoved: event(),
            },
            windows: {WINDOW_ID_NONE: -1, getLastFocused: jest.fn(), onFocusChanged: event()},
            storage: {},
        };
        self = {};
        installTabSwitcher(self, jest.fn());
    });

    const sentTo = () => chrome.tabs.sendMessage.mock.calls.map((c) => c.slice(0, c.length - 1));

    test('each shortcut press carries its own cmdId to every frame of the tab', () => {
        events.command.fire('commandPalette', {id: 7});
        events.command.fire('commandPalette', {id: 7});
        events.command.fire('tabSwitcher', {id: 7});
        const sent = sentTo();
        expect(sent.map(([tabId, msg]) => [tabId, msg.subject, msg.action])).toEqual([
            [7, 'tabSwitcherCommand', 'openPalette'],
            [7, 'tabSwitcherCommand', 'openPalette'],
            [7, 'tabSwitcherCommand', 'openSwitcher'],
        ]);
        const ids = sent.map(([, msg]) => msg.cmdId);
        expect(ids.every((id) => typeof id === 'string' && id)).toBe(true);
        expect(new Set(ids).size).toBe(3);
    });

    test('typed-ahead keys go from the top frame to its tab, where the frontend takes them', () => {
        self.tabSwitcherPaletteTypeAhead({text: 'fig', then: 'Enter', shift: false}, {tab: {id: 7}, frameId: 0});
        expect(sentTo()).toEqual([[7, {subject: 'paletteTypeAhead', text: 'fig', then: 'Enter', shift: false}]]);
    });

    test('install opens the shortcuts page only when a shortcut is left unassigned', () => {
        shortcuts = [{name: 'commandPalette', shortcut: 'Ctrl+Shift+K'}, {name: 'tabSwitcher', shortcut: 'Alt+Q'}, {name: 'nextTab', shortcut: ''}];
        events.installed.fire({reason: 'install'});
        expect(chrome.tabs.create).not.toHaveBeenCalled();
        shortcuts = [{name: 'commandPalette', shortcut: ''}, {name: 'tabSwitcher', shortcut: 'Alt+Q'}];
        events.installed.fire({reason: 'update'});
        expect(chrome.tabs.create).not.toHaveBeenCalled();
        events.installed.fire({reason: 'install'});
        expect(chrome.tabs.create).toHaveBeenCalledWith({url: 'chrome://extensions/shortcuts'});
    });

    // Chrome leaves a suggested key it keeps for itself unassigned, with no word: on
    // Windows and Linux Ctrl+Shift+P prints (measured on a fresh Linux profile)
    test('the palette\'s default shortcut is one Chrome assigns on Windows and Linux', () => {
        expect(COMMANDS.commandPalette.suggested_key).toEqual({default: 'Ctrl+Shift+K', mac: 'Command+Shift+P'});
        expect(COMMANDS.tabSwitcher.suggested_key).toEqual({default: 'Alt+Q', mac: 'Alt+Q'});
    });
});

// start.js, not tabSwitcher.js: the theme menu uses it on every browser
describe('background/start.js frontendRequest', () => {
    let dispatch;

    beforeEach(() => {
        global.chrome = createChromeMock({tabs: [{id: 7, index: 0, windowId: 1, url: 'https://page.example/', title: 'P', active: true, pinned: false}]});
        start(createBrowserStub());
        dispatch = (message, sender) => chrome.runtime.onMessage.listeners[0](message, sender, jest.fn());
    });

    const relayed = () => chrome.tabs.sendMessage.mock.calls.filter((c) => c[1] && c[1].subject === 'frontendRequest');
    const frontend = () => chrome.runtime.getURL('pages/frontend.html');

    test('the frontend\'s requests go to the top frame of its own tab', () => {
        dispatch({action: 'frontendRequest', request: 'pickTheme', name: 'nord'}, {tab: {id: 7}, frameId: 3, url: frontend()});
        expect(relayed()).toEqual([[7, {subject: 'frontendRequest', request: 'pickTheme', name: 'nord'}, {frameId: 0}]]);
    });

    test('…and only the frontend\'s: they write settings', () => {
        dispatch({action: 'frontendRequest', request: 'toggleBlocklist'}, {tab: {id: 7}, frameId: 0, url: 'https://page.example/'});
        dispatch({action: 'frontendRequest', request: 'toggleBlocklist'}, {url: frontend()});
        expect(relayed()).toEqual([]);
    });
});
