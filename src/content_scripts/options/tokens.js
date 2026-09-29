// The settings page is drawn in the built-in theme picked for Surfingkeys, so the
// page is its own preview of the pick. Surfingkeys' own look (none) has no colours
// of its own for a whole page, so it follows the system: GitHub Light, or Mocha
// when the system is dark.
import { DEFAULT_THEME, NO_THEME, PALETTES } from '../common/themes.js';
import { themeTokens } from '../common/themeCss.js';

export const NONE_LIGHT = 'github';
export const NONE_DARK = 'mocha';

// The id the page is drawn in for a stored pick; nothing picked yet means the
// default theme, as in theme.js.
export function pageTheme(stored) {
    if (stored === NO_THEME || PALETTES.hasOwnProperty(stored)) {
        return stored;
    }
    return DEFAULT_THEME;
}

// 'light' or 'dark', for what the tokens cannot say by themselves (Ace's syntax colours).
export function pageScheme(id, systemDark) {
    if (id === NO_THEME) {
        return systemDark ? 'dark' : 'light';
    }
    return PALETTES[pageTheme(id)].light ? 'light' : 'dark';
}

// The stylesheet that colours the page: the theme's tokens on :root, and the
// scheme for the browser's own controls (scrollbars, select popups, checkboxes).
export function pageThemeCss(stored) {
    const id = pageTheme(stored);
    if (id === NO_THEME) {
        return `${themeTokens(PALETTES[NONE_LIGHT])}\n:root { color-scheme: light dark; }\n`
            + `@media (prefers-color-scheme: dark) {\n${themeTokens(PALETTES[NONE_DARK])}\n}\n`;
    }
    return `${themeTokens(PALETTES[id])}\n:root { color-scheme: ${PALETTES[id].light ? 'light' : 'dark'}; }\n`;
}
