// Appearance: the built-in theme, picked from cards that each preview it. The pick
// is sent the way the theme menu (;T) sends it, so every open tab takes it at once;
// a pick made there shows up here the same way (the shell passes it to onTheme).
// The Auto card also holds the pair Auto picks from, a dark theme and a light one.
import { AUTO_THEME, NO_THEME, PAIR_KEY, PALETTES, THEME_IDS, THEME_KEY, pickedTheme, themeEntries, themePair } from '../common/themes.js';
import { themeTokens } from '../common/themeCss.js';
import { h } from './dom.js';

// Surfingkeys' own look, from frontend.css and the upstream hint colours
const NO_THEME_PREVIEW = `--surface: #ffffff; --text: #000000; --muted: #222222; --faint: #767676;`
    + ` --edge: #cccccc; --rule: rgba(0, 0, 0, .1); --sel: #cddef9; --fill: #dddddd;`
    + ` --hint-bg: linear-gradient(#fff785, #ffc542); --hint-fg: #302505;`
    + ` --font: "Helvetica Neue", Helvetica, Arial, sans-serif; --mono: Consolas, "Liberation Mono", Menlo, monospace;`;

// A snippet setting settings.theme draws its own panels over the built-in theme (theme.js).
export function overridesTheme(rs) {
    return !!(rs && rs.showAdvanced && /\bsettings\.theme\s*=/.test(rs.snippets || ''));
}

// Each card's preview declares its theme's tokens on itself, so it is drawn in
// that theme whatever the page is drawn in. The Auto card's two previews name
// their theme on themselves, as it changes with the pair.
function previewCss() {
    return themeEntries().map((e) => {
        const scope = `.sk-theme-card[data-theme="${e.id}"] .sk-preview, .sk-preview[data-theme="${e.id}"]`;
        if (e.id === NO_THEME) {
            return `${scope} { ${NO_THEME_PREVIEW} }`;
        }
        const P = PALETTES[e.id];
        return `${themeTokens(P, scope)}\n${scope} { --hint-bg: ${P.hintBg}; --hint-fg: ${P.hintFg}; }`;
    }).join('\n');
}

function preview(theme) {
    return h('span', {class: 'sk-preview', 'aria-hidden': 'true', dataset: theme ? {theme} : null},
        h('span', {class: 'sk-pv-bar'}, h('span', {class: 'sk-pv-icon'}), 'github'),
        h('span', {class: 'sk-pv-row'}, h('span', {class: 'sk-pv-title'}, 'Surfingkeys'), h('span', {class: 'sk-pv-url'}, 'github.com')),
        h('span', {class: 'sk-pv-row sk-pv-focused'},
            h('span', {class: 'sk-pv-hint'}, 'F'),
            h('span', {class: 'sk-pv-title'}, 'Pull requests'),
            h('kbd', null, '↵')));
}

export default {
    id: 'appearance',
    title: 'Appearance',
    keywords: 'theme colour color dark light look style',
    create(ctx, root) {
        const style = h('style', {id: 'sk_settings_previews'});
        style.textContent = previewCss();
        document.head.append(style);

        const warning = h('p', {class: 'sk-note sk-warn', id: 'themeOverride', hidden: true},
            'Your settings script sets ', h('code', null, 'settings.theme'),
            ', which is drawn over the theme picked here. Remove it from the script (Advanced) to use these themes.');
        const pick = (id, name) => {
            ctx.RUNTIME('localData', {data: {[THEME_KEY]: id}});
            ctx.announce(`Theme: ${name}`);
        };
        const cards = themeEntries().map((e) => {
            const input = h('input', {type: 'radio', name: 'theme', value: e.id, class: 'sk-vh'});
            const kind = e.id === NO_THEME ? 'Follows the system' : (e.light ? 'Light' : 'Dark');
            h('label', {class: 'sk-theme-card sk-row', dataset: {theme: e.id, filter: `${e.name} ${kind} ${e.also}`}},
                input,
                preview(),
                h('span', {class: 'sk-theme-meta'},
                    h('span', {class: 'sk-theme-name'}, e.name),
                    h('span', {class: 'sk-theme-kind'}, kind),
                    h('span', {class: 'sk-theme-inuse'}, 'In use')));
            input.addEventListener('change', () => {
                if (input.checked) {
                    pick(e.id, e.name);
                }
            });
            return {id: e.id, input, card: input.parentElement};
        });

        // Auto: a radio like the others, and the pair it picks from. Changing the
        // pair keeps the pick as it is; it only changes what Auto draws.
        const autoInput = h('input', {type: 'radio', name: 'theme', value: AUTO_THEME, class: 'sk-vh', id: 'themeAuto'});
        const previews = {dark: preview('mocha'), light: preview('latte')};
        const selects = {};
        // a side of the pair: its preview, which picks Auto like the rest of the
        // card, over the select that changes it
        const side = (kind, label) => {
            selects[kind] = h('select', {id: kind === 'dark' ? 'themePairDark' : 'themePairLight', class: 'sk-input'},
                THEME_IDS.filter((id) => PALETTES[id].light === (kind === 'light'))
                    .map((id) => h('option', {value: id}, PALETTES[id].name)));
            selects[kind].addEventListener('change', () => {
                const pair = {dark: selects.dark.value, light: selects.light.value};
                ctx.RUNTIME('localData', {data: {[PAIR_KEY]: pair}});
                ctx.announce(`Auto: ${PALETTES[pair.dark].name} when dark, ${PALETTES[pair.light].name} when light`);
            });
            return h('div', {class: 'sk-auto-side'},
                h('label', {for: autoInput.id}, previews[kind]),
                h('div', {class: 'sk-field'}, h('label', {for: selects[kind].id, class: 'sk-label'}, label), selects[kind]));
        };
        const autoCard = h('div', {class: 'sk-theme-card sk-theme-auto sk-row',
            dataset: {theme: AUTO_THEME, filter: 'Auto Follows the system automatic os dark light pair'}},
            h('label', {class: 'sk-auto-pick', for: autoInput.id},
                autoInput,
                h('span', {class: 'sk-theme-meta'},
                    h('span', {class: 'sk-theme-name'}, 'Auto'),
                    h('span', {class: 'sk-theme-kind'}, 'Follows the system’s dark or light setting'),
                    h('span', {class: 'sk-theme-inuse'}, 'In use'))),
            side('dark', 'Dark theme'),
            side('light', 'Light theme'));
        autoInput.addEventListener('change', () => {
            if (autoInput.checked) {
                pick(AUTO_THEME, 'Auto');
            }
        });
        cards.unshift({id: AUTO_THEME, input: autoInput, card: autoCard});

        root.append(
            h('p', {class: 'sk-lead'}, 'The theme of Surfingkeys’ panels, link hints and this page. Every open tab changes with it.'),
            warning,
            h('fieldset', {class: 'sk-themes'},
                h('legend', {class: 'sk-vh'}, 'Theme'),
                cards.map((c) => c.card)));

        function mark(stored, storedPair) {
            const id = pickedTheme(stored);
            cards.forEach((c) => {
                c.input.checked = c.id === id;
            });
            const pair = themePair(storedPair);
            ['dark', 'light'].forEach((side) => {
                selects[side].value = pair[side];
                previews[side].dataset.theme = pair[side];
            });
        }
        mark(undefined, undefined);

        return {
            onTheme: mark,
            onSettings(rs) {
                warning.hidden = !overridesTheme(rs);
            },
        };
    },
};
