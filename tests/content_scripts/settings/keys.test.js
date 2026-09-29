// The Keys section in jsdom: the grouped list, the key picker with its conflict
// hints, Disable / Reset / Reset all, advanced mode, and the Browser shortcuts card.
import keys, { defaultMappings, describeHint } from '../../../src/content_scripts/options/keys.js';
import { shortcutRows, SHORTCUTS_URL } from '../../../src/content_scripts/options/shortcuts.js';

// metas as normal.mappings holds them once the defaults are in
const METAS = [
    {word: 'd', annotation: 'Scroll half page down', feature_group: 2},
    {word: 'e', annotation: 'Scroll half page up', feature_group: 2},
    {word: 'gg', annotation: 'Scroll to the top of the page', feature_group: 2},
    {word: 'g0', annotation: 'Go to the first tab', feature_group: 3},
    {word: 'g$', annotation: 'Go to the last tab', feature_group: 3},
    {word: 'gU', annotation: 'Go to root of current URL hierarchy', feature_group: 4},
    {word: 'q', annotation: 'Click on an Image or a button', feature_group: 1},
    {word: 'x', annotation: 'Close current tab', feature_group: 3},
    {word: '<Ctrl-P>', annotation: 'Command palette', feature_group: 8},
    {word: ';T', annotation: 'Choose a theme', feature_group: 11},
    {word: 'og', annotation: ['Open Omnibar for {0} Search', 'google'], feature_group: 8},
    {word: 'yj', annotation: '', feature_group: 7},
];

let modes;
function FakeMode(name) {
    this.name = name;
    modes[name] = this;
    this.addEventListener = jest.fn();
    this.enter = jest.fn(() => {
        FakeMode.current = this;
    });
    this.exit = jest.fn(() => {
        FakeMode.current = null;
    });
}
FakeMode.getCurrent = () => FakeMode.current;
FakeMode.specialKeys = {'<Alt-s>': ['<Alt-s>'], '<Esc>': ['<Esc>']};

let commands;
function setup({settings = {}, browser = 'Chrome', commandList} = {}) {
    document.body.innerHTML = '';
    modes = {};
    commands = commandList || [
        {name: '_execute_action', description: '', shortcut: ''},
        {name: 'commandPalette', description: 'Command palette: search open tabs.', shortcut: ''},
        {name: 'tabSwitcher', description: 'Visual tab switcher.', shortcut: 'Alt+Q'},
        {name: 'closeTab', description: 'Close the current tab.', shortcut: ''},
    ];
    global.chrome = {
        commands: {getAll: jest.fn((cb) => cb(commands.map((c) => Object.assign({}, c))))},
        tabs: {create: jest.fn()},
    };
    const stored = {};
    const RUNTIME = jest.fn((action, args) => {
        if (action === 'updateSettings') {
            Object.assign(stored, JSON.parse(JSON.stringify(args.settings)));
            stored.order = Object.keys(args.settings.basicMappings || {});
        }
    });
    const ctx = {
        RUNTIME,
        KeyboardUtils: {encodeKeystroke: (k) => k, decodeKeystroke: (k) => k},
        Mode: FakeMode,
        initL10n: (cb) => cb((s) => s),
        reportIssue: jest.fn(),
        announce: jest.fn(),
        browserName: browser,
    };
    const root = document.createElement('div');
    document.body.append(root);
    const api = keys.create(ctx, root);
    api.onDefaults({normal: {mappings: {getMetas: (crit) => METAS.filter(crit)}}});
    api.onSettings(Object.assign({showAdvanced: false}, settings));
    return {api, ctx, root, stored, RUNTIME};
}

const row = (origin) => document.querySelector(`#basicMappings .sk-keyrow[data-word="${origin}"]`);
const chip = (origin) => document.querySelector(`#basicMappings button[data-origin="${origin}"]`);
const picker = () => document.getElementById('keyPicker');
function press(keyCode, sk_keyName) {
    const handler = modes.KeyPicker.addEventListener.mock.calls.find((c) => c[0] === 'keydown')[1];
    const event = {keyCode, sk_keyName: sk_keyName || ''};
    handler(event);
    return event;
}
function type(text) {
    text.split('').forEach((c) => press(c.charCodeAt(0), c));
}
function clear(n) {
    for (let i = 0; i < n; i++) {
        press(8);
    }
}
function hints() {
    return Array.from(document.querySelectorAll('#keyPickerHints li')).map((li) => li.textContent);
}

describe('the list', () => {
    test('lists every mapping with an annotation, grouped under the usage popup names', () => {
        setup();
        const groups = Array.from(document.querySelectorAll('#basicMappings .sk-keygroup')).map((g) => ({
            name: g.querySelector('h3').textContent,
            keys: Array.from(g.querySelectorAll('button.sk-kbd')).map((b) => b.dataset.origin),
        }));
        expect(groups.map((g) => g.name)).toEqual(['Help', 'Mouse Click', 'Scroll Page / Element', 'Tabs', 'Page Navigation', 'Omnibar', 'Settings']);
        expect(groups.find((g) => g.name === 'Omnibar').keys).toEqual(['<Ctrl-P>', 'og']);
        expect(groups.find((g) => g.name === 'Settings').keys).toEqual([';T']);
        expect(groups.find((g) => g.name === 'Help').keys).toEqual(['<Alt-s>']);
        expect(chip('yj')).toBeNull();
        expect(row('og').textContent).toContain('Open Omnibar for google Search');
        // every group is labelled by its heading
        document.querySelectorAll('.sk-keygroup').forEach((g) => {
            expect(document.getElementById(g.getAttribute('aria-labelledby')).tagName).toBe('H3');
        });
    });

    test('the filter matches action text and keys', () => {
        setup({settings: {basicMappings: {d: 'Z'}}});
        const filter = document.getElementById('keysFilter');
        const shown = () => Array.from(document.querySelectorAll('.sk-keyrow')).filter((r) => !r.classList.contains('sk-keyfiltered')).map((r) => r.dataset.word);
        filter.value = 'scroll';
        filter.dispatchEvent(new Event('input'));
        expect(shown()).toEqual(['d', 'e', 'gg']);
        filter.value = 'Z';
        filter.dispatchEvent(new Event('input'));
        expect(shown()).toEqual(['d']);
        expect(document.getElementById('keysFilterCount').textContent).toBe('1 of 12 actions');
        filter.value = 'g$';
        filter.dispatchEvent(new Event('input'));
        expect(shown()).toEqual(['g$']);
        filter.value = 'zzqq';
        filter.dispatchEvent(new Event('input'));
        expect(shown()).toEqual([]);
        filter.value = '';
        filter.dispatchEvent(new Event('search'));
        expect(shown().length).toBe(12);
        expect(document.getElementById('keysFilterCount').textContent).toBe('');
    });

    test('a changed key says the original still works (D1), and what it breaks', () => {
        setup({settings: {basicMappings: {d: 'q', e: 'g'}}});
        expect(chip('d').textContent).toBe('q');
        expect(chip('d').previousElementSibling.textContent).toBe('d still works');
        expect(row('d').querySelector('.sk-keyhint').textContent).toBe('q stops running “Click on an Image or a button”.');
        expect(row('e').querySelector('.sk-keyhint').textContent).toBe('g$, g0, gU, gg stop working: g runs as soon as it is typed.');
        expect(row('x').querySelector('.sk-keyhint').hidden).toBe(true);
        expect(row('d').querySelector('.sk-keyreset').hidden).toBe(false);
        expect(row('x').querySelector('.sk-keyreset').hidden).toBe(true);
    });

    test('a swap is clean and says nothing about the old keys', () => {
        setup({settings: {basicMappings: {d: 'e', e: 'd'}}});
        expect(chip('d').previousElementSibling.textContent).toBe('');
        expect(row('d').querySelector('.sk-keyhint').hidden).toBe(true);
        expect(row('e').querySelector('.sk-keyhint').hidden).toBe(true);
    });
});

describe('the key picker', () => {
    test('shows what the key would break before it is saved, then stores it', () => {
        const {stored, ctx} = setup();
        chip('e').click();
        expect(picker().hasAttribute('open')).toBe(true);
        expect(document.getElementById('keyPickerTitle').textContent).toBe('New key for “Scroll half page up”');
        expect(document.activeElement.classList.contains('pressedKey')).toBe(true);
        clear(1);
        expect(hints()).toEqual(['No key: the action is turned off.']);
        type('g');
        expect(document.getElementById('inputKey').textContent).toBe('g');
        expect(hints()).toEqual(['g$, g0, gU, gg stop working: g runs as soon as it is typed.', 'e still works too.']);
        expect(stored.basicMappings).toBeUndefined();
        const enter = press(13);
        expect(enter.sk_stopPropagation).toBe(true);
        expect(stored.basicMappings).toEqual({e: 'g'});
        expect(picker().hasAttribute('open')).toBe(false);
        expect(modes.KeyPicker.exit).toHaveBeenCalled();
        expect(ctx.announce).toHaveBeenCalledWith('“Scroll half page up”: key g');
    });

    test('a keyboard-only remap of d to q', () => {
        const {stored} = setup();
        chip('d').focus();
        chip('d').click();
        clear(1);
        type('q');
        expect(hints()).toEqual(['q stops running “Click on an Image or a button”.', 'd still works too.']);
        press(13);
        expect(stored.basicMappings).toEqual({d: 'q'});
        expect(document.activeElement).toBe(chip('d'));
        expect(chip('d').textContent).toBe('q');
    });

    test('Esc and Cancel store nothing', () => {
        const {RUNTIME} = setup();
        chip('d').click();
        type('z');
        press(27);
        expect(picker().hasAttribute('open')).toBe(false);
        chip('d').click();
        type('z');
        document.querySelector('#keyPicker .sk-actions button').click();
        expect(picker().hasAttribute('open')).toBe(false);
        expect(RUNTIME).not.toHaveBeenCalledWith('updateSettings', expect.anything());
        // keys that reach a closed picker change nothing
        press(13);
        expect(RUNTIME).not.toHaveBeenCalledWith('updateSettings', expect.anything());
    });

    test('Save saves for a pointer', () => {
        const {stored} = setup();
        chip('x').click();
        type('Z');
        document.querySelector('#keyPicker .sk-btn-primary').click();
        expect(stored.basicMappings).toEqual({x: 'xZ'});
    });

    test('the default key again removes the entry', () => {
        const {stored} = setup({settings: {basicMappings: {d: 'q', x: 'X'}}});
        chip('d').click();
        clear(1);
        type('d');
        expect(hints()).toEqual(['The default key.']);
        press(13);
        expect(stored.basicMappings).toEqual({x: 'X'});
    });
});

describe('Disable and Reset', () => {
    test('Disable turns the action off, Reset brings its key back', () => {
        const {stored} = setup();
        const off = row('x').querySelector('.sk-keyoff');
        expect(off.getAttribute('aria-label')).toBe('Disable “Close current tab”');
        off.click();
        expect(stored.basicMappings).toEqual({x: ''});
        expect(chip('x').textContent).toBe('Off');
        expect(chip('x').previousElementSibling.textContent).toBe('x is off');
        expect(off.hidden).toBe(true);
        const reset = row('x').querySelector('.sk-keyreset');
        expect(document.activeElement).toBe(reset);
        reset.click();
        expect(stored.basicMappings).toEqual({});
        expect(chip('x').textContent).toBe('x');
        expect(document.activeElement).toBe(chip('x'));
    });

    test('<Alt-s> is no mapping, so it cannot be disabled', () => {
        setup();
        expect(row('<Alt-s>').querySelector('.sk-keyoff').hidden).toBe(true);
    });

    test('keys turned off are stored first, so they cannot undo another change', () => {
        const {stored} = setup({settings: {basicMappings: {d: 'e'}}});
        row('e').querySelector('.sk-keyoff').click();
        expect(stored.order).toEqual(['e', 'd']);
    });

    test('Reset all asks first, then clears every change', () => {
        const {stored, RUNTIME} = setup({settings: {basicMappings: {d: 'q', x: '', gone: 'z'}}});
        const button = document.getElementById('keysResetAll');
        expect(button.disabled).toBe(false);
        button.click();
        const dialog = document.getElementById('keysResetDialog');
        expect(dialog.hasAttribute('open')).toBe(true);
        expect(dialog.textContent).toContain('3 actions go back to their default key');
        expect(RUNTIME).not.toHaveBeenCalled();
        document.getElementById('keysResetAllConfirm').click();
        expect(stored.basicMappings).toEqual({});
        expect(button.disabled).toBe(true);
        expect(chip('d').textContent).toBe('d');
    });

    test('an entry for a key this page does not list is kept', () => {
        const {stored} = setup({settings: {basicMappings: {gone: 'z'}}});
        row('x').querySelector('.sk-keyoff').click();
        expect(stored.basicMappings).toEqual({gone: 'z', x: ''});
    });
});

describe('advanced mode', () => {
    test('the list is read-only, says why, and copies the changes as script lines', async () => {
        const writeText = jest.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
        const {ctx} = setup({settings: {showAdvanced: true, basicMappings: {d: 'q', x: ''}}});
        const note = document.querySelector('.sk-note');
        expect(note.hidden).toBe(false);
        expect(note.textContent).toContain('Advanced mode is on');
        expect(Array.from(document.querySelectorAll('#basicMappings button')).every((b) => b.disabled)).toBe(true);
        expect(document.getElementById('keysResetAll').disabled).toBe(true);
        chip('d').click();
        expect(picker().hasAttribute('open')).toBe(false);
        document.getElementById('keysCopySnippet').click();
        expect(writeText).toHaveBeenCalledWith("api.unmap('x');\napi.map('q', 'd');");
        await Promise.resolve();
        expect(ctx.announce).toHaveBeenCalledWith('Copied');
    });

    test('back in basic mode the keys can be changed again', () => {
        const {api} = setup({settings: {showAdvanced: true}});
        api.onSettings({showAdvanced: false});
        expect(chip('d').disabled).toBe(false);
        expect(document.getElementById('keysCopySnippet').disabled).toBe(true);
    });

    test('a change made in another tab shows here', () => {
        const {api} = setup();
        api.onStorage({basicMappings: {newValue: {d: 'q'}}}, 'local');
        expect(chip('d').textContent).toBe('q');
        api.onStorage({basicMappings: {newValue: {d: 'z'}}}, 'sync');
        expect(chip('d').textContent).toBe('q');
    });
});

describe('Browser shortcuts', () => {
    const shortcutRow = (name) => document.querySelector(`#browserShortcuts li[data-command="${name}"]`);

    test('shows each command and marks the ones without a key', () => {
        setup();
        expect(shortcutRow('commandPalette').querySelector('.sk-chip-warn').textContent).toBe('Not assigned');
        expect(shortcutRow('tabSwitcher').querySelector('kbd').textContent).toBe('Alt+Q');
        expect(document.getElementById('browserShortcutsPaletteNote').hidden).toBe(false);
        // the fork's commands first; the others folded away
        const main = Array.from(document.querySelectorAll('#browserShortcutsList li')).map((li) => li.dataset.command);
        expect(main).toEqual(['commandPalette', 'tabSwitcher']);
        expect(shortcutRow('closeTab').closest('details')).not.toBeNull();
        expect(shortcutRow('_execute_action').textContent).toContain('Open the Surfingkeys popup');
    });

    test('Change in browser opens the browser shortcuts page', () => {
        setup();
        document.getElementById('browserShortcutsChange').click();
        expect(chrome.tabs.create).toHaveBeenCalledWith({url: 'chrome://extensions/shortcuts'});
        expect(SHORTCUTS_URL).toBe('chrome://extensions/shortcuts');
    });

    test('asks again when the page comes back into focus', () => {
        setup();
        commands[1].shortcut = 'Ctrl+Shift+P';
        window.dispatchEvent(new Event('focus'));
        expect(shortcutRow('commandPalette').querySelector('kbd').textContent).toBe('Ctrl+Shift+P');
        expect(document.getElementById('browserShortcutsPaletteNote').hidden).toBe(true);
        commands[2].shortcut = '';
        document.dispatchEvent(new Event('visibilitychange'));
        expect(shortcutRow('tabSwitcher').querySelector('.sk-chip-warn')).not.toBeNull();
    });

    test('Firefox has no page to open, so it says where to go', () => {
        setup({browser: 'Firefox', commandList: [{name: 'nextTab', description: 'Go to the next tab.', shortcut: ''}]});
        expect(document.getElementById('browserShortcutsChange')).toBeNull();
        expect(document.getElementById('browserShortcuts').textContent).toContain('Manage Extension Shortcuts');
        expect(Array.from(document.querySelectorAll('#browserShortcutsList li')).map((li) => li.dataset.command)).toEqual(['nextTab']);
    });

    test('a browser that lists no commands says so', () => {
        setup({commandList: []});
        expect(document.getElementById('browserShortcuts').textContent).toContain('This browser lists no shortcuts for Surfingkeys.');
        expect(document.querySelector('#browserShortcuts details').hidden).toBe(true);
    });

    test('shortcutRows puts the fork first and names the rest', () => {
        expect(shortcutRows([
            {name: 'restartext', description: 'Restart this extenstion.', shortcut: ''},
            {name: 'tabSwitcher', shortcut: 'Alt+Q'},
            {name: 'commandPalette', shortcut: ''},
            {name: 'custom', description: 'Something else', shortcut: 'F2'},
        ]).map((r) => [r.name, r.label, r.main])).toEqual([
            ['commandPalette', 'Command palette', true],
            ['tabSwitcher', 'Visual tab switcher', true],
            ['restartext', 'Restart Surfingkeys', false],
            ['custom', 'Something else', false],
        ]);
        expect(shortcutRows(undefined)).toEqual([]);
    });
});

describe('helpers', () => {
    test('defaultMappings decodes keys, drops the unannotated, adds <Alt-s>', () => {
        const rows = defaultMappings([{word: 'A', annotation: 'x', feature_group: 99}, {word: 'B', annotation: ''}], (w) => w.toLowerCase());
        expect(rows).toEqual([
            {origin: 'a', annotation: 'x', group: 14},
            {origin: '<Alt-s>', annotation: 'Toggle SurfingKeys on current site', group: 0, special: true},
        ]);
    });

    test('describeHint names long lists briefly', () => {
        const words = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
        expect(describeHint({type: 'shadows', words}, 'a', (k) => k)).toBe('a1, a2, a3, a4, a5, a6 and 2 more stop working: a runs as soon as it is typed.');
        expect(describeHint({type: 'unreachable', words: ['d']}, 'dd', (k) => k)).toBe('dd never runs: d runs as soon as it is typed.');
        expect(describeHint({type: 'duplicate', origins: ['x']}, 'Z', () => 'Close current tab')).toBe('Z is already the new key of “Close current tab”: only one of them gets it.');
        expect(describeHint({type: 'special', key: '<Esc>'}, '<Esc>', (k) => k)).toContain('leaves every mode');
    });
});
