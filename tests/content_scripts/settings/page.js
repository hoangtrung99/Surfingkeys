// The settings page in jsdom for section tests: options.html, the shell, a fake
// background that keeps storage the way start.js does, and a fake Ace whose
// session reports lint results the way the worker does.
import createSettingsPage from '../../../src/content_scripts/options/shell.js';

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '../../../src/pages/options.html'), 'utf8');

function FakeMode(name) {
    this.name = name;
    this.addEventListener = jest.fn();
    this.enter = jest.fn();
    this.exit = jest.fn();
}
FakeMode.getCurrent = () => null;
FakeMode.isSpecialKeyOf = () => false;

// An Ace editor as far as the Advanced section uses one: its text, change events,
// and a session whose annotations the test sets (the worker's answer).
export function fakeAce() {
    const made = {editor: null};
    const ace = {
        edit(el) {
            if (made.editor) {
                return made.editor;
            }
            el.append(document.createElement('textarea'));
            const listeners = {change: [], changeAnnotation: []};
            let value = '';
            let annotations = [];
            const session = {
                setMode() {},
                on: (name, fn) => listeners[name] && listeners[name].push(fn),
                off: (name, fn) => {
                    listeners[name] = (listeners[name] || []).filter((f) => f !== fn);
                },
                getAnnotations: () => annotations,
                setAnnotations(list) {
                    annotations = list;
                    listeners.changeAnnotation.slice().forEach((fn) => fn());
                },
            };
            made.editor = {
                container: el,
                setValue: jest.fn((v) => {
                    value = '';
                    listeners.change.forEach((fn) => fn());
                    value = v;
                    listeners.change.forEach((fn) => fn());
                }),
                // what typing does: one change
                type(v) {
                    value = v;
                    listeners.change.forEach((fn) => fn());
                },
                getValue: () => value,
                setTheme() {},
                setOptions() {},
                setKeyboardHandler() {},
                getSession: () => session,
                resize() {},
                focus: jest.fn(),
                on: (name, fn) => listeners[name] && listeners[name].push(fn),
                session,
            };
            return made.editor;
        },
        config: {loadModule() {}, set: jest.fn(), setModuleUrl: jest.fn()},
    };
    return {ace, made};
}

// Every boot builds a new page in the same window: the listeners the last one
// left on window would answer for it (Ctrl-s, focus, beforeunload).
const windowListeners = [];
const addListener = window.addEventListener.bind(window);
window.addEventListener = function(...args) {
    windowListeners.push(args);
    return addListener(...args);
};

export function boot({hash = '', stored = {}, browser = 'Chrome', reply = {}} = {}) {
    windowListeners.splice(0).forEach((args) => window.removeEventListener(...args));
    document.documentElement.innerHTML = HTML.replace(/^[\s\S]*?<html[^>]*>/, '').replace(/<\/html>[\s\S]*$/, '');
    document.title = 'Surfingkeys Settings';
    window.history.replaceState(null, '', `/pages/options.html${hash}`);
    window.scrollTo = jest.fn();
    const storageListeners = [];
    global.chrome = {
        runtime: {getManifest: () => ({version: '9.9.9'}), id: 'ext', getURL: (p) => `chrome-extension://ext/${p}`},
        storage: {onChanged: {addListener: (fn) => storageListeners.push(fn)}},
        tabs: {create: jest.fn()},
    };
    const {ace, made} = fakeAce();
    global.ace = ace;
    const sent = [];
    const local = JSON.parse(JSON.stringify(stored));
    // local storage first, which tells every page through onChanged
    function store(diff) {
        const changes = {};
        Object.keys(diff).forEach((k) => {
            changes[k] = {oldValue: local[k], newValue: diff[k]};
            local[k] = diff[k];
        });
        storageListeners.forEach((fn) => fn(JSON.parse(JSON.stringify(changes)), 'local'));
    }
    const RUNTIME = jest.fn((action, args, cb) => {
        sent.push({action, args: args === null ? null : JSON.parse(JSON.stringify(args))});
        if (reply[action]) {
            const answer = reply[action](args, local, store);
            if (answer !== undefined) {
                cb && cb(answer);
            }
            return;
        }
        if (action === 'localData' && typeof args.data === 'string') {
            cb && cb({data: {[args.data]: local[args.data]}});
        } else if (action === 'localData') {
            store(args.data);
        } else if (action === 'updateSettings') {
            store(JSON.parse(JSON.stringify(args.settings)));
            cb && cb({error: ''});
        } else if (action === 'getSettings') {
            const key = args && args.key;
            let settings;
            if (key === 'RAW' || !key) {
                settings = JSON.parse(JSON.stringify(local));
            } else {
                settings = {};
                [].concat(key).forEach((k) => {
                    settings[k] = local[k] === undefined ? undefined : JSON.parse(JSON.stringify(local[k]));
                });
            }
            cb && cb({settings});
        }
    });
    const deps = {
        RUNTIME,
        KeyboardUtils: {encodeKeystroke: (k) => k, decodeKeystroke: (k) => k},
        Mode: FakeMode,
        createElementWithContent: jest.fn(),
        getBrowserName: () => browser,
        htmlEncode: (s) => s,
        initL10n: (cb) => cb((s) => s),
        reportIssue: jest.fn(),
        setSanitizedContent: jest.fn(),
        showBanner: jest.fn(),
    };
    const ctx = createSettingsPage(deps);
    return {ctx, deps, sent, local, store, made, storageListeners};
}

// what content.js hands the page once Surfingkeys has started on it
export function loadSettings(settings) {
    // the Keys section lists the defaults from getMetas; no default mappings here
    const normal = {passFocus: jest.fn(), mappings: {find: (k) => ({meta: {annotation: `#1Action ${k}`}}), getMetas: () => []}};
    document.dispatchEvent(new CustomEvent('surfingkeys:defaultSettingsLoaded', {detail: {normal, api: {}}}));
    const frontCommand = jest.fn((msg, cb) => cb({aliases: {g: {prompt: 'google'}}}));
    document.dispatchEvent(new CustomEvent('surfingkeys:userSettingsLoaded', {detail: {settings, frontCommand}}));
}

export function writes(sent, action = 'updateSettings') {
    return sent.filter((m) => m.action === action).map((m) => m.args.settings);
}
