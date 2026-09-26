// The pure parts of the settings page (src/content_scripts/options/).
import { LAST_SECTION_KEY, landingSection, rememberSection, rememberedSection, sectionFromHash } from '../../../src/content_scripts/options/router.js';
import { NONE_DARK, NONE_LIGHT, pageScheme, pageTheme, pageThemeCss } from '../../../src/content_scripts/options/tokens.js';
import { ALIAS_TRIES, aliasName, removeSearchAliasLines } from '../../../src/content_scripts/options/search.js';
import { normalizeProxyServer } from '../../../src/content_scripts/options/proxy.js';
import { getURIPath } from '../../../src/content_scripts/options/advanced.js';
import { overridesTheme } from '../../../src/content_scripts/options/appearance.js';
import { RESET_CLEARS } from '../../../src/content_scripts/options/about.js';
import { fold, h } from '../../../src/content_scripts/options/dom.js';
import { DEFAULT_THEME, NO_THEME, PALETTES, THEME_IDS } from '../../../src/content_scripts/common/themes.js';
import { themeTokens } from '../../../src/content_scripts/common/themeCss.js';

const fs = require('fs');
const path = require('path');

// runtime.js talks to the extension as it loads
jest.mock('../../../src/content_scripts/common/runtime.js', () => ({
    RUNTIME: jest.fn(),
    dispatchSKEvent: jest.fn(),
    runtime: { conf: {} },
}));

const IDS = ['appearance', 'keys', 'search', 'sites', 'advanced', 'proxy', 'backup', 'about'];

function memoryStorage(seed = {}) {
    const data = Object.assign({}, seed);
    return {
        data,
        getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
        setItem: (k, v) => {
            data[k] = String(v);
        },
    };
}
const throwing = {
    getItem() {
        throw new Error('SecurityError');
    },
    setItem() {
        throw new Error('QuotaExceededError');
    },
};

describe('router', () => {
    test.each([
        ['#keys', 'keys'],
        ['keys', 'keys'],
        ['#search', 'search'],
        ['#%61bout', 'about'],
        ['', null],
        ['#', null],
        ['#nope', null],
        ['#keys/d', null],
        ['#%E0%A4%A', null],
        [undefined, null],
    ])('sectionFromHash(%p) is %p', (hash, id) => {
        expect(sectionFromHash(hash, IDS)).toBe(id);
    });

    test('the URL wins over the remembered section, which wins over the first', () => {
        const storage = memoryStorage({[LAST_SECTION_KEY]: 'proxy'});
        expect(landingSection('#keys', storage, IDS)).toBe('keys');
        expect(landingSection('', storage, IDS)).toBe('proxy');
        expect(landingSection('#nope', memoryStorage(), IDS)).toBe('appearance');
    });

    test('a remembered section that no longer exists is ignored', () => {
        expect(rememberedSection(memoryStorage({[LAST_SECTION_KEY]: 'gone'}), IDS)).toBe(null);
    });

    test('storage that throws or is missing means nothing remembered', () => {
        expect(landingSection('', throwing, IDS)).toBe('appearance');
        expect(landingSection('', null, IDS)).toBe('appearance');
        expect(() => rememberSection(throwing, 'keys')).not.toThrow();
        expect(() => rememberSection(null, 'keys')).not.toThrow();
    });

    test('remembers the section', () => {
        const storage = memoryStorage();
        rememberSection(storage, 'search');
        expect(storage.data[LAST_SECTION_KEY]).toBe('search');
    });
});

describe('page tokens', () => {
    test('nothing picked, or an unknown pick, draws the default theme', () => {
        expect(pageTheme(undefined)).toBe(DEFAULT_THEME);
        expect(pageTheme('nope')).toBe(DEFAULT_THEME);
        expect(pageTheme('constructor')).toBe(DEFAULT_THEME);
        expect(pageThemeCss(undefined)).toBe(pageThemeCss(DEFAULT_THEME));
    });

    test.each(THEME_IDS)('%s: the page gets its tokens and colour scheme', (id) => {
        const css = pageThemeCss(id);
        expect(css.startsWith(themeTokens(PALETTES[id]))).toBe(true);
        expect(css).toContain(`:root { color-scheme: ${PALETTES[id].light ? 'light' : 'dark'}; }`);
        expect(css).not.toContain('@media');
        expect(pageScheme(id, true)).toBe(PALETTES[id].light ? 'light' : 'dark');
    });

    test("Surfingkeys' own look follows the system with GitHub Light and Mocha", () => {
        expect([NONE_LIGHT, NONE_DARK]).toEqual(['github', 'mocha']);
        const css = pageThemeCss(NO_THEME);
        expect(css.startsWith(themeTokens(PALETTES.github))).toBe(true);
        expect(css).toContain(`@media (prefers-color-scheme: dark) {\n${themeTokens(PALETTES.mocha)}\n}`);
        expect(css).toContain('color-scheme: light dark;');
        expect(pageScheme(NO_THEME, true)).toBe('dark');
        expect(pageScheme(NO_THEME, false)).toBe('light');
    });

    // settings.css paints the first frame before the tokens are set; it must be
    // the same colours the tokens then give, or the page flashes
    test('settings.css first-paint colours are GitHub Light and Mocha', () => {
        const css = fs.readFileSync(path.join(__dirname, '../../../src/pages/settings.css'), 'utf8');
        const light = css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)'));
        const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'), css.indexOf('*, *::before'));
        const expectTokens = (block, P) => {
            expect(block).toContain(`--mantle: ${P.mantle};`);
            expect(block).toContain(`--surface: ${P.surface || (P.light ? '#ffffff' : P.bg)};`);
            expect(block).toContain(`--text: ${P.text};`);
            expect(block).toContain(`--sub: ${P.sub};`);
            expect(block).toContain(`--accent: ${P.accent};`);
            expect(block).toContain(`--accent-text: ${P.accentText || P.accent};`);
            expect(block).toContain(`--on-accent: ${P.onAccent};`);
        };
        expectTokens(light, PALETTES.github);
        expectTokens(dark, PALETTES.mocha);
    });
});

describe('search engines', () => {
    test.each([
        ["google<span class='separator'>➤</span>", 'google'],
        ['duckduckgo', 'duckduckgo'],
        ['<img src="data:image/png;base64,AAAA" alt="bing" style="width: 20px;" />', 'bing'],
        ['<img src="x" onerror="alert(1)" alt="wiki">', 'wiki'],
        ['', ''],
        [undefined, ''],
    ])('aliasName(%p) is %p', (prompt, name) => {
        expect(aliasName(prompt)).toBe(name);
    });

    test('parsing a prompt runs and loads nothing', () => {
        window.__skProbe = false;
        aliasName('<img src="x" onerror="window.__skProbe = true" alt="a"><script>window.__skProbe = true</script>');
        expect(window.__skProbe).toBe(false);
    });

    test('copies turned-off engines as snippet lines', () => {
        expect(removeSearchAliasLines({w: 'bing', b: 'baidu'})).toBe("api.removeSearchAlias('b');\napi.removeSearchAlias('w');");
        expect(removeSearchAliasLines({"'": 'x'})).toBe("api.removeSearchAlias('\\'');");
        expect(removeSearchAliasLines(undefined)).toBe('');
    });

    test('gives up on an empty alias list after a bounded number of tries', () => {
        expect(ALIAS_TRIES).toBe(10);
    });
});

describe('proxy', () => {
    test.each([
        ['127.0.0.1:1080', '127.0.0.1:1080'],
        [' proxy.example.com:3128 ', 'proxy.example.com:3128'],
        ['localhost 8080', 'localhost:8080'],
        ['[::1]:1080', '[::1]:1080'],
        ['host', null],
        ['host:', null],
        ['host:123456', null],
        ['http://host:80', null],
        ['', null],
        [undefined, null],
    ])('normalizeProxyServer(%p) is %p', (text, want) => {
        expect(normalizeProxyServer(text)).toBe(want);
    });
});

describe('advanced', () => {
    test.each([
        ['<native>', '<native>'],
        ['https://example.com/sk.js', 'https://example.com/sk.js'],
        ['/home/me/.surfingkeys.js', 'file:///home/me/.surfingkeys.js'],
        ['C:\\Users\\me\\sk.js', 'file:///C:/Users/me/sk.js'],
        ['file:///tmp/sk.js', 'file:///tmp/sk.js'],
        ['', ''],
    ])('getURIPath(%p) is %p', (input, want) => {
        expect(getURIPath(input)).toBe(want);
    });
});

describe('appearance', () => {
    test('warns only when an active snippet sets settings.theme', () => {
        expect(overridesTheme({showAdvanced: true, snippets: 'settings.theme = `x`;'})).toBe(true);
        expect(overridesTheme({showAdvanced: true, snippets: 'settings.theme=`x`'})).toBe(true);
        expect(overridesTheme({showAdvanced: false, snippets: 'settings.theme = `x`;'})).toBe(false);
        expect(overridesTheme({showAdvanced: true, snippets: 'settings.themeFoo = 1; mysettings.theme = 2'})).toBe(false);
        expect(overridesTheme({showAdvanced: true})).toBe(false);
        expect(overridesTheme(null)).toBe(false);
    });
});

describe('reset', () => {
    test('names the theme it goes back to', () => {
        expect(RESET_CLEARS.join('\n')).toContain(PALETTES[DEFAULT_THEME].name);
        expect(RESET_CLEARS.join('\n')).toMatch(/marks/i);
    });
});

describe('dom', () => {
    test('children are text, never markup', () => {
        const el = h('p', {class: 'a', 'data-x': '1', hidden: false, title: null}, '<b>x</b>', h('i', null, 'y'), null, ['z', 1]);
        expect(el.outerHTML).toBe('<p class="a" data-x="1">&lt;b&gt;x&lt;/b&gt;<i>y</i>z1</p>');
    });

    test('on… keys are listeners, not attributes', () => {
        const click = jest.fn();
        const b = h('button', {onclick: click, disabled: true});
        expect(b.hasAttribute('onclick')).toBe(false);
        expect(b.getAttribute('disabled')).toBe('');
        b.dispatchEvent(new Event('click'));
        expect(click).toHaveBeenCalled();
    });

    test('folds case and accents', () => {
        expect(fold('Rosé Pine')).toBe('rose pine');
    });
});
