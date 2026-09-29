import installTheme from '../../src/content_scripts/theme.js';
import createThemeMenu from '../../src/content_scripts/ui/themeMenu.js';
import { DEFAULT_THEME, NO_THEME, PALETTES, THEME_IDS, THEME_KEY, resolveTheme, themeEntries } from '../../src/content_scripts/common/themes.js';
import { aceCss, pageStyles, themeCss, themeTokens } from '../../src/content_scripts/common/themeCss.js';
const { createHash } = require('crypto');

const mockRUNTIME = jest.fn();
const mockShowBanner = jest.fn();

jest.mock('../../src/content_scripts/common/runtime.js', () => ({
    RUNTIME: (...args) => mockRUNTIME(...args),
    runtime: { conf: {} },
}));

jest.mock('../../src/content_scripts/common/utils.js', () => ({
    showBanner: (...args) => mockShowBanner(...args),
    createElementWithContent: (tag, content) => {
        const el = globalThis.document.createElement(tag);
        el.innerHTML = content;
        return el;
    },
    htmlEncode: (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    setSanitizedContent: (el, str) => { el.innerHTML = str; },
}));

// what themeCss and pageStyles read from a palette
const FIELDS = ['name', 'bg', 'mantle', 'crust', 's0', 's1', 's2', 'overlay', 'sub', 'text', 'accent', 'onAccent',
    'yellow', 'green', 'blue', 'mauve', 'peach', 'red', 'hintBg', 'hintFg', 'textHintBg', 'textHintFg',
    'shadow', 'dim', 'glass', 'light'];

describe('themes', () => {
    test.each(THEME_IDS)('%s defines every colour the styles use', (id) => {
        FIELDS.forEach((f) => expect(PALETTES[id]).toHaveProperty(f));
    });

    test('lists the dark themes before the light ones', () => {
        const light = THEME_IDS.map((id) => PALETTES[id].light);
        expect(light).toEqual([...light].sort());
        expect(THEME_IDS[0]).toBe(DEFAULT_THEME);
    });

    test.each([
        ['nord', 'nord'],
        ['Rosé Pine Dawn', 'dawn'],
        ['rose pine', 'rosepine'],
        ['GitHub Light', 'github'],
        ['catppuccin-latte', 'latte'],
        ['OFF', NO_THEME],
        ['original', NO_THEME],
        ['constructor', null],
        ['', null],
        [undefined, null],
    ])('resolveTheme(%p) is %p', (name, id) => {
        expect(resolveTheme(name)).toBe(id);
    });
});

describe('themeCss', () => {
    test.each(THEME_IDS)('%s never holds the character DOMPurify rewrites a sheet for', (id) => {
        const css = themeCss(PALETTES[id]);
        expect(css).not.toContain('<');
        expect(css).toContain(`--bg: ${PALETTES[id].bg};`);
    });

    test.each(THEME_IDS)('%s styles hints in its own colours', (id) => {
        const P = PALETTES[id];
        const page = pageStyles(P);
        expect(page.hints).toMatch(/^div \{/);
        expect(page.hints).toContain(`color: ${P.hintFg}; background: ${P.hintBg};`);
        expect(page.textHints).toContain(`color: ${P.textHintFg}; background: ${P.textHintBg};`);
        expect(page.cursor).toContain(P.accent);
    });
});

describe('themeTokens and aceCss', () => {
    // sha256 of themeCss(PALETTES[id]) before the token block and the Ace rules
    // became functions of their own: the frontend stylesheet must not change by a byte.
    const BEFORE = {
        mocha: 'd5d6c1d27177f76b6985d51c852d5c9ec2b9d2f568b6349171dfa2e9dd4ada45',
        tokyonight: '604961550022af6d3ef81048b3cfe75856b3f647637ebab27d1110a5d4b897b2',
        rosepine: 'ab7d349e2b1b40745b70210136f5688c5d6273badedc5aece6dfb9524d70305f',
        nord: 'a9c8b9f8015668e045be5f4d9921655376d405e027fe142b4708d25d23d6e476',
        dracula: '93dfdd59bcf734939ff0c05c3030c79fc7b5178c5e1fce0ab7d559781b3728f9',
        gruvbox: '8ea66919eb0f4ec3289e52e7ae97d07c14a9b705ea70b3c8c4687de9db016d52',
        everforest: 'c78fdb1c00c50b4b1a80020cfb96e05a691f931beb9d219b71dc951d64a6b710',
        latte: '82b273294cadee4c514afe8c38b634b5d181f094b775679234038637a9c28669',
        github: '1df176944d977263a8429f3d31d442320d8ca84bf6716e96433da77ab4d2ddab',
        dawn: '33bf5b47664fef4a01cbc2c62761a09a999478d1f0fc74d0f20011a55ac4a8d2',
    };

    test('every theme has a recorded stylesheet', () => {
        expect(Object.keys(BEFORE)).toEqual(THEME_IDS);
    });

    test.each(THEME_IDS)('%s: themeCss is byte-identical to before', (id) => {
        expect(createHash('sha256').update(themeCss(PALETTES[id])).digest('hex')).toBe(BEFORE[id]);
    });

    test.each(THEME_IDS)('%s: themeCss holds the token block and the editor rules verbatim', (id) => {
        const css = themeCss(PALETTES[id]);
        expect(css.startsWith(`\n${themeTokens(PALETTES[id])}\nbody {`)).toBe(true);
        expect(css).toContain(`\n\n${aceCss('#sk_editor')}\n\n`);
    });

    test('declares the tokens on another selector when asked', () => {
        const P = PALETTES.nord;
        const scoped = themeTokens(P, '.card[data-theme="nord"]');
        expect(scoped.startsWith('.card[data-theme="nord"] {\n  --bg: #2e3440;')).toBe(true);
        expect(scoped.slice(scoped.indexOf('{'))).toBe(themeTokens(P).slice(themeTokens(P).indexOf('{')));
        expect(scoped).not.toContain('<');
    });

    test('re-tints an editor at any selector, the popup rules staying global', () => {
        const css = aceCss('#mappings');
        expect(css).not.toContain('#sk_editor');
        expect(css).toContain('#mappings .ace_gutter { background: var(--mantle);');
        expect(css).toContain('#mappings.normal-mode .ace_cursor');
        expect(css).toContain('.ace_editor.ace_autocomplete { background: var(--bg);');
        expect(css).not.toContain('<');
    });
});

describe('themeEntries', () => {
    test('lists every theme in menu order, then Surfingkeys itself', () => {
        const entries = themeEntries();
        expect(entries.map((e) => e.id)).toEqual([...THEME_IDS, NO_THEME]);
        expect(entries.map((e) => e.name)).toEqual([...THEME_IDS.map((id) => PALETTES[id].name), 'Surfingkeys']);
    });

    test('carries the swatch the theme menu has always drawn', () => {
        const nord = themeEntries().find((e) => e.id === 'nord');
        expect(nord).toEqual({id: 'nord', name: 'Nord', bg: '#2e3440', dots: ['#eceff4', '#88c0d0', '#b48ead'],
            light: false, also: 'nord dark'});
        const github = themeEntries().find((e) => e.id === 'github');
        expect(github.bg).toBe('#ffffff');
        expect(github.light).toBe(true);
        const none = themeEntries().find((e) => e.id === NO_THEME);
        expect(none).toEqual({id: NO_THEME, name: 'Surfingkeys', bg: '#ffffff', dots: ['#000000', '#b90c0c', '#4b3acc'],
            light: true, also: 'original none off light'});
    });

    test('hands out a fresh list each time', () => {
        themeEntries()[0].name = 'changed';
        expect(themeEntries()[0].name).toBe(PALETTES[THEME_IDS[0]].name);
    });
});

describe('installTheme', () => {
    let api, front, hints, visual, saved;

    function install() {
        return installTheme(api, front, hints, visual);
    }

    beforeEach(() => {
        saved = {};
        mockRUNTIME.mockReset();
        mockRUNTIME.mockImplementation((action, args, callback) => {
            if (action === 'localData' && typeof args.data === 'string') {
                callback({data: {[args.data]: saved[args.data]}});
            }
        });
        mockShowBanner.mockReset();
        api = {mapkey: jest.fn()};
        front = {setBuiltinTheme: jest.fn(), hasUserTheme: () => false, openOmnibar: jest.fn()};
        hints = {style: jest.fn()};
        visual = {style: jest.fn()};
    });

    test('applies the saved theme to the page and the frontend', () => {
        saved[THEME_KEY] = 'nord';
        install();
        const page = pageStyles(PALETTES.nord);
        expect(hints.style.mock.calls).toEqual([[page.hints, undefined, true], [page.textHints, 'text', true]]);
        expect(visual.style.mock.calls).toEqual([['marks', page.marks, true], ['cursor', page.cursor, true]]);
        expect(front.setBuiltinTheme).toHaveBeenCalledWith('nord', themeCss(PALETTES.nord));
    });

    test('uses the default theme until one is picked', () => {
        install();
        expect(front.setBuiltinTheme).toHaveBeenCalledWith(DEFAULT_THEME, themeCss(PALETTES[DEFAULT_THEME]));
    });

    test('gives Surfingkeys its own look back', () => {
        saved[THEME_KEY] = NO_THEME;
        install();
        expect(hints.style.mock.calls).toEqual([['', undefined, true], ['', 'text', true]]);
        expect(front.setBuiltinTheme).toHaveBeenCalledWith(NO_THEME, '');
    });

    test('a pick is applied, kept and announced', () => {
        install();
        front.setBuiltinTheme.mockClear();
        front.pickTheme('Rosé Pine Dawn');
        expect(front.setBuiltinTheme).toHaveBeenCalledWith('dawn', themeCss(PALETTES.dawn));
        expect(mockRUNTIME).toHaveBeenCalledWith('localData', {data: {[THEME_KEY]: 'dawn'}});
        expect(mockShowBanner).toHaveBeenCalledWith('Theme: Rosé Pine Dawn');
    });

    test('an unknown name changes nothing', () => {
        install();
        front.setBuiltinTheme.mockClear();
        mockRUNTIME.mockClear();
        front.pickTheme('solarized');
        expect(front.setBuiltinTheme).not.toHaveBeenCalled();
        expect(mockRUNTIME).not.toHaveBeenCalled();
        expect(mockShowBanner).toHaveBeenCalledWith('No such theme: solarized');
    });

    test('says so when settings.theme keeps the panels', () => {
        front.hasUserTheme = () => true;
        install();
        front.pickTheme('nord');
        expect(mockShowBanner).toHaveBeenCalledWith('Theme: Nord, but settings.theme in your settings overrides it');
    });

    test('follows a pick made in another tab, and only a change of theme', () => {
        const theme = install();
        front.setBuiltinTheme.mockClear();
        theme.onSettingsUpdated({lastKeys: 'j'});
        theme.onSettingsUpdated({[THEME_KEY]: DEFAULT_THEME});
        expect(front.setBuiltinTheme).not.toHaveBeenCalled();
        theme.onSettingsUpdated({[THEME_KEY]: 'latte'});
        expect(front.setBuiltinTheme).toHaveBeenCalledWith('latte', themeCss(PALETTES.latte));
    });

    test(';T opens the theme menu', () => {
        install();
        const [keys, annotation, fn] = api.mapkey.mock.calls[0];
        expect([keys, annotation]).toEqual([';T', '#11Choose a theme']);
        fn();
        expect(front.openOmnibar).toHaveBeenCalledWith({type: 'Themes'});
    });
});

describe('theme menu', () => {
    let omnibar, front, menu, commands;

    const rows = () => Array.from(omnibar.resultsDiv.querySelectorAll('li'));
    const names = () => rows().map((li) => li.querySelector('.sk_theme_name').textContent);
    const type = (text) => {
        omnibar.input.value = text;
        menu.onInput();
    };

    beforeEach(() => {
        document.body.innerHTML = '<style id="sk_theme"></style>';
        commands = {};
        omnibar = {
            input: document.createElement('input'),
            resultsDiv: document.createElement('div'),
            listResults(items, render) {
                this.resultsDiv.innerHTML = '';
                const ul = document.createElement('ul');
                items.forEach((item) => ul.append(render(item)));
                this.resultsDiv.append(ul);
                ul.firstChild && ul.firstChild.classList.add('focused');
            },
            focusItem: (li) => li.classList.add('focused'),
            command: (name, annotation, fn) => { commands[name] = fn; },
        };
        front = {_actions: {openOmnibar: jest.fn()}, contentCommand: jest.fn(), hidePopup: jest.fn()};
        menu = createThemeMenu(omnibar, front);
    });

    test('lists every theme, then Surfingkeys itself', () => {
        menu.onOpen();
        expect(names()).toEqual(THEME_IDS.map((id) => PALETTES[id].name).concat('Surfingkeys'));
    });

    test('marks the theme in use and starts from it', () => {
        front._actions.applyBuiltinTheme({theme: 'nord', css: ':root { --bg: #2e3440; }'});
        expect(document.getElementById('sk_theme').textContent).toBe(':root { --bg: #2e3440; }');
        menu.onOpen();
        const focused = rows().filter((li) => li.classList.contains('focused'));
        expect(focused.map((li) => li.themeId)).toEqual(['nord']);
        expect(focused[0].querySelector('.sk_theme_current').textContent).toBe('In use');
    });

    test('filters by name, accents aside, and by light or dark', () => {
        menu.onOpen();
        type('rose');
        expect(names()).toEqual(['Rosé Pine', 'Rosé Pine Dawn']);
        type('light');
        expect(names()).toEqual(['Catppuccin Latte', 'GitHub Light', 'Rosé Pine Dawn', 'Surfingkeys']);
    });

    test('Enter and a click pick the row', () => {
        menu.onOpen();
        type('gruv');
        expect(menu.onEnter()).toBe(true);
        expect(mockRUNTIME).toHaveBeenLastCalledWith('frontendRequest', {request: 'pickTheme', name: 'gruvbox'});
        type('dracula');
        rows()[0].onclick();
        expect(mockRUNTIME).toHaveBeenLastCalledWith('frontendRequest', {request: 'pickTheme', name: 'dracula'});
        expect(front.hidePopup).toHaveBeenCalled();
        // a pick is stored: never over postMessage, which the page can post to as well
        expect(front.contentCommand).not.toHaveBeenCalled();
    });

    test(':theme picks by name, or opens the menu', () => {
        commands.theme(['rose', 'pine']);
        expect(mockRUNTIME).toHaveBeenLastCalledWith('frontendRequest', {request: 'pickTheme', name: 'rose pine'});
        commands.theme([]);
        expect(front._actions.openOmnibar).toHaveBeenCalledWith({type: 'Themes'});
    });
});
