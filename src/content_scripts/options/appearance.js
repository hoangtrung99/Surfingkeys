// Appearance: the built-in theme, picked from cards that each preview it. The pick
// is sent the way the theme menu (;T) sends it, so every open tab takes it at once;
// a pick made there shows up here the same way (the shell passes it to onTheme).
import { DEFAULT_THEME, NO_THEME, PALETTES, THEME_KEY, themeEntries } from '../common/themes.js';
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
// that theme whatever the page is drawn in.
function previewCss() {
    return themeEntries().map((e) => {
        const scope = `.sk-theme-card[data-theme="${e.id}"] .sk-preview`;
        if (e.id === NO_THEME) {
            return `${scope} { ${NO_THEME_PREVIEW} }`;
        }
        const P = PALETTES[e.id];
        return `${themeTokens(P, scope)}\n${scope} { --hint-bg: ${P.hintBg}; --hint-fg: ${P.hintFg}; }`;
    }).join('\n');
}

function preview() {
    return h('span', {class: 'sk-preview', 'aria-hidden': 'true'},
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
                    ctx.RUNTIME('localData', {data: {[THEME_KEY]: e.id}});
                    ctx.announce(`Theme: ${e.name}`);
                }
            });
            return {id: e.id, input};
        });
        root.append(
            h('p', {class: 'sk-lead'}, 'The theme of Surfingkeys’ panels, link hints and this page. Every open tab changes with it.'),
            warning,
            h('fieldset', {class: 'sk-themes'},
                h('legend', {class: 'sk-vh'}, 'Theme'),
                cards.map((c) => c.input.parentElement)));

        function mark(stored) {
            const id = stored === NO_THEME || PALETTES.hasOwnProperty(stored) ? stored : DEFAULT_THEME;
            cards.forEach((c) => {
                c.input.checked = c.id === id;
            });
        }
        mark(undefined);

        return {
            onTheme: mark,
            onSettings(rs) {
                warning.hidden = !overridesTheme(rs);
            },
        };
    },
};
