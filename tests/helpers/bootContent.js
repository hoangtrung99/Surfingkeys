// The content script as Chrome runs it, booted in jsdom: src/content_scripts/
// chrome.js, the real entry, through content.js start() -- so the page gets the
// same mappings (default.js, theme.js, tabSwitcher.js), the same getSettings ->
// applySettings -> getState sequence and the same runtime.on handlers
// (settingsUpdated, tabActivated...) as a real tab.
//
// ONE BOOT PER TEST FILE (in beforeAll): Mode listens on window at module scope
// and the modules are singletons in jest's registry. Tests share the page, so
// each one leaves it in Normal mode with no keys pending, and a file whose tests
// change the keymap or the conf puts them back with keepKeys() in afterEach.
// Some states cannot be left once entered (Lurk, an orphaned page); the files
// that reach them do so in a last describe block, so they rely on declaration
// order and do not hold under jest --randomize.
//
// What stands in for the browser is in jsdomEnv.js. Two seams are test-only:
// - The factories (createNormal, createFront...) are wrapped to hand their
//   instances to the test; the instances themselves are untouched.
// - The UI host (uiframe.js) is replaced: the frontend is a separate document
//   (tests/helpers/bootFrontend.js boots that one), so here it is a host that is
//   ready at once, and what the page would post to it is recorded instead
//   (`toUiHost`, a spy on runtime.postTopMessage). front.command runs for real
//   and is spied on (`frontCmd`): its calls are the page's requests to the UI.
import path from 'path';
import { installChromeMock, installJsdomShims, press, settle } from './jsdomEnv.js';

const SRC = path.resolve(__dirname, '../../src');
const src = (file) => path.join(SRC, file);

const FACTORIES = {
    clipboard: 'content_scripts/common/clipboard.js',
    insert: 'content_scripts/common/insert.js',
    normal: 'content_scripts/common/normal.js',
    hints: 'content_scripts/common/hints.js',
    visual: 'content_scripts/common/visual.js',
    front: 'content_scripts/front.js',
    api: 'content_scripts/common/api.js',
};

// What a fresh profile's background answers at boot.
export const BOOT_ANSWERS = {
    getSettings: () => ({ settings: {} }),
    getState: () => ({ state: 'enabled' }),
    tabURLAccessed: () => ({ index: 0 }),
    localData: () => ({ data: {} }),
};

function captureInstances() {
    const made = {};
    Object.entries(FACTORIES).forEach(([name, file]) => {
        jest.doMock(src(file), () => {
            const actual = jest.requireActual(src(file));
            return Object.assign({}, actual, {
                __esModule: true,
                default: (...args) => {
                    const instance = actual.default(...args);
                    if (name === 'front') {
                        jest.spyOn(instance, 'command');
                    }
                    made[name] = instance;
                    return instance;
                },
            });
        });
    });
    return made;
}

// A Trie as data: its own properties, children snapshotted too, and the word
// each meta had, since Trie.add rewrites meta.word of a meta it is handed again
// (a basic-mode swap re-adds the other key's meta).
function snapshotTrie(node) {
    const snap = {};
    Object.keys(node).forEach((k) => {
        snap[k] = k.length === 1 ? snapshotTrie(node[k]) : node[k];
    });
    if (node.meta) {
        snap.word = node.meta.word;
    }
    return snap;
}

// in place: a reference to a mode's keymap taken at boot stays the live one
function restoreTrie(node, snap) {
    Object.keys(node).forEach((k) => delete node[k]);
    Object.keys(snap).forEach((k) => {
        if (k.length === 1) {
            node[k] = restoreTrie(Object.create(Object.getPrototypeOf(node)), snap[k]);
        } else if (k !== 'word') {
            node[k] = snap[k];
        }
    });
    if (node.meta) {
        node.meta.word = snap.word;
    }
    return node;
}

function mockUiHost() {
    jest.doMock(src('content_scripts/uiframe.js'), () => ({
        __esModule: true,
        default: (browser, onload) => {
            const host = document.createElement('div');
            host.attachShadow({ mode: 'open' });
            host.tryDetach = jest.fn();
            // after the caller has stored its promise, as the real frame's ack comes
            Promise.resolve().then(() => onload(host));
        },
    }));
}

/**
 * Boot the content script on a page whose body is `html`.
 *
 * @param {object} [opts]
 * @param {string} [opts.html] the page's body.
 * @param {object} [opts.answers] background answers by action, over BOOT_ANSWERS
 *   (see installChromeMock).
 * @returns everything a test drives or observes: the module instances (normal,
 *   insert, hints, visual, front, api, clipboard), Mode, runtime and RUNTIME, the
 *   chrome mock (chrome, sent, held, answers, deliver), frontCmd and ui(action)
 *   for requests to the UI, toUiHost, the system clipboard board, and press,
 *   clickInto, settingsUpdated, message, runUserScript, settle and keepKeys
 *   (snapshots the keymaps and the conf; returns what puts them back).
 */
export async function bootContent({ html = '<p>page</p>', answers = {} } = {}) {
    const board = installJsdomShims();
    const ext = installChromeMock({ answers: Object.assign({}, BOOT_ANSWERS, answers) });
    document.body.innerHTML = html;
    const made = captureInstances();
    mockUiHost();

    const { RUNTIME, runtime } = require(src('content_scripts/common/runtime.js'));
    const toUiHost = jest.spyOn(runtime, 'postTopMessage').mockImplementation(() => {});
    require(src('content_scripts/chrome.js'));
    const Mode = require(src('content_scripts/common/mode.js')).default;
    // getSettings, then getState, then the showStatus that brings the frontend up
    await settle();

    const frontCmd = made.front.command;
    // what the settings API and settingsUpdated change: the keymaps, the keys
    // that act in every mode (Mode.specialKeys) and the conf
    const keepKeys = () => {
        const tries = ['normal', 'insert', 'visual'].map((name) => [made[name], made[name].mappings, snapshotTrie(made[name].mappings)]);
        const specialKeys = JSON.parse(JSON.stringify(Mode.specialKeys));
        const conf = Object.assign({}, runtime.conf);
        return () => {
            // unmapAllExcept gives a mode a new root
            tries.forEach(([mode, root, snap]) => {
                mode.mappings = restoreTrie(root, snap);
                mode.map_node = root;
            });
            Object.keys(Mode.specialKeys).forEach((k) => delete Mode.specialKeys[k]);
            Object.assign(Mode.specialKeys, specialKeys);
            Object.keys(runtime.conf).forEach((k) => delete runtime.conf[k]);
            Object.assign(runtime.conf, conf);
        };
    };
    return Object.assign(ext, made, {
        Mode,
        RUNTIME,
        runtime,
        board,
        frontCmd,
        keepKeys,
        toUiHost,
        press,
        settle,
        // the page's requests to the UI in this test, `action` ones only if given
        ui: (action) => frontCmd.mock.calls.map((call) => call[0]).filter((a) => !action || a.action === action),
        // a user clicking into `el`; an editable one puts the page in Insert mode
        clickInto: (el) => {
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            el.focus();
        },
        // the background's broadcast after a settings change, which every tab also
        // answers by asking for its state again (getState); what was sent before
        // is dropped with it, so `sent` shows what follows
        settingsUpdated: (settings) => {
            ext.deliver({ subject: 'settingsUpdated', settings });
            ext.chrome.runtime.sendMessage.mockClear();
        },
        // a message from the frontend, as front.js receives it
        message: (data) => {
            const event = new MessageEvent('message', { data: { surfingkeys_content_data: data } });
            window.dispatchEvent(event);
            return event;
        },
        // the user's settings snippet, run the way the MV3 user script runs it
        runUserScript: (uf) => {
            require(src('user_scripts/index.js')).default(ext.chrome.runtime.getURL('/'), uf);
        },
    });
}
