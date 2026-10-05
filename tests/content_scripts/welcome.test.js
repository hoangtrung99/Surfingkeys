// The welcome screen of start.html (content_scripts/welcome.js), against its
// real markup.
import fs from 'fs';
import path from 'path';

const START_HTML = fs.readFileSync(path.join(__dirname, '../../src/pages/start.html'), 'utf8');

// the browser, and so the build, the page runs in (jsdom's user agent names none)
let mockBrowserName = 'Chrome';
jest.mock('../../src/content_scripts/common/browserName.js', () => ({getBrowserName: () => mockBrowserName}));

function setup(commands, browser = 'Chrome') {
    mockBrowserName = browser;
    const sent = [];
    let current = commands;
    global.chrome = {
        runtime: {
            id: 'surfingkeys',
            lastError: undefined,
            sendMessage: jest.fn((message) => sent.push(message)),
            onMessage: {addListener: jest.fn()},
        },
        tabs: {create: jest.fn()},
        commands: {getAll: jest.fn((cb) => cb(current))},
    };
    document.documentElement.innerHTML = START_HTML.replace(/<script[^>]*><\/script>/g, '');
    let welcome;
    jest.isolateModules(() => {
        welcome = require('../../src/content_scripts/welcome.js').default(document.getElementById('welcome'));
    });
    const $ = (id) => document.getElementById(id);
    return {welcome, sent, $, setCommands: (c) => {
        current = c;
    }};
}

const ASSIGNED = [{name: 'commandPalette', shortcut: 'Ctrl+Shift+K'}, {name: 'tabSwitcher', shortcut: 'Alt+Q'}];
const UNASSIGNED = [{name: 'commandPalette', shortcut: ''}, {name: 'tabSwitcher', shortcut: 'Alt+Q'}];

describe('welcome', () => {
    test('shows each browser shortcut as the browser has it, and asks for no fix', () => {
        const {$} = setup(ASSIGNED);
        expect($('paletteKey').textContent).toBe('Browser shortcut: Ctrl+Shift+K');
        expect($('switcherKey').textContent).toBe('Browser shortcut: Alt+Q');
        expect($('shortcutFix').hidden).toBe(true);
        expect($('tryIt').textContent).toBe('Try it now: press Ctrl+Shift+K to open the palette on this page.');
        expect($('inPagePaletteKey').textContent).toBe('Ctrl+Shift+P');
    });

    test('says which shortcut got no key and why, and offers the fix', () => {
        const {$} = setup(UNASSIGNED);
        expect($('paletteKey').querySelector('.sk_unassigned').textContent).toBe('Not assigned');
        expect($('shortcutFix').hidden).toBe(false);
        expect($('shortcutFixText').textContent).toMatch(/^Command palette got no browser shortcut: another extension or the browser already uses its key/);
        // the key that works without one
        expect($('tryIt').textContent).toContain('Ctrl+Shift+P');
    });

    test('names both when both are missing', () => {
        const {$} = setup([{name: 'commandPalette', shortcut: ''}, {name: 'tabSwitcher', shortcut: ''}]);
        expect($('shortcutFixText').textContent).toMatch(/^Command palette and Tab switcher got no browser shortcut/);
    });

    test('opens the browser\'s shortcut settings from the fix button', () => {
        const {$} = setup(UNASSIGNED);
        $('fixShortcuts').click();
        expect(chrome.tabs.create).toHaveBeenCalledWith({url: 'chrome://extensions/shortcuts'});
    });

    test('reads the shortcuts again when the user comes back to the page', () => {
        const {$, setCommands} = setup(UNASSIGNED);
        setCommands(ASSIGNED);
        window.dispatchEvent(new Event('focus'));
        expect($('paletteKey').textContent).toBe('Browser shortcut: Ctrl+Shift+K');
        expect($('shortcutFix').hidden).toBe(true);
    });

    test('picks a theme the way the theme menu does, and marks the one in use', () => {
        const {welcome, sent, $} = setup(ASSIGNED);
        welcome.showTheme('gruvbox');
        expect(document.querySelector('#welcomeThemes input:checked').value).toBe('gruvbox');
        expect($('welcomeThemeName').textContent).toBe('Gruvbox');
        const latte = document.querySelector('#welcomeThemes input[value=latte]');
        latte.checked = true;
        latte.dispatchEvent(new Event('change'));
        expect(sent).toEqual([expect.objectContaining({action: 'localData', data: {paletteTheme: 'latte'}})]);
        expect($('welcomeStatus').textContent).toBe('Theme: Catppuccin Latte');
    });

    test('is shown only when asked', () => {
        const {welcome, $} = setup(ASSIGNED);
        expect($('welcome').hidden).toBe(true);
        welcome.show(true);
        expect($('welcome').hidden).toBe(false);
        expect(document.title).toBe('Welcome to Surfingkeys');
        welcome.show(false);
        expect($('welcome').hidden).toBe(true);
        expect(document.title).toBe('Surfingkeys');
    });

    test('points to the new tab page\'s setup in the Chromium build', () => {
        const {$} = setup(ASSIGNED);
        expect($('welcomeNewTab').hidden).toBe(false);
        expect($('welcomeNewTab').querySelector('a').getAttribute('href')).toBe('options.html#newtab');
    });

    test.each(['Firefox', 'Safari', 'Safari-iOS'])('leaves the new tab page out in %s, whose build has no page', (browser) => {
        const {$} = setup(ASSIGNED, browser);
        expect($('welcomeNewTab').hidden).toBe(true);
    });
});
