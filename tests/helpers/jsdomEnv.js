// The browser a content script or the frontend expects, as far as jsdom can be
// made to provide it: a Chrome user agent, the DOM pieces jsdom leaves out, a
// `marked` jest can load, a system clipboard, and a chrome.runtime whose
// answers the test decides.
//
// Install it once per test FILE and before the first src module is required:
// several modules read these at import time (keyboardUtils.js takes the platform
// from the user agent, runtime.js registers its onMessage listener, default.js
// picks its mappings by browser name).

// captured before any test can install fake timers, so settle() always waits for
// real ones
const realSetTimeout = setTimeout;

// for the beforeAll that boots a suite: loading the content script or the frontend
// (babel, and coverage instrumentation on a cold cache) can take seconds on a busy
// machine, and jest's 5 s default then fails every test of the file
export const BOOT_TIMEOUT = 30000;

export const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * Wait until every answer, callback and zero-delay timer queued so far has run:
 * the chrome mock answers on a microtask, and a handler reached that way often
 * starts a timer or sends another request (getSettings -> getState -> showStatus).
 * Each turn is one real macrotask, so it also works under fake timers.
 */
export async function settle(turns = 3) {
    for (let i = 0; i < turns; i++) {
        await new Promise((resolve) => realSetTimeout(resolve, 0));
    }
}

/**
 * The system clipboard as clipboard.js drives it on Chrome: copy takes the text
 * selected in its holder (#sk_clipboard, selected but never focused) or else the
 * page selection, paste types the board into the focused text control. jsdom
 * has no document.execCommand at all, so without it every copy throws.
 */
function installClipboard() {
    const board = { text: '' };
    const isTextControl = (el) => el && (el.localName === 'textarea' || el.localName === 'input');
    document.execCommand = jest.fn((command) => {
        if (command === 'copy') {
            const holder = document.getElementById('sk_clipboard');
            board.text = holder && holder.selectionEnd > holder.selectionStart
                ? holder.value.substring(holder.selectionStart, holder.selectionEnd)
                : String(document.getSelection());
            return true;
        }
        if (command === 'paste' && isTextControl(document.activeElement)) {
            document.activeElement.value = board.text;
            return true;
        }
        return false;
    });
    return board;
}

/**
 * Make jsdom look like Chrome to the extension.
 *
 * - navigator.userAgent: jsdom's navigator.vendor is 'Apple Computer, Inc.', so
 *   getBrowserName() (utils.js) says Safari and default.js leaves out t, b, ox,
 *   oh, W, <<, >> and the rest of its non-Safari mappings.
 * - HTMLElement.innerText: missing in jsdom; htmlEncode() (utils.js) and every
 *   title the frontend renders read it, and read '' without it.
 * - HTMLElement.isContentEditable: missing in jsdom, so isEditable() (utils.js)
 *   never takes a contenteditable element for an input.
 * - document.scrollingElement: missing in jsdom; marks and every clipboard
 *   action read its scroll offsets.
 * - document.execCommand: see installClipboard().
 * - marked: ships as ESM, which jest does not load; the frontend (llmchat.js)
 *   imports it.
 *
 * Returns the clipboard board ({text}).
 */
export function installJsdomShims({ userAgent = CHROME_UA } = {}) {
    jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
        configurable: true,
        get() { return this.textContent; },
        set(v) { this.textContent = v; },
    });
    Object.defineProperty(HTMLElement.prototype, 'isContentEditable', {
        configurable: true,
        get() {
            const host = this.closest('[contenteditable]');
            return !!host && host.getAttribute('contenteditable').toLowerCase() !== 'false';
        },
    });
    Object.defineProperty(Document.prototype, 'scrollingElement', {
        configurable: true,
        get() { return this.documentElement; },
    });
    jest.doMock('marked', () => ({ marked: { parse: (s) => s, setOptions: () => {}, use: () => {} } }));
    return installClipboard();
}

/**
 * A chrome namespace for a content script or the frontend.
 *
 * chrome.runtime.sendMessage answers from `answers[action](message)` on a
 * microtask, as Chrome answers after the sending task. A request with a callback
 * but no entry in `answers` is HELD: it lands in `held` as {message, respond},
 * so a test decides when (and whether) the answer comes. `answers` is the live
 * table; a test may change an entry at any time.
 *
 * `sent` is every message sent in the current test (it reads the mock's calls,
 * which the jest config clears before each test).
 *
 * `deliver(message)` plays a message from the background, as runtime.on
 * handlers receive it ({subject, ...}); it returns what the handlers answered.
 */
export function installChromeMock({ answers = {}, id = 'skjsdomtestextension' } = {}) {
    const held = [];
    const listeners = [];
    const sendMessage = jest.fn((message, callback) => {
        if (!callback) {
            return;
        }
        if (Object.prototype.hasOwnProperty.call(answers, message.action)) {
            const reply = answers[message.action](message);
            Promise.resolve().then(() => callback(reply));
        } else {
            held.push({ message, respond: (reply) => callback(reply) });
        }
    });
    const chrome = {
        runtime: {
            id,
            lastError: undefined,
            getURL: (path) => `chrome-extension://${id}/${String(path).replace(/^\//, '')}`,
            sendMessage,
            onMessage: { addListener: jest.fn((fn) => listeners.push(fn)) },
        },
        // LOG() (src/common/utils.js) asks for the enabled log levels; unanswered, it logs nothing
        storage: { local: { get: jest.fn(), set: jest.fn() } },
    };
    globalThis.chrome = chrome;
    return {
        chrome,
        answers,
        held,
        get sent() {
            return sendMessage.mock.calls.map((call) => call[0]);
        },
        deliver(message) {
            const replies = [];
            listeners.forEach((fn) => fn(message, {}, (reply) => replies.push(reply)));
            return replies;
        },
    };
}

// Named keys as Surfingkeys writes them (<Esc>, <Space>...): [event.key, keyCode]
const NAMED_KEYS = {
    Esc: ['Escape', 27], Escape: ['Escape', 27], Space: [' ', 32], Enter: ['Enter', 13], Tab: ['Tab', 9],
    Backspace: ['Backspace', 8], Delete: ['Delete', 46], Home: ['Home', 36], End: ['End', 35],
    PageUp: ['PageUp', 33], PageDown: ['PageDown', 34],
    ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40],
};
// US layout: [plain, with Shift, keyCode] for every printable key but the letters
const US_LAYOUT = [
    ['`', '~', 192], ['1', '!', 49], ['2', '@', 50], ['3', '#', 51], ['4', '$', 52], ['5', '%', 53],
    ['6', '^', 54], ['7', '&', 55], ['8', '*', 56], ['9', '(', 57], ['0', ')', 48], ['-', '_', 189],
    ['=', '+', 187], ['[', '{', 219], [']', '}', 221], ['\\', '|', 220], [';', ':', 186], ["'", '"', 222],
    [',', '<', 188], ['.', '>', 190], ['/', '?', 191], [' ', ' ', 32],
];

function charInit(ch) {
    if (/^[a-z]$/.test(ch)) {
        return { key: ch, keyCode: ch.toUpperCase().charCodeAt(0), shiftKey: false };
    }
    if (/^[A-Z]$/.test(ch)) {
        return { key: ch, keyCode: ch.charCodeAt(0), shiftKey: true };
    }
    for (const [plain, shifted, keyCode] of US_LAYOUT) {
        if (ch === plain || ch === shifted) {
            return { key: ch, keyCode, shiftKey: ch !== plain };
        }
    }
    return { key: ch, keyCode: 0, shiftKey: false };
}

const TOKEN = /<((?:(?:Ctrl|Alt|Meta|Shift)-)*)([A-Za-z][A-Za-z0-9]+|[^\s])>/y;

/**
 * The KeyboardEvent inits a user produces typing `keys` in Surfingkeys notation:
 * 'gxx', '3x', '<Esc>', '<Alt-p>', "<Ctrl-'>a", '<<' (two presses of '<').
 * Each carries the keyCode Chrome reports on a US layout: getKeyChar() reads
 * keyCode for the named keys (without 27 an Escape is not <Esc>) and the tab
 * switcher reads it for Alt-q.
 */
export function parseKeys(keys) {
    const inits = [];
    let i = 0;
    while (i < keys.length) {
        TOKEN.lastIndex = i;
        const m = TOKEN.exec(keys);
        let init;
        if (m) {
            const mods = m[1];
            const named = NAMED_KEYS[m[2]];
            init = named ? { key: named[0], keyCode: named[1], shiftKey: false } : charInit(m[2]);
            init.ctrlKey = mods.includes('Ctrl-');
            init.altKey = mods.includes('Alt-');
            init.metaKey = mods.includes('Meta-');
            init.shiftKey = init.shiftKey || mods.includes('Shift-');
            i = TOKEN.lastIndex;
        } else {
            init = charInit(keys[i]);
            i++;
        }
        inits.push(init);
    }
    return inits;
}

// jsdom's own object behind a DOM wrapper (an Event, a Node). Private to jsdom
// (lib/jsdom/living/generated/utils.js implSymbol, checked against 26.1): a
// jsdom that drops it fails here by name, not as a trusted key never arriving.
function jsdomImpl(wrapper) {
    const symbol = Object.getOwnPropertySymbols(wrapper).find((s) => s.description === 'impl');
    if (!symbol) {
        throw new Error('dispatchTrusted: this jsdom has no "impl" symbol on its wrappers');
    }
    return wrapper[symbol];
}

/**
 * Dispatch `event` on `target` as the browser would for the user: with
 * isTrusted set. dispatchEvent() marks every event untrusted, as for a page
 * script, and code that ignores keys the page makes up (content_scripts/
 * tabSwitcher.js) would then never see one; jsdom's internal dispatch
 * (EventTargetImpl._dispatch, private, as jsdomImpl) is the only way to deliver
 * a trusted one.
 */
export function dispatchTrusted(target, event) {
    const impl = jsdomImpl(event);
    const targetImpl = jsdomImpl(target);
    if (typeof targetImpl._dispatch !== 'function') {
        throw new Error('dispatchTrusted: this jsdom has no EventTargetImpl._dispatch');
    }
    impl.isTrusted = true;
    targetImpl._dispatch(impl);
    return event;
}

/**
 * Type `keys` (see parseKeys) into `target` (the focused element by default):
 * a keydown and a keyup per stroke, as the page would receive them. Returns the
 * keydown events, so a test can see what was prevented.
 *
 * `trusted`: as the user typing them (see dispatchTrusted); by default they are
 * untrusted, as keys a page dispatches.
 */
export function press(keys, { target, trusted = false } = {}) {
    return parseKeys(keys).map((init) => {
        const el = target || document.activeElement || document.body;
        const opts = Object.assign({ bubbles: true, cancelable: true, composed: true, which: init.keyCode }, init);
        const dispatch = trusted ? (e) => dispatchTrusted(el, e) : (e) => el.dispatchEvent(e);
        const down = new KeyboardEvent('keydown', opts);
        dispatch(down);
        dispatch(new KeyboardEvent('keyup', opts));
        return down;
    });
}
