// The Command Palette and the Visual Tab Switcher on a tab Surfingkeys cannot
// run in (chrome:// pages, the New Tab page, the Web Store): they run in
// pages/palette.html instead, shown in the toolbar dropdown or, when Chrome
// cannot show that, in a small window of its own. Pure helpers; the browser
// calls are in tabSwitcher.js.
import { DEFAULT_THEME, NO_THEME, PALETTES, resolveTheme } from '../content_scripts/common/themes.js';

export const HOSTED_PATH = 'pages/palette.html';
const FRONTEND_PATH = 'pages/frontend.html';
const UIS = ['palette', 'switcher'];
const HEX = /^#[0-9a-f]{6}$/i;
// the page's size (palette.html sets the same); Chrome caps a dropdown at 800x600
const SIZE = {palette: [720, 480], switcher: [800, 280]};
const TITLE_BAR = 32;
const BELOW_TOP = 80;  // about where the in-page palette sits

export function hostedUrl({ui, bg, n, surface}) {
    const q = new URLSearchParams({ui: UIS.includes(ui) ? ui : UIS[0]});
    HEX.test(bg || '') && q.set('bg', bg);
    n && q.set('n', n);
    surface === 'window' && q.set('surface', 'window');
    return HOSTED_PATH + '?' + q;
}

// {ui, bg, n, surface} of a palette.html URL, or null for any other URL.
export function parseHostedUrl(url, base) {
    if (typeof url !== 'string' || !url.startsWith(base + HOSTED_PATH)) {
        return null;
    }
    const q = new URLSearchParams(url.slice((base + HOSTED_PATH).length).replace(/^\?/, '').replace(/#.*$/, ''));
    return {
        ui: UIS.includes(q.get('ui')) ? q.get('ui') : UIS[0],
        bg: HEX.test(q.get('bg') || '') ? q.get('bg') : null,
        n: q.get('n'),
        surface: q.get('surface') === 'window' ? 'window' : 'popup',
    };
}

// The frontend frame inside palette.html. In the dropdown it has no tab at all
// (Chrome gives tab info only to tab contents); in the fallback window its tab
// is palette.html. An in-page frontend always has the tab it sits in, and the
// palette.html document itself is not the frontend.
export function isHostedSender(sender, base) {
    return !!sender && sender.url === base + FRONTEND_PATH
        && (!sender.tab || (sender.tab.url || '').startsWith(base + HOSTED_PATH));
}

// The colour of the panel in a theme, for the page's first frame.
export function surfaceOf(themeName) {
    const id = themeName === undefined || themeName === null ? DEFAULT_THEME : (resolveTheme(themeName) || DEFAULT_THEME);
    if (id === NO_THEME) {
        return '#ffffff';
    }
    const P = PALETTES[id];
    return P.surface || (P.light ? '#ffffff' : P.bg);
}

// Outer bounds of the fallback window: centred on the browser window, a little
// below its top edge, and inside it.
export function popupBounds(ui, win) {
    const [w, h] = SIZE[UIS.includes(ui) ? ui : UIS[0]];
    const bounds = {width: w, height: h + TITLE_BAR};
    if (!win || !Number.isFinite(win.left) || !Number.isFinite(win.top) || !win.width || !win.height) {
        return bounds;
    }
    bounds.width = Math.max(Math.min(bounds.width, win.width - 32), Math.min(bounds.width, 360));
    bounds.height = Math.max(Math.min(bounds.height, win.height - BELOW_TOP - 16), Math.min(bounds.height, 240));
    bounds.left = win.left + Math.max(0, Math.round((win.width - bounds.width) / 2));
    bounds.top = win.top + Math.max(0, Math.min(BELOW_TOP, win.height - bounds.height));
    return bounds;
}
