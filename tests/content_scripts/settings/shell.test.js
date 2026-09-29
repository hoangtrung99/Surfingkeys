// The settings page shell in jsdom: sidebar, routing, colours, and that opening
// the page sends nothing that writes storage.
import createSettingsPage from '../../../src/content_scripts/options/shell.js';
import { LAST_SECTION_KEY } from '../../../src/content_scripts/options/router.js';
import { PALETTES } from '../../../src/content_scripts/common/themes.js';
import { ALIAS_TRIES } from '../../../src/content_scripts/options/search.js';

const fs = require('fs');
const path = require('path');

jest.mock('../../../src/content_scripts/common/runtime.js', () => ({
    RUNTIME: jest.fn(),
    dispatchSKEvent: jest.fn(),
    runtime: { conf: {} },
}));

const HTML = fs.readFileSync(path.join(__dirname, '../../../src/pages/options.html'), 'utf8');
const SECTIONS = ['appearance', 'keys', 'search', 'sites', 'advanced', 'proxy', 'backup', 'about'];

// the Mode surface the Keys section's key picker uses
let modes;
function FakeMode(name) {
    this.name = name;
    modes[name] = this;
    this.addEventListener = jest.fn();
    this.enter = jest.fn();
    this.exit = jest.fn();
}
FakeMode.getCurrent = () => null;
FakeMode.isSpecialKeyOf = () => false;

let storageListeners;

function boot({hash = '', stored = {}, browser = 'Chrome'} = {}) {
    document.documentElement.innerHTML = HTML.replace(/^[\s\S]*?<html[^>]*>/, '').replace(/<\/html>[\s\S]*$/, '');
    window.history.replaceState(null, '', `/pages/options.html${hash}`);
    storageListeners = [];
    modes = {};
    window.scrollTo = jest.fn();
    global.chrome = {
        runtime: {getManifest: () => ({version: '9.9.9'}), id: 'ext'},
        storage: {onChanged: {addListener: (fn) => storageListeners.push(fn)}},
        tabs: {create: jest.fn()},
    };
    const sent = [];
    // What the background does with a write: local storage first, which tells
    // every page through onChanged, then the reply.
    const local = Object.assign({}, stored);
    function store(diff) {
        const changes = {};
        Object.keys(diff).forEach((k) => {
            changes[k] = {oldValue: local[k], newValue: diff[k]};
            local[k] = diff[k];
        });
        storageListeners.forEach((fn) => fn(JSON.parse(JSON.stringify(changes)), 'local'));
    }
    const RUNTIME = jest.fn((action, args, cb) => {
        sent.push({action, args: JSON.parse(JSON.stringify(args))});
        if (action === 'localData' && (typeof args.data === 'string' || Array.isArray(args.data))) {
            cb && cb({data: Object.fromEntries([].concat(args.data).map((k) => [k, local[k]]))});
        } else if (action === 'updateSettings') {
            store(args.settings);
            cb && cb({error: ''});
        } else if (action === 'updateProxy' && args.mode) {
            store({proxyMode: args.mode});
            cb && cb({proxyMode: args.mode});
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
    return {ctx, deps, sent, local};
}

function visible() {
    return Array.from(document.querySelectorAll('.sk-section')).filter((s) => !s.hidden).map((s) => s.dataset.section);
}

// the Ace editor of the Advanced section
let editor;

// what content.js hands the page once Surfingkeys has started on it
function loadSettings(settings, aliases) {
    const normal = {
        passFocus: jest.fn(),
        mappings: {getMetas: () => ['d', 'x', 'j', 'e'].map((word) => ({word, annotation: `Action ${word}`, feature_group: 1}))},
    };
    document.dispatchEvent(new CustomEvent('surfingkeys:defaultSettingsLoaded', {detail: {normal, api: {}}}));
    const frontCommand = jest.fn((msg, cb) => cb({aliases: aliases || {g: {prompt: "google<span class='separator'>➤</span>"}}}));
    global.ace = {
        edit(el) {
            el.append(document.createElement('textarea'));
            let value = '';
            editor = {container: el, setValue: jest.fn((v) => {
                value = v;
            }), getValue: () => value, setTheme() {}, setOptions() {},
            setKeyboardHandler() {}, getSession: () => ({setMode() {}}), resize() {}};
            return editor;
        },
        config: {loadModule() {}},
    };
    document.dispatchEvent(new CustomEvent('surfingkeys:userSettingsLoaded', {detail: {settings, frontCommand}}));
    return {normal, frontCommand};
}

let consoleError;
beforeEach(() => {
    window.localStorage.clear();
    consoleError = jest.spyOn(console, 'error');
});
afterEach(() => {
    // the shell logs a section that throws instead of failing the page: none may
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
});

describe('settings shell', () => {
    test('lists every section in the sidebar, in order, each labelled by its heading', () => {
        boot();
        const links = Array.from(document.querySelectorAll('nav[aria-label=Settings] a'));
        expect(links.map((a) => a.getAttribute('href'))).toEqual(SECTIONS.map((s) => `#${s}`));
        document.querySelectorAll('.sk-section').forEach((s) => {
            expect(document.getElementById(s.getAttribute('aria-labelledby')).tagName).toBe('H2');
        });
        expect(document.getElementById('settingsVersion').textContent).toBe('v9.9.9');
    });

    test('keeps the ids external docs and scripts know', () => {
        boot();
        ['advancedToggler', 'save_button', 'localPath', 'mappings', 'basicMappings', 'searchAliases', 'proxySettings',
            'proxyMode', 'addProxyPair', 'resetSettings', 'keyPicker', 'inputKey', 'templateProxyPair', 'sample']
            .forEach((id) => expect(document.getElementById(id)).not.toBeNull());
    });

    test('leaves Proxy out where the browser has no proxy API', () => {
        boot({browser: 'Firefox'});
        expect(document.querySelector('a[href="#proxy"]')).toBeNull();
        expect(document.getElementById('proxySettings')).toBeNull();
    });

    test('opens on the section in the URL, then the one visited last, then Appearance', () => {
        boot({hash: '#search'});
        expect(visible()).toEqual(['search']);
        expect(document.querySelector('a[aria-current=page]').getAttribute('href')).toBe('#search');

        window.localStorage.setItem(LAST_SECTION_KEY, 'proxy');
        boot();
        expect(visible()).toEqual(['proxy']);
        expect(window.location.hash).toBe('#proxy');

        window.localStorage.clear();
        boot({hash: '#nope'});
        expect(visible()).toEqual(['appearance']);
    });

    test('follows the hash, and remembers only what the user navigated to', async () => {
        boot();
        expect(window.localStorage.getItem(LAST_SECTION_KEY)).toBe(null);
        window.location.hash = 'keys';
        await new Promise((r) => setTimeout(r, 0));
        expect(visible()).toEqual(['keys']);
        expect(window.localStorage.getItem(LAST_SECTION_KEY)).toBe('keys');
    });

    test('opening the page and loading its settings writes nothing', () => {
        const {sent} = boot();
        loadSettings({basicMappings: {d: 'q'}, disabledSearchAliases: {w: 'bing'}, showAdvanced: false, isMV3: true, isUserScriptsAvailable: false});
        const writes = sent.filter((m) => m.action === 'updateSettings' || m.action === 'updateProxy'
            || m.action === 'resetSettings' || (m.action === 'localData' && m.args.data.constructor === Object));
        expect(writes).toEqual([]);
    });

    test('the link of the section on screen ends a search', () => {
        boot({hash: '#keys'});
        const filter = document.getElementById('settingsFilter');
        filter.value = 'proxy';
        filter.dispatchEvent(new Event('input'));
        expect(document.getElementById('settingsMain').classList.contains('sk-filtering')).toBe(true);
        document.getElementById('settingsLink-keys').click();
        expect(filter.value).toBe('');
        expect(document.getElementById('settingsMain').classList.contains('sk-filtering')).toBe(false);
        expect(visible()).toEqual(['keys']);
    });

    test('lets Tab reach the fields: Surfingkeys may not blur them here', () => {
        boot();
        const {normal} = loadSettings({showAdvanced: false});
        expect(normal.passFocus).toHaveBeenCalledWith(true);
    });

    test('is drawn in the stored theme and follows a pick made elsewhere', () => {
        boot({stored: {paletteTheme: 'nord'}});
        const tokens = document.getElementById('sk_settings_tokens').textContent;
        expect(tokens).toContain(`--bg: ${PALETTES.nord.bg};`);
        expect(document.documentElement.dataset.scheme).toBe('dark');
        expect(document.querySelector('input[name=theme]:checked').value).toBe('nord');

        storageListeners.forEach((fn) => fn({paletteTheme: {newValue: 'latte'}}, 'local'));
        expect(document.getElementById('sk_settings_tokens').textContent).toContain(`--bg: ${PALETTES.latte.bg};`);
        expect(document.documentElement.dataset.scheme).toBe('light');
        expect(document.querySelector('input[name=theme]:checked').value).toBe('latte');

        // a reset removes the pick: back to the default
        storageListeners.forEach((fn) => fn({paletteTheme: {oldValue: 'latte'}}, 'local'));
        expect(document.querySelector('input[name=theme]:checked').value).toBe('mocha');
    });

    describe('Auto', () => {
        let system;
        beforeEach(() => {
            const listeners = [];
            const mql = {matches: true, addEventListener: (type, fn) => listeners.push(fn)};
            window.matchMedia = jest.fn(() => mql);
            system = {set(dark) {
                mql.matches = dark;
                listeners.forEach((fn) => fn({matches: dark}));
            }};
        });
        afterEach(() => {
            delete window.matchMedia;
        });
        const bg = () => document.getElementById('sk_settings_tokens').textContent.match(/--bg: (#[0-9a-f]+);/)[1];

        test('draws the page in the side of the pair the system asks for, live', () => {
            boot({stored: {paletteTheme: 'auto', paletteThemePair: {dark: 'nord', light: 'dawn'}}});
            expect(bg()).toBe(PALETTES.nord.bg);
            expect(document.documentElement.dataset.scheme).toBe('dark');
            expect(document.querySelector('input[name=theme]:checked').value).toBe('auto');
            system.set(false);
            expect(bg()).toBe(PALETTES.dawn.bg);
            expect(document.documentElement.dataset.scheme).toBe('light');
            // a pair changed elsewhere
            storageListeners.forEach((fn) => fn({paletteThemePair: {newValue: {dark: 'nord', light: 'github'}}}, 'local'));
            expect(bg()).toBe(PALETTES.github.bg);
            expect(document.getElementById('themePairLight').value).toBe('github');
        });

        test('the Auto card comes first and shows the pair, the default until one is kept', () => {
            boot();
            const cards = Array.from(document.querySelectorAll('.sk-themes .sk-theme-card'));
            expect(cards[0].dataset.theme).toBe('auto');
            expect(document.getElementById('themePairDark').value).toBe('mocha');
            expect(document.getElementById('themePairLight').value).toBe('latte');
            const options = (id) => Array.from(document.getElementById(id).options).map((o) => o.value);
            expect(options('themePairDark')).toEqual(Object.keys(PALETTES).filter((id) => !PALETTES[id].light));
            expect(options('themePairLight')).toEqual(Object.keys(PALETTES).filter((id) => PALETTES[id].light));
            expect(Array.from(cards[0].querySelectorAll('.sk-preview')).map((p) => p.dataset.theme)).toEqual(['mocha', 'latte']);
        });

        test('the pair and the Auto pick are sent the way the theme menu sends a pick', () => {
            const {sent} = boot({stored: {paletteTheme: 'nord'}});
            const picks = () => sent.filter((m) => m.action === 'localData' && m.args.data.constructor === Object && 'paletteTheme' in m.args.data);
            const dark = document.getElementById('themePairDark');
            dark.value = 'gruvbox';
            dark.dispatchEvent(new Event('change'));
            expect(sent).toContainEqual({action: 'localData', args: {data: {paletteThemePair: {dark: 'gruvbox', light: 'latte'}}}});
            // the pair is what Auto draws from; changing it leaves the pick alone
            expect(picks()).toEqual([]);

            const auto = document.querySelector('input[name=theme][value=auto]');
            auto.checked = true;
            auto.dispatchEvent(new Event('change'));
            expect(picks()).toEqual([{action: 'localData', args: {data: {paletteTheme: 'auto'}}}]);
        });
    });

    test('a picked card sends the pick the way the theme menu does', () => {
        const {sent} = boot();
        const input = document.querySelector('input[name=theme][value=dracula]');
        input.checked = true;
        input.dispatchEvent(new Event('change'));
        expect(sent).toContainEqual({action: 'localData', args: {data: {paletteTheme: 'dracula'}}});
    });

    test('shows the mode in the header, and a change made on the page', () => {
        const {ctx} = boot();
        loadSettings({showAdvanced: false});
        expect(document.getElementById('settingsMode').textContent).toBe('Basic mode');
        ctx.patch({showAdvanced: true});
        expect(document.getElementById('settingsMode').textContent).toBe('Advanced mode · script');
    });
});

describe('search engines section', () => {
    test('asks for the aliases a bounded number of times, then says there are none', () => {
        jest.useFakeTimers();
        try {
            boot({hash: '#search'});
            const {frontCommand} = loadSettings({showAdvanced: false}, {});
            jest.advanceTimersByTime(60000);
            expect(frontCommand).toHaveBeenCalledTimes(ALIAS_TRIES);
            expect(ALIAS_TRIES).toBe(10);
            expect(document.getElementById('searchAliasesStatus').textContent).toBe('No search engines found.');
            expect(document.getElementById('searchAliasesStatus').hidden).toBe(false);
        } finally {
            jest.useRealTimers();
        }
    });

    test('lists the aliases once a later try finds them', () => {
        jest.useFakeTimers();
        try {
            boot({hash: '#search'});
            const {frontCommand} = loadSettings({showAdvanced: false}, {});
            jest.advanceTimersByTime(1000);
            frontCommand.mockImplementation((msg, cb) => cb({aliases: {g: {prompt: 'google'}}}));
            jest.advanceTimersByTime(60000);
            expect(frontCommand.mock.calls.length).toBeLessThan(ALIAS_TRIES);
            expect(document.getElementById('searchAlias-g')).not.toBeNull();
            expect(document.getElementById('searchAliasesStatus').hidden).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('changes made on the page', () => {
    // the key picker's keydown handler, fed the way Mode feeds it
    function pickKey(origin, key) {
        document.querySelector(`#basicMappings button[data-origin="${origin}"]`).click();
        const handler = modes.KeyPicker.addEventListener.mock.calls.find((c) => c[0] === 'keydown')[1];
        const press = (keyCode, sk_keyName) => handler({keyCode, sk_keyName: sk_keyName || ''});
        origin.split('').forEach(() => press(8));
        press(key.charCodeAt(0), key);
        press(13);
    }
    function flip(id, checked) {
        const input = document.getElementById(id);
        input.checked = checked;
        input.dispatchEvent(new Event('change'));
    }

    test('survive a mode switch, in the sections and in the next write', () => {
        const {sent, local} = boot({hash: '#search'});
        loadSettings({showAdvanced: false, isMV3: true, isUserScriptsAvailable: true, disabledSearchAliases: {},
            basicMappings: {}, proxyMode: 'clear', proxy: [], autoproxy_hosts: [], snippets: '// OLD snippet'},
        {g: {prompt: 'google'}, w: {prompt: 'bing'}});

        flip('searchAlias-w', false);
        pickKey('d', 'q');
        const mode = document.getElementById('proxyModeSelect');
        mode.value = 'byhost';
        mode.dispatchEvent(new Event('change'));
        flip('advancedToggler', true);
        editor.setValue('// NEW snippet');
        document.getElementById('save_button').click();
        expect(local.snippets).toBe('// NEW snippet');

        flip('advancedToggler', false);
        // keys are read-only in advanced mode
        pickKey('x', 'X');
        flip('advancedToggler', true);

        expect(document.getElementById('searchAlias-w').checked).toBe(false);
        expect(document.querySelector('#basicMappings button[data-origin="d"]').textContent).toBe('q');
        expect(mode.value).toBe('byhost');
        expect(editor.getValue()).toBe('// NEW snippet');

        flip('searchAlias-g', false);
        document.getElementById('save_button').click();
        expect(local.disabledSearchAliases).toEqual({w: 'bing', g: 'google'});
        expect(local.basicMappings).toEqual({d: 'q', x: 'X'});
        expect(local.proxyMode).toBe('byhost');
        expect(sent.filter((m) => m.action === 'updateSettings' && 'snippets' in m.args.settings)
            .map((m) => m.args.settings.snippets)).toEqual(['// NEW snippet', '// NEW snippet']);
    });

    test('made in another tab are what a mode switch shows', () => {
        const {ctx} = boot({hash: '#search'});
        loadSettings({showAdvanced: false, disabledSearchAliases: {}}, {g: {prompt: 'google'}});
        storageListeners.forEach((fn) => fn({disabledSearchAliases: {newValue: {g: 'google'}}}, 'sync'));
        ctx.patch({showAdvanced: false});
        expect(document.getElementById('searchAlias-g').checked).toBe(true);
        storageListeners.forEach((fn) => fn({disabledSearchAliases: {newValue: {g: 'google'}}}, 'local'));
        ctx.patch({showAdvanced: false});
        expect(document.getElementById('searchAlias-g').checked).toBe(false);
    });
});
