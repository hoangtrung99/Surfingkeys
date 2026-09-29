// What the toolbar popup (popup.js) and the welcome page (welcome.js) both
// offer: the built-in themes as swatches, picked the way the theme menu picks
// them, and the state of the fork's browser shortcuts. Both are extension
// pages, so this reads chrome.storage and chrome.commands itself. It imports
// nothing heavier than themes.js: the popup opens on every click of the
// toolbar button and has to be up at once.
import { RUNTIME } from './runtime.js';
import { DEFAULT_THEME, NO_THEME, PALETTES, THEME_IDS, THEME_KEY } from './themes.js';

// the same swatches as the theme menu (ui/themeMenu.js), in its order
export const THEME_CHOICES = THEME_IDS.map((id) => {
    const P = PALETTES[id];
    return {id, name: P.name, bg: P.surface || P.bg, dots: [P.text, P.accent, P.mauve], light: P.light};
}).concat({
    // frontend.css: white panel, black text, red matches
    id: NO_THEME, name: 'Surfingkeys', bg: '#ffffff', dots: ['#000000', '#b90c0c', '#4b3acc'], light: true,
});

// The theme a stored pick shows: nothing picked yet is the default, as in
// content_scripts/theme.js.
export function themeInUse(stored) {
    return stored === NO_THEME || PALETTES.hasOwnProperty(stored) ? stored : DEFAULT_THEME;
}

export function themeName(id) {
    return id === NO_THEME ? 'Surfingkeys' : PALETTES[id].name;
}

function tokens(P) {
    return `--bg:${P.surface || P.bg};--mantle:${P.mantle};--s0:${P.s0};--s1:${P.s1};--s2:${P.s2};`
        + `--overlay:${P.overlay};--sub:${P.sub};--text:${P.text};`
        + `--accent:${P.accent};--accent-text:${P.accentText || P.accent};--on-accent:${P.onAccent};`
        + `--green:${P.green};--red:${P.red};color-scheme:${P.light ? 'light' : 'dark'};`;
}

// A stylesheet giving the page the colours of theme `id`, so the page itself
// shows a pick. Surfingkeys' own look has no page colours, so with it the page
// follows the system: GitHub Light, or Catppuccin Mocha when dark.
export function pageTokens(id) {
    if (id === NO_THEME) {
        return `:root{${tokens(PALETTES.github)}}@media (prefers-color-scheme: dark){:root{${tokens(PALETTES.mocha)}}}`;
    }
    return `:root{${tokens(PALETTES[themeInUse(id)])}}`;
}

// Calls back with the theme in use, then again whenever it changes, whichever
// page or tab changed it.
export function watchTheme(cb) {
    chrome.storage.local.get(THEME_KEY, (items) => {
        cb(themeInUse(!chrome.runtime.lastError && items ? items[THEME_KEY] : undefined));
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.hasOwnProperty(THEME_KEY)) {
            cb(themeInUse(changes[THEME_KEY].newValue));
        }
    });
}

// localData stores the pick and sends it to every open tab, which restyles
// them all; the theme menu picks the same way (content_scripts/theme.js).
export function pickTheme(id) {
    RUNTIME('localData', {data: {[THEME_KEY]: id}});
}

// One radio button per theme in `container`, so Tab reaches the group once and
// the arrow keys move the pick, as in any radio group. `onPick(id)` runs for a
// pick made here; show(id) marks the theme in use without calling it.
export function createThemePicker(container, onPick) {
    const name = `${container.id || 'sk'}_theme`;
    const inputs = THEME_CHOICES.map((t) => {
        const label = document.createElement('label');
        label.className = `sk_swatch ${t.light ? 'sk_swatch_light' : 'sk_swatch_dark'}`;
        label.title = t.name;
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = t.id;
        input.setAttribute('aria-label', t.name);
        input.addEventListener('change', () => {
            input.checked && onPick(t.id);
        });
        const chip = document.createElement('span');
        chip.style.background = t.bg;
        t.dots.forEach((c) => {
            const dot = document.createElement('i');
            dot.style.background = c;
            chip.appendChild(dot);
        });
        label.append(input, chip);
        container.appendChild(label);
        return input;
    });
    return {
        show(id) {
            inputs.forEach((input) => {
                input.checked = input.value === id;
            });
        },
    };
}

// The fork's browser shortcuts (background/tabSwitcher.commands.json).
const SHORTCUTS = [
    {name: 'commandPalette', label: 'Command palette'},
    {name: 'tabSwitcher', label: 'Tab switcher'},
];

// Inside pages Surfingkeys maps the palette to <Ctrl-P> and <Meta-P>
// (content_scripts/tabSwitcher.js) whatever the browser shortcut is.
export const IN_PAGE_PALETTE_KEY = /Mac/.test(navigator.platform) ? '⇧⌘P' : 'Ctrl+Shift+P';

// Calls back with [{name, label, shortcut}], shortcut '' for one the browser
// left without a key (it does that silently when another extension or the
// browser itself already holds the key), or [] where the browser has none of
// these shortcuts (only Chrome builds declare them).
export function readShortcuts(cb) {
    if (!chrome.commands || !chrome.commands.getAll) {
        cb([]);
        return;
    }
    chrome.commands.getAll((cmds) => {
        const keys = new Map((cmds || []).map((c) => [c.name, c.shortcut || '']));
        cb(SHORTCUTS.filter((s) => keys.has(s.name)).map((s) => Object.assign({shortcut: keys.get(s.name)}, s)));
    });
}

// The key of shortcut `s` as a <kbd>, or a "Not assigned" chip.
export function shortcutElement(s) {
    const el = document.createElement(s.shortcut ? 'kbd' : 'span');
    el.className = s.shortcut ? 'sk_key' : 'sk_unassigned';
    el.textContent = s.shortcut || 'Not assigned';
    return el;
}

// chrome:// pages open only through chrome.tabs, never from a link.
export function openShortcutSettings() {
    chrome.tabs.create({url: 'chrome://extensions/shortcuts'});
}
