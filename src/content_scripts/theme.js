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
import { DEFAULT_THEME, NO_THEME, PALETTES, THEME_KEY, resolveTheme } from './common/themes.js';
import { pageStyles, themeCss } from './common/themeCss.js';

// empty styles give Surfingkeys' own look back
const NO_PAGE_STYLES = {hints: '', textHints: '', marks: '', cursor: ''};

export default function installTheme(api, front, hints, visual) {
    let current = null;

    function apply(id) {
        if (id !== NO_THEME && !PALETTES.hasOwnProperty(id)) {
            id = DEFAULT_THEME;  // nothing picked yet
        }
        if (id === current) {
            return;
        }
        current = id;
        const page = id === NO_THEME ? NO_PAGE_STYLES : pageStyles(PALETTES[id]);
        hints.style(page.hints, undefined, true);
        hints.style(page.textHints, 'text', true);
        visual.style('marks', page.marks, true);
        visual.style('cursor', page.cursor, true);
        if (window === top) {
            front.setBuiltinTheme(id, id === NO_THEME ? '' : themeCss(PALETTES[id]));
        }
    }

    // Called in the top frame by the theme menu and :theme (ui/themeMenu.js).
    front.pickTheme = function(name) {
        const id = resolveTheme(name);
        if (!id) {
            showBanner(`No such theme: ${name}`);
            return;
        }
        apply(id);
        RUNTIME('localData', {data: {[THEME_KEY]: id}});
        const label = `Theme: ${id === NO_THEME ? 'Surfingkeys' : PALETTES[id].name}`;
        showBanner(front.hasUserTheme() ? `${label}, but settings.theme in your settings overrides it` : label);
    };

    api.mapkey(';T', '#11Choose a theme', () => front.openOmnibar({type: 'Themes'}));

    RUNTIME('localData', {data: THEME_KEY}, (res) => {
        apply(res && res.data && res.data[THEME_KEY]);
    });

    return {
        // settings as broadcast to every tab: only a change of theme is ours
        onSettingsUpdated(rs) {
            if (rs && rs.hasOwnProperty(THEME_KEY)) {
                apply(rs[THEME_KEY]);
            }
        },
    };
}
