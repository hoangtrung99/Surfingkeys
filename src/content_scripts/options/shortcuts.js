// The Browser shortcuts card at the top of Keys: the extension's commands
// (manifest "commands") and the keys the browser gave them. The browser assigns
// a suggested key only when nothing else holds it, so a command can be left with
// none, and only the browser's own page can change that.
import { h } from './dom.js';

export const SHORTCUTS_URL = 'chrome://extensions/shortcuts';

// the fork's commands, shown first; the others go under "More browser shortcuts"
const MAIN = ['commandPalette', 'tabSwitcher'];
const NAMES = {
    commandPalette: 'Command palette',
    tabSwitcher: 'Visual tab switcher',
    _execute_action: 'Open the Surfingkeys popup',
    _execute_browser_action: 'Open the Surfingkeys popup',
    restartext: 'Restart Surfingkeys',
    previousTab: 'Go to the previous tab',
    nextTab: 'Go to the next tab',
    closeTab: 'Close the current tab',
    proxyThis: 'Toggle the proxy for this site',
};

/*
 * chrome.commands.getAll() as rows: {name, label, shortcut, main}, the fork's
 * commands first in MAIN order, the rest by label. With none of the fork's
 * commands (Firefox, Safari builds) every command is a main one.
 */
export function shortcutRows(commands) {
    const rows = (commands || []).filter((c) => c && c.name).map((c) => ({
        name: c.name,
        label: NAMES[c.name] || c.description || c.name,
        shortcut: c.shortcut || '',
        main: MAIN.includes(c.name),
    }));
    if (!rows.some((r) => r.main)) {
        rows.forEach((r) => {
            r.main = true;
        });
    }
    return rows.sort((a, b) => {
        if (a.main !== b.main) {
            return a.main ? -1 : 1;
        }
        const ia = MAIN.indexOf(a.name), ib = MAIN.indexOf(b.name);
        if (ia !== ib) {
            return (ia === -1 ? MAIN.length : ia) - (ib === -1 ? MAIN.length : ib);
        }
        return a.label.localeCompare(b.label);
    });
}

function row(r) {
    const key = r.shortcut
        ? h('kbd', {class: 'sk-shortcut'}, r.shortcut)
        : h('span', {class: 'sk-chip-warn'}, 'Not assigned');
    return h('li', {class: 'sk-shortcutrow' + (r.main ? ' sk-row' : ''), dataset: {command: r.name, keywords: 'browser shortcut command'}},
        h('span', {class: 'sk-shortcutname'}, r.label), key);
}

export function createShortcutsCard(ctx) {
    const firefox = ctx.browserName === 'Firefox';
    const commands = typeof chrome !== 'undefined' && chrome.commands && typeof chrome.commands.getAll === 'function'
        ? chrome.commands : null;

    const main = h('ul', {class: 'sk-shortcuts', id: 'browserShortcutsList'});
    const more = h('ul', {class: 'sk-shortcuts'});
    // Its rows stay out of "Find a setting", which counts only rows on screen:
    // this one row stands for them, by what the summary says.
    const details = h('details', {class: 'sk-help sk-row', dataset: {filter: 'more browser shortcuts'}},
        h('summary', null, 'More browser shortcuts'), more);
    const paletteNote = h('p', {class: 'sk-muted', id: 'browserShortcutsPaletteNote', hidden: true},
        'Until the command palette has a shortcut, it opens only on pages where Surfingkeys runs, with Ctrl+Shift+P (Cmd+Shift+P too on a Mac), and not on browser pages or the browser\'s own new tab page.');
    const status = h('p', {class: 'sk-muted'});
    const change = h('button', {type: 'button', class: 'sk-btn', id: 'browserShortcutsChange'}, 'Change in browser');
    change.addEventListener('click', () => {
        chrome.tabs.create({url: SHORTCUTS_URL});
    });
    const actions = firefox
        ? h('p', {class: 'sk-muted'}, 'To change them, open about:addons, then the gear menu, then Manage Extension Shortcuts.')
        : h('div', {class: 'sk-actions'}, change);

    const card = h('div', {class: 'sk-card', id: 'browserShortcuts'},
        h('h3', null, 'Browser shortcuts'),
        h('p', {class: 'sk-muted'}, 'These keys work in every tab, browser pages included. The browser keeps them: it leaves one unassigned when another extension already uses its key.'),
        status, main, paletteNote, details, actions);

    function render(list) {
        const rows = shortcutRows(list);
        status.hidden = rows.length > 0;
        status.textContent = 'This browser lists no shortcuts for Surfingkeys.';
        main.replaceChildren(...rows.filter((r) => r.main).map(row));
        const others = rows.filter((r) => !r.main);
        more.replaceChildren(...others.map(row));
        details.hidden = !others.length;
        const palette = rows.find((r) => r.name === 'commandPalette');
        paletteNote.hidden = !palette || !!palette.shortcut;
    }

    function refresh() {
        if (!commands) {
            render([]);
            return;
        }
        commands.getAll((list) => render(list));
    }

    // changed on the browser's own page, then back here
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            refresh();
        }
    });
    refresh();
    return {card, refresh};
}
