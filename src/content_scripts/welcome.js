// The welcome screen of start.html (#welcome), which install opens
// (background/tabSwitcher.js): the command palette, the tab switcher and the
// themes, with the live state of their browser shortcuts. Chrome leaves a
// shortcut without a key, silently, when another extension or the browser
// already holds it, and this is where the user learns that and fixes it.
import {
    IN_PAGE_PALETTE_KEY,
    createThemePicker,
    openShortcutSettings,
    pickTheme,
    readShortcuts,
    shortcutElement,
    themeName,
} from './common/quickControls.js';

export default function createWelcome(section) {
    const $ = (id) => document.getElementById(id);

    function keyLine(el, s, what) {
        el.textContent = '';
        el.append(`${what}: `, shortcutElement(s));
    }

    function renderShortcuts(list) {
        const byName = {};
        list.forEach((s) => {
            byName[s.name] = s;
        });
        const palette = byName.commandPalette, switcher = byName.tabSwitcher;
        palette && keyLine($('paletteKey'), palette, 'Browser shortcut');
        switcher && keyLine($('switcherKey'), switcher, 'Browser shortcut');
        const missing = list.filter((s) => !s.shortcut);
        $('shortcutFix').hidden = !missing.length;
        $('shortcutFixText').textContent = missing.length
            ? `${missing.map((s) => s.label).join(' and ')} got no browser shortcut: another extension or the browser already uses its key. Pick one in the browser's shortcut settings.`
            : '';
        const tryIt = $('tryIt');
        tryIt.textContent = '';
        tryIt.append('Try it now: press ', shortcutElement({shortcut: (palette && palette.shortcut) || IN_PAGE_PALETTE_KEY}), ' to open the palette on this page.');
    }

    $('inPagePaletteKey').textContent = IN_PAGE_PALETTE_KEY;
    $('fixShortcuts').addEventListener('click', openShortcutSettings);
    readShortcuts(renderShortcuts);
    // back from the shortcut settings: show what the user picked there
    window.addEventListener('focus', () => readShortcuts(renderShortcuts));
    document.addEventListener('visibilitychange', () => {
        document.visibilityState === 'visible' && readShortcuts(renderShortcuts);
    });

    const picker = createThemePicker($('welcomeThemes'), (id) => {
        pickTheme(id);
        $('welcomeStatus').textContent = `Theme: ${themeName(id)}`;
    });

    return {
        showTheme(id) {
            picker.show(id);
            $('welcomeThemeName').textContent = themeName(id);
        },
        show(on) {
            section.hidden = !on;
            document.title = on ? 'Welcome to Surfingkeys' : 'Surfingkeys';
        },
    };
}
