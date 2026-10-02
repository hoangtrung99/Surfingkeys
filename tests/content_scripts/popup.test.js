// The toolbar popup (content_scripts/popup.js) and what it shares with the
// welcome page (common/quickControls.js), against its real markup.
import fs from 'fs';
import path from 'path';
import { NO_THEME, PALETTES, THEME_IDS } from '../../src/content_scripts/common/themes.js';

const POPUP_HTML = fs.readFileSync(path.join(__dirname, '../../src/pages/popup.html'), 'utf8');

function makeEvent() {
    const listeners = [];
    return {listeners, addListener: jest.fn((fn) => listeners.push(fn)), fire: (...args) => listeners.forEach((fn) => fn(...args))};
}

// what the popup reaches: the background over sendMessage, the active tab,
// storage and the browser shortcuts
function mockChrome({url = 'https://github.com/brookhong/Surfingkeys', blocklist = {}, theme, commands, patterns} = {}) {
    const sent = [];
    const answers = {
        getSettings: () => ({settings: {blocklist: {...blocklist}}}),
        toggleBlocklist: (m) => {
            const key = m.origin === undefined ? '.*' : m.origin;
            key in blocklist ? delete blocklist[key] : (blocklist[key] = 1);
            return {blocklist: {...blocklist}, url: key};
        },
    };
    global.chrome = {
        runtime: {
            id: 'surfingkeys',
            lastError: undefined,
            getManifest: () => ({version: '1.2.3'}),
            getURL: (p) => `chrome-extension://surfingkeys${p}`,
            sendMessage: jest.fn((message, cb) => {
                sent.push(message);
                const answer = answers[message.action];
                cb && answer && cb(answer(message));
            }),
            onMessage: makeEvent(),
        },
        tabs: {
            query: jest.fn((info, cb) => cb(url ? [{id: 7, url}] : [])),
            create: jest.fn(),
            // the page's Surfingkeys, when it has one
            sendMessage: jest.fn((id, message, opts, cb) => {
                if (message.subject === 'getPagePatterns' && patterns) {
                    cb(patterns);
                } else {
                    global.chrome.runtime.lastError = {message: 'Could not establish connection. Receiving end does not exist.'};
                    cb();
                    global.chrome.runtime.lastError = undefined;
                }
            }),
        },
        storage: {
            local: {get: jest.fn((key, cb) => cb(theme === undefined ? {} : {paletteTheme: theme}))},
            onChanged: makeEvent(),
        },
        commands: commands === null ? undefined : {
            getAll: jest.fn((cb) => cb(commands || [
                {name: '_execute_action', shortcut: ''},
                {name: 'commandPalette', shortcut: 'Ctrl+Shift+K'},
                {name: 'tabSwitcher', shortcut: 'Alt+Q'},
            ])),
        },
    };
    return sent;
}

function openPopup(opts) {
    const sent = mockChrome(opts);
    document.documentElement.innerHTML = POPUP_HTML.replace(/<script[^>]*><\/script>/g, '');
    window.close = jest.fn();
    jest.isolateModules(() => {
        require('../../src/content_scripts/popup.js');
    });
    const $ = (id) => document.getElementById(id);
    const actions = () => sent.map((m) => m.action);
    const change = (input) => input.dispatchEvent(new Event('change'));
    return {$, sent, actions, change};
}

describe('quick controls', () => {
    // runtime.js reaches for chrome as it loads
    let THEME_CHOICES, createThemePicker, pageTokens, readShortcuts, themeInUse;
    beforeAll(() => {
        mockChrome();
        ({THEME_CHOICES, createThemePicker, pageTokens, readShortcuts, themeInUse} = require('../../src/content_scripts/common/quickControls.js'));
    });

    test('offers every built-in theme in menu order, then Surfingkeys', () => {
        expect(THEME_CHOICES.map((t) => t.id)).toEqual(THEME_IDS.concat(NO_THEME));
    });

    test('shows the default theme when nothing was picked, as the pages do', () => {
        expect(themeInUse(undefined)).toBe('mocha');
        expect(themeInUse('nosuch')).toBe('mocha');
        expect(themeInUse(NO_THEME)).toBe(NO_THEME);
        expect(themeInUse('nord')).toBe('nord');
    });

    test.each(THEME_IDS)('gives the page the colours of %s', (id) => {
        const css = pageTokens(id);
        expect(css).toContain(`--bg:${PALETTES[id].surface || PALETTES[id].bg};`);
        expect(css).toContain(`--text:${PALETTES[id].text};`);
        expect(css).toContain(`color-scheme:${PALETTES[id].light ? 'light' : 'dark'};`);
        expect(css).not.toContain('undefined');
    });

    test('draws Auto as the side of the pair the system is on', () => {
        expect(themeInUse('auto', undefined, false)).toBe('latte');
        expect(themeInUse('auto', undefined, true)).toBe('mocha');
        expect(themeInUse('auto', {dark: 'nord', light: 'dawn'}, true)).toBe('nord');
        expect(themeInUse('auto', {dark: 'nord', light: 'dawn'}, false)).toBe('dawn');
        // a side that is not of its kind is the default's
        expect(themeInUse('auto', {dark: 'latte', light: 'mocha'}, false)).toBe('latte');
    });

    test('follows the system with Surfingkeys\' own look', () => {
        const css = pageTokens(NO_THEME);
        expect(css).toMatch(/^:root\{--bg:#ffffff;.*\}@media \(prefers-color-scheme: dark\)\{:root\{--bg:#1e1e2e;/);
    });

    test('swatches are one radio group; a pick made there is reported, a shown theme is not', () => {
        document.body.innerHTML = '<div id="swatches"></div>';
        const onPick = jest.fn();
        const picker = createThemePicker(document.getElementById('swatches'), onPick);
        const radios = [...document.querySelectorAll('#swatches input[type=radio]')];
        expect(radios).toHaveLength(THEME_CHOICES.length);
        expect(new Set(radios.map((r) => r.name)).size).toBe(1);
        expect(radios.map((r) => r.getAttribute('aria-label'))).toContain('Rosé Pine Dawn');

        picker.show('nord');
        expect(radios.filter((r) => r.checked).map((r) => r.value)).toEqual(['nord']);
        expect(onPick).not.toHaveBeenCalled();

        const dawn = radios.find((r) => r.value === 'dawn');
        dawn.checked = true;
        dawn.dispatchEvent(new Event('change'));
        expect(onPick).toHaveBeenCalledWith('dawn');
    });

    test('reads the fork\'s shortcuts only, a missing key as \'\'', () => {
        mockChrome({commands: [{name: 'tabSwitcher', shortcut: 'Alt+Q'}, {name: 'restartext'}, {name: 'commandPalette'}]});
        const cb = jest.fn();
        readShortcuts(cb);
        expect(cb).toHaveBeenCalledWith([
            {name: 'commandPalette', label: 'Command palette', shortcut: ''},
            {name: 'tabSwitcher', label: 'Tab switcher', shortcut: 'Alt+Q'},
        ]);
    });

    test('reads none where the browser has no commands API', () => {
        mockChrome({commands: null});
        const cb = jest.fn();
        readShortcuts(cb);
        expect(cb).toHaveBeenCalledWith([]);
    });
});

describe('popup', () => {
    test('names the site in the active tab and shows it on, writing nothing', () => {
        const {$, actions} = openPopup();
        expect(chrome.tabs.query).toHaveBeenCalledWith({active: true, lastFocusedWindow: true}, expect.any(Function));
        expect($('siteLabel').textContent).toBe('github.com');
        expect($('siteNote').textContent).toBe('On');
        expect($('siteSwitch').checked).toBe(true);
        expect($('siteSwitch').disabled).toBe(false);
        expect($('globalSwitch').checked).toBe(true);
        expect(actions()).toEqual(['getSettings', 'setSurfingkeysIcon']);
    });

    test('toggles the site by its origin, and says so', () => {
        const {$, sent, change} = openPopup();
        change($('siteSwitch'));
        expect(sent.find((m) => m.action === 'toggleBlocklist')).toMatchObject({origin: 'https://github.com'});
        expect($('siteSwitch').checked).toBe(false);
        expect($('siteNote').textContent).toBe('Off on this site');
        expect($('status').textContent).toBe('Surfingkeys off for github.com');
    });

    test('toggles all sites without naming one', () => {
        const {$, sent, change} = openPopup();
        change($('globalSwitch'));
        const toggle = sent.find((m) => m.action === 'toggleBlocklist');
        expect(toggle).not.toHaveProperty('origin');
        expect($('globalSwitch').checked).toBe(false);
        expect($('siteSwitch').disabled).toBe(true);
        expect($('siteNote').textContent).toBe('Off, with all sites');
        expect(sent.filter((m) => m.action === 'setSurfingkeysIcon').pop()).toMatchObject({status: 'disabled'});
    });

    test('shows a site turned off before, and all sites off', () => {
        let {$} = openPopup({blocklist: {'https://github.com': 1}});
        expect($('siteSwitch').checked).toBe(false);
        expect($('siteNote').textContent).toBe('Off on this site');
        ({$} = openPopup({blocklist: {'.*': 1}}));
        expect($('siteSwitch').checked).toBe(false);
        expect($('siteSwitch').disabled).toBe(true);
        expect($('globalNote').textContent).toBe('Off everywhere');
    });

    test('asks the page\'s own Surfingkeys whether a settings pattern takes it', () => {
        openPopup();
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, {subject: 'getPagePatterns'}, {frameId: 0}, expect.any(Function));
    });

    test('shows a page a blocklistPattern turns off as off, the switch out of reach', () => {
        const {$} = openPopup({patterns: {blocklist: true, lurking: false}});
        expect($('siteSwitch').checked).toBe(false);
        expect($('siteSwitch').disabled).toBe(true);
        expect($('siteNote').textContent).toBe('Off here: blocklistPattern in your settings');
    });

    test('shows a page a lurkingPattern takes as lurking, the switch still turning it off', () => {
        const {$, change} = openPopup({patterns: {blocklist: false, lurking: true}});
        expect($('siteSwitch').checked).toBe(true);
        expect($('siteSwitch').disabled).toBe(false);
        expect($('siteNote').textContent).toBe('Lurking here: lurkingPattern in your settings');
        change($('siteSwitch'));
        expect($('siteNote').textContent).toBe('Off on this site');
    });

    test('says all sites are off before naming a pattern', () => {
        const {$} = openPopup({blocklist: {'.*': 1}, patterns: {blocklist: true, lurking: false}});
        expect($('siteNote').textContent).toBe('Off, with all sites');
    });

    test.each([
        ['a browser page', 'chrome://extensions/', 'Surfingkeys does not run here'],
        ['another extension\'s page', 'chrome-extension://another/pages/options.html', 'Surfingkeys does not run here'],
        ['no tab at all', '', 'Surfingkeys does not run here'],
        ['a local file', 'file:///home/user/notes.html', 'Local files have no site switch'],
    ])('offers no site switch on %s', (what, url, note) => {
        const {$} = openPopup({url});
        expect($('siteSwitch').disabled).toBe(true);
        expect($('siteNote').textContent).toBe(note);
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test.each([
        ['the new tab page', 'chrome-extension://surfingkeys/pages/newtab.html?focus'],
        ['the settings page', 'chrome-extension://surfingkeys/pages/options.html#keys'],
    ])('shows Surfingkeys on, with no site switch, on its own page: %s', (what, url) => {
        const {$} = openPopup({url});
        expect($('siteSwitch').disabled).toBe(true);
        expect($('siteSwitch').checked).toBe(true);
        expect($('siteNote').textContent).toBe('Surfingkeys\' own page: no site switch');
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test('shows its own page off when all sites are', () => {
        const {$} = openPopup({url: 'chrome-extension://surfingkeys/pages/newtab.html?focus', blocklist: {'.*': 1}});
        expect($('siteSwitch').checked).toBe(false);
        expect($('siteNote').textContent).toBe('Off, with all sites');
    });

    test('picks a theme the way the theme menu does, and wears it', () => {
        const {$, sent} = openPopup({theme: 'latte'});
        expect($('themeName').textContent).toBe('Catppuccin Latte');
        expect(document.querySelector('#themes input:checked').value).toBe('latte');
        expect($('sk_page_tokens').textContent).toContain(`--bg:${PALETTES.latte.bg};`);
        expect(document.body.classList.contains('sk_ready')).toBe(true);

        const nord = document.querySelector('#themes input[value=nord]');
        nord.checked = true;
        nord.dispatchEvent(new Event('change'));
        expect(sent.find((m) => m.action === 'localData')).toMatchObject({data: {paletteTheme: 'nord'}});
        expect($('sk_page_tokens').textContent).toContain(`--bg:${PALETTES.nord.bg};`);
        expect($('status').textContent).toBe('Theme: Nord');
    });

    test('wears Auto as the side of the pair the system is on, and follows the system', () => {
        const media = {matches: false, listeners: [], addEventListener: (type, fn) => media.listeners.push(fn)};
        window.matchMedia = jest.fn(() => media);
        try {
            const {$} = openPopup({theme: 'auto'});
            expect(window.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
            expect($('sk_page_tokens').textContent).toContain(`--bg:${PALETTES.latte.bg};`);
            expect($('themeName').textContent).toBe('Catppuccin Latte');
            media.matches = true;
            media.listeners.forEach((fn) => fn());
            expect($('sk_page_tokens').textContent).toContain(`--bg:${PALETTES.mocha.bg};`);
        } finally {
            delete window.matchMedia;
        }
    });

    test('follows a pick made elsewhere', () => {
        const {$} = openPopup();
        chrome.storage.onChanged.fire({paletteTheme: {newValue: 'dawn'}}, 'local');
        expect($('themeName').textContent).toBe('Rosé Pine Dawn');
        chrome.storage.onChanged.fire({paletteTheme: {newValue: 'gruvbox'}}, 'sync');
        expect($('themeName').textContent).toBe('Rosé Pine Dawn');
    });

    test('lists the browser shortcuts', () => {
        const {$} = openPopup();
        const rows = [...document.querySelectorAll('#shortcuts dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]);
        expect(rows).toEqual([['Command palette', 'Ctrl+Shift+K'], ['Tab switcher', 'Alt+Q']]);
        expect($('shortcutsSection').hidden).toBe(false);
        expect($('inPageNote').hidden).toBe(true);
        expect($('changeShortcuts').textContent).toBe('Change shortcuts');
    });

    test('marks a shortcut the browser left without a key, and the key that still works', () => {
        const {$} = openPopup({commands: [{name: 'commandPalette', shortcut: ''}, {name: 'tabSwitcher', shortcut: 'Alt+Q'}]});
        expect(document.querySelector('#shortcuts .sk_unassigned').textContent).toBe('Not assigned');
        expect($('inPageNote').hidden).toBe(false);
        expect($('inPageNote').textContent).toContain('Ctrl+Shift+P');
        expect($('changeShortcuts').textContent).toBe('Assign missing shortcuts');
    });

    test('hides the shortcuts where the browser has none of them', () => {
        const {$} = openPopup({commands: null});
        expect($('shortcutsSection').hidden).toBe(true);
    });

    test('opens the browser\'s shortcut settings and closes', () => {
        const {$} = openPopup();
        $('changeShortcuts').click();
        expect(chrome.tabs.create).toHaveBeenCalledWith({url: 'chrome://extensions/shortcuts'});
        expect(window.close).toHaveBeenCalled();
    });

    test('links to the settings sections and files issues with the fork', () => {
        openPopup();
        const hrefs = [...document.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
        expect(hrefs).toEqual(expect.arrayContaining(['options.html', 'options.html#appearance', 'options.html#keys', 'options.html#sites', 'start.html#welcome']));
        expect(document.getElementById('reportIssue').href).toMatch(/^https:\/\/github\.com\/hoangtrung99\/Surfingkeys\/issues\/new\?body=.*1\.2\.3/);
    });
});
