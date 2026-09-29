// The page side of the palette and the switcher (content_scripts/tabSwitcher.js)
// in the top frame: which frame acts on a browser shortcut, the Alt release it
// relays, and the keys it holds until the palette's input has focus.
//
// The module keeps its state at module level, so every test loads a fresh copy
// (jest.isolateModules) with its own chrome mock, Mode stack and a stub host
// whose `command` is what would reach the frontend. Earlier copies stay
// attached to window; the window blur in afterEach resets them.
//
// The subframe branches (window !== top) cannot run here: jsdom's window.top is
// the window itself and cannot be replaced. The browser suite covers them.
import path from 'path';
import { dispatchTrusted, installChromeMock, installJsdomShims, press } from '../helpers/jsdomEnv.js';

const SRC = path.resolve(__dirname, '../../src');

let ext, host, api;

function load({ install = true } = {}) {
    jest.isolateModules(() => {
        ext = installChromeMock({ answers: {} });
        const Mode = require(path.join(SRC, 'content_scripts/common/mode.js')).default;
        Mode.init();  // content.js does this before anything installs
        const installTabSwitcher = require(path.join(SRC, 'content_scripts/tabSwitcher.js')).default;
        host = { command: jest.fn() };
        api = { mapkey: jest.fn() };
        install && installTabSwitcher(api, host);
    });
}

const commands = () => host.command.mock.calls.map((c) => c[0]);
const shortcut = (action) => ext.deliver({ subject: 'tabSwitcherCommand', action });
const mapping = (keys) => api.mapkey.mock.calls.find((c) => c[0] === keys)[2];
const relayed = (action) => ext.sent.filter((m) => m.action === action);

function key(type, init) {
    return new KeyboardEvent(type, Object.assign({ bubbles: true, cancelable: true }, init));
}
// the user holding Alt, then letting go (both trusted, as from the keyboard)
const altDown = () => dispatchTrusted(document.body, key('keydown', { key: 'Alt', keyCode: 18, altKey: true }));
const altUp = () => dispatchTrusted(document.body, key('keyup', { key: 'Alt', keyCode: 18, altKey: false }));

// the frontend frame as the UI host puts it in the page (uiframe.js)
function uiFrame(pointerEvents) {
    const holder = document.createElement('div');
    holder.attachShadow({ mode: 'open' });
    const frame = document.createElement('iframe');
    frame.className = 'sk_ui';
    frame.style.pointerEvents = pointerEvents;
    holder.shadowRoot.append(frame);
    document.documentElement.append(holder);
    return holder;
}

beforeAll(() => {
    installJsdomShims();
});

beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(document, 'hasFocus').mockReturnValue(true);
    document.body.innerHTML = '<input id=field>';
});

afterEach(() => {
    window.dispatchEvent(new Event('blur'));
    jest.useRealTimers();
    document.hasFocus.mockRestore();
    document.documentElement.querySelectorAll(':scope > div').forEach((d) => d.remove());
});

describe('browser shortcut (tabSwitcherCommand)', () => {
    test('is always answered, so the background knows a content script is here', () => {
        load();
        expect(shortcut('openSwitcher')).toEqual([{}]);
        document.hasFocus.mockReturnValue(false);
        expect(shortcut('openPalette')).toEqual([{}]);
    });

    test('opens the switcher in a new session', () => {
        load();
        shortcut('openSwitcher');
        shortcut('openSwitcher');
        const [first, second] = commands();
        expect(first).toEqual({ action: 'openSwitcher', backward: false, session: expect.any(String) });
        expect(second.session).not.toBe(first.session);
    });

    test('toggles the palette', () => {
        load();
        shortcut('openPalette');
        expect(commands()).toEqual([{ action: 'togglePalette' }]);
    });

    test('with focus outside the page (address bar) the top frame starts at once', () => {
        load();
        document.hasFocus.mockReturnValue(false);
        shortcut('openSwitcher');
        expect(commands()).toEqual([expect.objectContaining({ action: 'openSwitcher' })]);
    });

    test('with focus in a subframe the top frame waits for that frame to claim it', () => {
        load();
        document.body.innerHTML = '<iframe></iframe>';
        document.querySelector('iframe').focus();
        expect(document.activeElement.tagName).toBe('IFRAME');
        shortcut('openSwitcher');
        jest.advanceTimersByTime(99);
        expect(commands()).toEqual([]);
        jest.advanceTimersByTime(1);
        expect(commands()).toEqual([expect.objectContaining({ action: 'openSwitcher' })]);
    });

    test('a subframe that claims it (tabSwitcherRelay) is the one that opens', () => {
        load();
        document.body.innerHTML = '<iframe></iframe>';
        document.querySelector('iframe').focus();
        shortcut('openPalette');
        ext.deliver({ subject: 'tabSwitcherRelay', data: { open: 'openSwitcher', backward: true } });
        jest.advanceTimersByTime(500);
        expect(commands()).toEqual([expect.objectContaining({ action: 'openSwitcher', backward: true })]);
    });

    test('before installTabSwitcher ran, nothing is sent to a frontend', () => {
        load({ install: false });
        expect(shortcut('openSwitcher')).toEqual([{}]);
        expect(host.command).not.toHaveBeenCalled();
    });
});

describe('Alt release', () => {
    test('the user letting go of Alt is relayed through the background with the session', () => {
        load();
        altDown();
        shortcut('openSwitcher');
        const { session } = commands()[0];
        altUp();
        const [up] = relayed('tabSwitcherModifierUp');
        expect(up).toEqual(expect.objectContaining({ session, at: expect.any(Number) }));
        expect(relayed('tabSwitcherModifierUp')).toHaveLength(1);
    });

    test('Alt not seen going down arms no relay', () => {
        load();
        shortcut('openSwitcher');
        altUp();
        expect(relayed('tabSwitcherModifierUp')).toEqual([]);
    });

    test('an Alt keyup the page dispatches relays nothing', () => {
        load();
        altDown();
        shortcut('openSwitcher');
        document.body.dispatchEvent(key('keyup', { key: 'Alt', keyCode: 18 }));
        expect(relayed('tabSwitcherModifierUp')).toEqual([]);
    });

    test('the window losing focus disarms the relay', () => {
        load();
        altDown();
        shortcut('openSwitcher');
        window.dispatchEvent(new Event('blur'));
        altUp();
        expect(relayed('tabSwitcherModifierUp')).toEqual([]);
    });

    test('a subframe\'s release is relayed with the top frame\'s session', () => {
        load();
        shortcut('openSwitcher');
        const { session } = commands()[0];
        ext.deliver({ subject: 'tabSwitcherRelay', data: { altUp: true, at: 1234 } });
        expect(relayed('tabSwitcherModifierUp')).toEqual([expect.objectContaining({ session, at: 1234 })]);
    });

    test('a release with no switcher opened from here is dropped', () => {
        load();
        ext.deliver({ subject: 'tabSwitcherRelay', data: { altUp: true, at: 1234 } });
        expect(relayed('tabSwitcherModifierUp')).toEqual([]);
    });
});

describe('tabSwitcherUiVisible', () => {
    test.each([
        ['an interactive frontend', 'all', true],
        ['only the status strip', 'none', false],
    ])('%s answers visible: %s', (name, pointerEvents, visible) => {
        load();
        uiFrame(pointerEvents);
        expect(ext.deliver({ subject: 'tabSwitcherUiVisible' })).toEqual([{ visible }]);
    });

    test('no frontend answers not visible', () => {
        load();
        expect(ext.deliver({ subject: 'tabSwitcherUiVisible' })).toEqual([{ visible: false }]);
    });
});

describe('keys typed before the palette has focus', () => {
    const typeAhead = () => commands().filter((c) => c.action === 'paletteTypeAhead');

    function openPalette() {
        load();
        document.getElementById('field').focus();
        shortcut('openPalette');
    }

    test('are held for 500 ms and handed over in order', () => {
        openPalette();
        const downs = press('xfig', { trusted: true });
        expect(downs.every((e) => e.defaultPrevented)).toBe(true);
        expect(document.getElementById('field').value).toBe('');
        jest.advanceTimersByTime(499);
        expect(typeAhead()).toEqual([]);
        jest.advanceTimersByTime(1);
        expect(typeAhead()).toEqual([expect.objectContaining({ text: 'xfig', then: null })]);
    });

    test('Backspace edits what is held', () => {
        openPalette();
        press('abX<Backspace>c', { trusted: true });
        jest.advanceTimersByTime(500);
        expect(typeAhead()).toEqual([expect.objectContaining({ text: 'abc' })]);
    });

    test('Enter is handed over on the next tick, with the text before it', () => {
        openPalette();
        press('ab<Enter>', { trusted: true });
        expect(typeAhead()).toEqual([]);
        jest.advanceTimersByTime(0);
        expect(typeAhead()).toEqual([{ action: 'paletteTypeAhead', text: 'ab', then: 'Enter', shift: false }]);
    });

    test.each(['Escape', 'Tab'])('%s is handed over too', (name) => {
        openPalette();
        press(name === 'Tab' ? '<Shift-Tab>' : '<Esc>', { trusted: true });
        jest.advanceTimersByTime(0);
        expect(typeAhead()).toEqual([{ action: 'paletteTypeAhead', text: '', then: name, shift: name === 'Tab' }]);
    });

    test('Ctrl and Meta chords pass through', () => {
        openPalette();
        const downs = press('<Ctrl-c><Meta-v>a', { trusted: true });
        expect(downs.map((e) => e.defaultPrevented)).toEqual([false, false, true]);
        jest.advanceTimersByTime(500);
        expect(typeAhead()).toEqual([expect.objectContaining({ text: 'a' })]);
    });

    test('the window losing focus hands over what is held at once', () => {
        openPalette();
        press('ab', { trusted: true });
        window.dispatchEvent(new Event('blur'));
        expect(typeAhead()).toEqual([expect.objectContaining({ text: 'ab' })]);
        jest.advanceTimersByTime(500);
        expect(typeAhead()).toHaveLength(1);
    });

    test('nothing is held when the shortcut closes an open palette', () => {
        load();
        uiFrame('all');
        shortcut('openPalette');
        const [down] = press('a', { trusted: true });
        expect(down.defaultPrevented).toBe(false);
        jest.advanceTimersByTime(500);
        expect(commands()).toEqual([{ action: 'togglePalette' }]);
    });

    test('nothing typed, nothing handed over', () => {
        openPalette();
        jest.advanceTimersByTime(500);
        expect(typeAhead()).toEqual([]);
    });
});

describe('mappings for unassigned browser shortcuts', () => {
    test('are the four fallbacks', () => {
        load();
        expect(api.mapkey.mock.calls.map((c) => c[0])).toEqual(['<Alt-q>', '<Alt-Q>', '<Meta-P>', '<Ctrl-P>']);
    });

    test.each([
        ['<Alt-q>', { action: 'openSwitcher', backward: false, session: expect.any(String) }],
        ['<Alt-Q>', { action: 'openSwitcher', backward: true, session: expect.any(String) }],
        ['<Meta-P>', { action: 'togglePalette' }],
        ['<Ctrl-P>', { action: 'togglePalette' }],
    ])('%s sends %o', (keys, command) => {
        load();
        mapping(keys)();
        expect(commands()).toEqual([command]);
    });

    test('<Alt-q> with Alt held arms the release relay', () => {
        load();
        altDown();
        mapping('<Alt-q>')();
        altUp();
        expect(relayed('tabSwitcherModifierUp')).toEqual([expect.objectContaining({ session: commands()[0].session })]);
    });
});
