// The built-in themes: their colours. themeCss.js turns one into styles,
// content_scripts/theme.js applies and switches them, ui/themeMenu.js lists them.

// The pick lives in chrome.storage.local under this key. The settings snippet
// version of these themes stores it under the same key, so a pick made there
// is still the one in use.
export const THEME_KEY = 'paletteTheme';
export const DEFAULT_THEME = 'mocha';
// Surfingkeys' own look (frontend.css), with none of the themes below
export const NO_THEME = 'none';

// Every colour below is checked for 4.5:1 text contrast on the frosted panel
// over both a white and a black page (the page shows through the glass).
export const PALETTES = {
    mocha: {
        name: 'Catppuccin Mocha',
        bg: '#1e1e2e', mantle: '#181825', crust: '#11111b',
        s0: '#313244', s1: '#45475a', s2: '#585b70',
        overlay: '#9399b2', sub: '#bac2de', text: '#cdd6f4',
        accent: '#89b4fa', onAccent: '#11111b',
        yellow: '#f9e2af', green: '#a6e3a1', blue: '#89b4fa',
        mauve: '#cba6f7', peach: '#fab387', red: '#f38ba8',
        hintBg: '#1e1e2e', hintFg: '#89b4fa', textHintBg: '#1e1e2e', textHintFg: '#a6e3a1',
        shadow: 'rgba(0, 0, 0, .5)', dim: 'rgba(8, 8, 14, .32)', glass: 84, light: false,
    },
    tokyonight: {
        name: 'Tokyo Night',
        bg: '#1a1b26', mantle: '#16161e', crust: '#111118',
        s0: '#292e42', s1: '#3b4261', s2: '#414868',
        overlay: '#8f97c4', sub: '#a9b1d6', text: '#c0caf5',
        accent: '#7aa2f7', accentText: '#8db0f9', onAccent: '#16161e',
        yellow: '#e0af68', green: '#9ece6a', blue: '#7dcfff',
        mauve: '#bb9af7', peach: '#ff9e64', red: '#f7768e',
        hintBg: '#1a1b26', hintFg: '#8db0f9', textHintBg: '#1a1b26', textHintFg: '#9ece6a',
        shadow: 'rgba(0, 0, 0, .55)', dim: 'rgba(5, 5, 12, .34)', glass: 84, light: false,
    },
    rosepine: {
        name: 'Rosé Pine',
        bg: '#1f1d2e', mantle: '#191724', crust: '#12101a',
        s0: '#26233a', s1: '#403d52', s2: '#524f67',
        overlay: '#a6a2c0', sub: '#c2bfdb', text: '#e0def4',
        accent: '#c4a7e7', onAccent: '#191724',
        yellow: '#f6c177', green: '#9ccfd8', blue: '#9ccfd8',
        mauve: '#c4a7e7', peach: '#ebbcba', red: '#eb6f92',
        hintBg: '#1f1d2e', hintFg: '#c4a7e7', textHintBg: '#1f1d2e', textHintFg: '#9ccfd8',
        shadow: 'rgba(0, 0, 0, .55)', dim: 'rgba(10, 8, 16, .34)', glass: 84, light: false,
    },
    nord: {
        name: 'Nord',
        bg: '#2e3440', mantle: '#292e39', crust: '#242933',
        s0: '#3b4252', s1: '#434c5e', s2: '#4c566a',
        overlay: '#a3acbd', sub: '#c8d0dc', text: '#eceff4',
        accent: '#88c0d0', accentText: '#a3d3e0', onAccent: '#232831',
        yellow: '#ebcb8b', green: '#a3be8c', blue: '#81a1c1',
        mauve: '#b48ead', peach: '#d08770', red: '#bf616a',
        hintBg: '#2e3440', hintFg: '#a3d3e0', textHintBg: '#2e3440', textHintFg: '#a3be8c',
        shadow: 'rgba(0, 0, 0, .5)', dim: 'rgba(10, 12, 18, .34)', glass: 86, light: false,
    },
    dracula: {
        name: 'Dracula',
        bg: '#282a36', mantle: '#21222c', crust: '#191a21',
        s0: '#343746', s1: '#44475a', s2: '#565a70',
        overlay: '#a4a8c4', sub: '#c5c8dc', text: '#f8f8f2',
        accent: '#bd93f9', accentText: '#d2b5fb', onAccent: '#282a36',
        yellow: '#f1fa8c', green: '#50fa7b', blue: '#8be9fd',
        mauve: '#ff79c6', peach: '#ffb86c', red: '#ff5555',
        hintBg: '#282a36', hintFg: '#d2b5fb', textHintBg: '#282a36', textHintFg: '#50fa7b',
        shadow: 'rgba(0, 0, 0, .55)', dim: 'rgba(10, 10, 16, .34)', glass: 86, light: false,
    },
    gruvbox: {
        name: 'Gruvbox',
        bg: '#282828', mantle: '#1d2021', crust: '#151515',
        s0: '#3c3836', s1: '#504945', s2: '#665c54',
        overlay: '#b0a38e', sub: '#d5c4a1', text: '#ebdbb2',
        accent: '#fabd2f', onAccent: '#282828',
        yellow: '#fabd2f', green: '#b8bb26', blue: '#83a598',
        mauve: '#d3869b', peach: '#fe8019', red: '#fb4934',
        hintBg: '#282828', hintFg: '#fabd2f', textHintBg: '#282828', textHintFg: '#b8bb26',
        shadow: 'rgba(0, 0, 0, .55)', dim: 'rgba(12, 10, 8, .34)', glass: 86, light: false,
    },
    everforest: {
        name: 'Everforest',
        bg: '#2d353b', mantle: '#272e33', crust: '#232a2e',
        s0: '#343f44', s1: '#3d484d', s2: '#475258',
        overlay: '#a6b0a6', sub: '#d0cab2', text: '#e2d9c0',
        accent: '#a7c080', accentText: '#b5cc8a', onAccent: '#2d353b',
        yellow: '#dbbc7f', green: '#a7c080', blue: '#7fbbb3',
        mauve: '#d699b6', peach: '#e69875', red: '#e67e80',
        hintBg: '#2d353b', hintFg: '#b5cc8a', textHintBg: '#2d353b', textHintFg: '#e69875',
        shadow: 'rgba(0, 0, 0, .5)', dim: 'rgba(10, 14, 12, .34)', glass: 86, hud: 56, light: false,
    },
    latte: {
        name: 'Catppuccin Latte',
        bg: '#eff1f5', mantle: '#e6e9ef', crust: '#dce0e8',
        s0: '#dce0e8', s1: '#ccd0da', s2: '#bcc0cc',
        overlay: '#5c5f77', sub: '#4c4f69', text: '#303446',
        accent: '#1e66f5', accentText: '#1a4fc4', onAccent: '#ffffff',
        yellow: '#df8e1d', green: '#40a02b', blue: '#1e66f5',
        mauve: '#8839ef', peach: '#fe640b', red: '#d20f39',
        hintBg: '#1e66f5', hintFg: '#ffffff', textHintBg: '#8839ef', textHintFg: '#ffffff',
        shadow: 'rgba(76, 79, 105, .3)', dim: 'rgba(40, 42, 60, .24)', glass: 92, light: true,
    },
    github: {
        name: 'GitHub Light',
        bg: '#f6f8fa', surface: '#ffffff', mantle: '#f6f8fa', crust: '#eaeef2',
        s0: '#eaeef2', s1: '#d0d7de', s2: '#afb8c1',
        overlay: '#57606a', sub: '#424a53', text: '#1f2328',
        accent: '#0969da', accentText: '#0550ae', onAccent: '#ffffff',
        yellow: '#9a6700', green: '#1a7f37', blue: '#0969da',
        mauve: '#8250df', peach: '#bc4c00', red: '#cf222e',
        hintBg: '#0969da', hintFg: '#ffffff', textHintBg: '#8250df', textHintFg: '#ffffff',
        shadow: 'rgba(31, 35, 40, .25)', dim: 'rgba(30, 35, 45, .24)', glass: 92, light: true,
    },
    dawn: {
        name: 'Rosé Pine Dawn',
        bg: '#faf4ed', surface: '#fffaf3', mantle: '#f4ede8', crust: '#f2e9e1',
        s0: '#f2e9e1', s1: '#dfdad9', s2: '#cecacd',
        overlay: '#6e6a86', sub: '#5a5579', text: '#3e3a5c',
        accent: '#7f6a9f', accentText: '#6a5485', onAccent: '#ffffff',
        yellow: '#ea9d34', green: '#56949f', blue: '#286983',
        mauve: '#a3566d', peach: '#d7827e', red: '#b4637a',
        hintBg: '#7f6a9f', hintFg: '#ffffff', textHintBg: '#a3566d', textHintFg: '#ffffff',
        shadow: 'rgba(87, 82, 121, .25)', dim: 'rgba(40, 34, 50, .22)', glass: 92, hud: 66, light: true, sel: 24,
    },
};

// Menu order: the dark themes, then the light ones.
export const THEME_IDS = Object.keys(PALETTES);

// "Rosé Pine Dawn", "rose pine dawn" and "rosepinedawn" all name one theme.
function squash(name) {
    return String(name).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const NAMES = new Map([['none', NO_THEME], ['off', NO_THEME], ['original', NO_THEME], ['surfingkeys', NO_THEME]]);
THEME_IDS.forEach((id) => {
    NAMES.set(id, id);
    NAMES.set(squash(PALETTES[id].name), id);
});

// The theme an id or a name refers to, or null.
export function resolveTheme(name) {
    return NAMES.get(squash(name || '')) || null;
}

// One entry per choice, in menu order, as the theme menu and the settings page
// list them: id, name, the swatch (bg and three dots), whether it is light, and
// the extra words a search matches. Both lists come from here so they cannot drift.
export function themeEntries() {
    return THEME_IDS.map((id) => {
        const P = PALETTES[id];
        return {id, name: P.name, bg: P.surface || P.bg, dots: [P.text, P.accent, P.mauve], light: P.light, also: `${id} ${P.light ? 'light' : 'dark'}`};
    }).concat({
        // frontend.css: white panel, black text, red matches
        id: NO_THEME, name: 'Surfingkeys', bg: '#ffffff', dots: ['#000000', '#b90c0c', '#4b3acc'], light: true, also: 'original none off light',
    });
}
