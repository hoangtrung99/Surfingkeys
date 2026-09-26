// The settings page shell in jsdom: sidebar, routing, colours, and that opening
// the page sends nothing that writes storage.
import createSettingsPage from '../../../src/content_scripts/options/shell.js';
import { LAST_SECTION_KEY } from '../../../src/content_scripts/options/router.js';
import { PALETTES } from '../../../src/content_scripts/common/themes.js';

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
function FakeMode(name) {
    this.name = name;
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
    window.scrollTo = jest.fn();
    global.chrome = {
        runtime: {getManifest: () => ({version: '9.9.9'}), id: 'ext'},
        storage: {onChanged: {addListener: (fn) => storageListeners.push(fn)}},
        tabs: {create: jest.fn()},
    };
    const sent = [];
    const RUNTIME = jest.fn((action, args, cb) => {
        sent.push({action, args});
        if (action === 'localData' && typeof args.data === 'string') {
            cb && cb({data: {[args.data]: stored.paletteTheme}});
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
    return {ctx, deps, sent};
}

function visible() {
    return Array.from(document.querySelectorAll('.sk-section')).filter((s) => !s.hidden).map((s) => s.dataset.section);
}

// what content.js hands the page once Surfingkeys has started on it
function loadSettings(settings) {
    const normal = {
        passFocus: jest.fn(),
        mappings: {find: (k) => ({meta: {annotation: `#1Action ${k}`}})},
    };
    document.dispatchEvent(new CustomEvent('surfingkeys:defaultSettingsLoaded', {detail: {normal, api: {}}}));
    const frontCommand = jest.fn((msg, cb) => cb({aliases: {g: {prompt: "google<span class='separator'>➤</span>"}}}));
    global.ace = {
        edit(el) {
            el.append(document.createElement('textarea'));
            return {container: el, setValue: jest.fn(), getValue: () => '', setTheme() {}, setOptions() {},
                setKeyboardHandler() {}, getSession: () => ({setMode() {}}), resize() {}};
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
            || m.action === 'resetSettings' || (m.action === 'localData' && typeof m.args.data !== 'string'));
        expect(writes).toEqual([]);
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
