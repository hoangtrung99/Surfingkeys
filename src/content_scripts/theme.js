// Page side of the built-in themes (common/themes.js), set up in every frame
// Surfingkeys runs in: link hints and Visual mode are drawn by each frame, the
// frontend stylesheet only by the top one.
//
// The pick is kept with `localData`, which also sends it to every open tab
// (settingsUpdated), so a pick made in one tab restyles all of them at once.
// Styles from the user's settings win over all of this: settings.theme in
// front.js, Hints.style and Visual.style in hints.js and visual.js.
import { RUNTIME } from './common/runtime.js';
import { showBanner } from './common/utils.js';
import { AUTO_THEME, NO_THEME, PAIR_KEY, PALETTES, THEME_KEY, autoName, pickedTheme, resolveTheme, themeInUse, themePair } from './common/themes.js';
import { pageStyles, themeCss } from './common/themeCss.js';

// empty styles give Surfingkeys' own look back
const NO_PAGE_STYLES = {hints: '', textHints: '', marks: '', cursor: ''};

function themeName(id, pair) {
    if (id === AUTO_THEME) {
        return autoName(pair);
    }
    return id === NO_THEME ? 'Surfingkeys' : PALETTES[id].name;
}

export default function installTheme(api, front, hints, visual) {
    let current = null, shown = null;
    let picked = pickedTheme(undefined), pair = themePair(undefined);
    const systemDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    // Redraws only what changed: the page styles when the theme drawn changes,
    // the frontend also when the pick or the pair does, as its menu marks them.
    function apply() {
        const id = themeInUse(picked, pair, !!(systemDark && systemDark.matches));
        if (id !== current) {
            current = id;
            const page = id === NO_THEME ? NO_PAGE_STYLES : pageStyles(PALETTES[id]);
            hints.style(page.hints, undefined, true);
            hints.style(page.textHints, 'text', true);
            visual.style('marks', page.marks, true);
            visual.style('cursor', page.cursor, true);
        }
        const state = `${id} ${picked} ${pair.dark} ${pair.light}`;
        if (window === top && state !== shown) {
            shown = state;
            front.setBuiltinTheme(id, id === NO_THEME ? '' : themeCss(PALETTES[id]), {picked, pair});
        }
    }

    // Auto follows the system as it changes, with no reload: every frame
    // listens, since each draws its own hints.
    if (systemDark && systemDark.addEventListener) {
        systemDark.addEventListener('change', () => {
            if (picked === AUTO_THEME) {
                apply();
            }
        });
    }

    // Called in the top frame by the theme menu and :theme (ui/themeMenu.js).
    front.pickTheme = function(name) {
        const id = resolveTheme(name);
        if (!id) {
            showBanner(`No such theme: ${name}`);
            return;
        }
        picked = id;
        apply();
        RUNTIME('localData', {data: {[THEME_KEY]: id}});
        const label = `Theme: ${themeName(id, pair)}`;
        showBanner(front.hasUserTheme() ? `${label}, but settings.theme in your settings overrides it` : label);
    };

    api.mapkey(';T', '#11Choose a theme', () => front.openOmnibar({type: 'Themes'}));

    RUNTIME('localData', {data: [THEME_KEY, PAIR_KEY]}, (res) => {
        const data = (res && res.data) || {};
        picked = pickedTheme(data[THEME_KEY]);
        pair = themePair(data[PAIR_KEY]);
        apply();
    });

    return {
        // settings as broadcast to every tab: only a change of theme or pair is ours
        onSettingsUpdated(rs) {
            if (rs && (rs.hasOwnProperty(THEME_KEY) || rs.hasOwnProperty(PAIR_KEY))) {
                if (rs.hasOwnProperty(THEME_KEY)) {
                    picked = pickedTheme(rs[THEME_KEY]);
                }
                if (rs.hasOwnProperty(PAIR_KEY)) {
                    pair = themePair(rs[PAIR_KEY]);
                }
                apply();
            }
        },
    };
}
