// pages/palette.html hosts the Command Palette and the Visual Tab Switcher for
// a tab Surfingkeys cannot run in (background/hostedUi.js). This runs before
// the first paint, so the page starts in the panel's colour and size, and
// keeps the keys typed before Surfingkeys is up (content_scripts/tabSwitcher.js
// takes them over).
(function() {
    const query = new URLSearchParams(location.search);
    const root = document.documentElement;
    root.dataset.ui = query.get('ui') === 'switcher' ? 'switcher' : 'palette';
    root.dataset.surface = query.get('surface') === 'window' ? 'window' : 'popup';
    if (/^#[0-9a-f]{6}$/i.test(query.get('bg') || '')) {
        root.style.background = query.get('bg');
    }
    const early = window.__skEarly = {keys: ''};
    function onKey(e) {
        if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey) {
            early.keys += e.key;
        } else if (e.key === 'Backspace') {
            early.keys = early.keys.slice(0, -1);
        }
    }
    window.addEventListener('keydown', onKey, true);
    early.stop = function() {
        window.removeEventListener('keydown', onKey, true);
    };
})();
