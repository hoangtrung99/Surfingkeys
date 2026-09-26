// Page side of the Command Palette and the Visual Tab Switcher.
//
// The browser shortcuts (chrome.commands, see background/tabSwitcher.js) and
// the in-page mappings below both end up in the frontend frame: the palette is
// an omnibar type, the switcher is the #sk_switcher surface (ui/tabSwitcher.js).
//
// The code at module level runs in EVERY frame as soon as the content script
// loads, before Surfingkeys sets anything up: a subframe that holds the
// keyboard focus (an editor, an embedded comment box) is where Alt is released
// and where keys typed ahead land, even when Surfingkeys has not initialised it.
// Such a frame reports to the top frame, which is the one that talks to the UI.
//
// On a tab Surfingkeys cannot run in, the background opens pages/palette.html
// in the toolbar dropdown (or a small window) instead; this module is what
// drives it there (startHosted).
import { RUNTIME, runtime } from './common/runtime.js';
import { generateQuickGuid } from './common/utils.js';
import { THEME_KEY } from './common/themes.js';
import Mode from './common/mode.js';

const HOSTED = window === top && location.href.startsWith(chrome.runtime.getURL('pages/palette.html'));
// palette.html loads its frontend frame from scratch, so the input takes longer to get the keyboard
const TYPE_AHEAD_MS = HOSTED ? 2000 : 500;
const CLAIM_WAIT_MS = 100;
const CLOSE_MS = 250;          // outlasts the 100 ms between a palette row and the omnibar it opens
const BANNER_MS = 1200;        // long enough to read "Copied"
const NEVER_SHOWN_MS = 5000;
const MSG = 'surfingkeys_tabswitcher';

let altHeld = false;
let holding = false, buffer = '', holdTimer = null;
let relayArmed = false;
let host = null;  // the top frame's Surfingkeys front, once installTabSwitcher ran there
let holdMode = null;  // where Surfingkeys runs, its mode stack decides who sees a key first
let session = null, claimed = false;

// This frame holds the keyboard focus (not one of its subframes).
function hasKeyboardFocus() {
    const active = document.activeElement;
    return document.hasFocus() && !(active && /^(IFRAME|FRAME)$/.test(active.tagName));
}

function uiFrame() {
    for (const el of document.documentElement.children) {
        const frame = el.shadowRoot && el.shadowRoot.querySelector('iframe.sk_ui');
        if (frame) {
            return frame;
        }
    }
    return null;
}

// The frontend frame is interactive (a panel, not just the status strip).
function isPanelOpen() {
    const frame = uiFrame();
    return !!frame && frame.style.pointerEvents === 'all';
}

function deliver(data) {
    if (window === top) {
        handleInTop(data);
    } else {
        window.top.postMessage({[MSG]: data}, '*');
    }
}

function handleInTop(data) {
    if (!host) {
        return;
    }
    if (data.open === 'openSwitcher') {
        session = generateQuickGuid();
        host.command({action: 'openSwitcher', backward: !!data.backward, session});
        if (!data.altHeld) {  // released before the UI could hear it: a quick tap
            host.command({action: 'switcherModifierUp', session});
        }
    } else if (data.open === 'openPalette') {
        host.command({action: 'togglePalette'});
    } else if (data.altUp && session) {
        host.command({action: 'switcherModifierUp', session});
    } else if (typeof data.typeAhead === 'string') {
        host.command({action: 'paletteTypeAhead', text: data.typeAhead});
    }
}

// Until the palette's input has focus, keys still land in this frame, where
// Surfingkeys' Normal mode would run them ('x' closes the tab) or an editor
// would take them. Hold them and hand them over.
function endHold() {
    clearTimeout(holdTimer);
    if (holding) {
        holding = false;
        holdMode && holdMode.exit(true);  // peek: leave whatever mode sits above untouched
        buffer && deliver({typeAhead: buffer});
        buffer = '';
    }
}
function beginHold() {
    endHold();
    holding = true;
    holdMode && holdMode.enter(0, true);
    holdTimer = setTimeout(endHold, TYPE_AHEAD_MS);
}

// Releasing Alt switches to the selected tab. Focus reaches the frontend frame a
// few hops after the key-down; relay the keyup that lands here meanwhile. Once
// focus has moved (this window blurs), the frontend hears the keyup itself.
function start(action, alt, backward) {
    if (action === 'openSwitcher') {
        deliver({open: 'openSwitcher', altHeld: alt, backward});
        relayArmed = alt;
    } else {
        const closing = window === top && isPanelOpen();
        deliver({open: 'openPalette'});
        closing || beginHold();  // closing needs no hold, and focus is already in the frame when open
    }
}

function holdKey(e) {
    if (e.key.length === 1 && !e.altKey) {
        buffer += e.key;
    } else if (e.key === 'Backspace') {
        buffer = buffer.slice(0, -1);
    }
}

window.addEventListener('keydown', (e) => {
    altHeld = e.altKey;
    // a frame Surfingkeys has not set up: nothing else is listening for these keys
    if (holding && !holdMode && !e.metaKey && !e.ctrlKey) {
        holdKey(e);
        e.preventDefault();
        e.stopImmediatePropagation();
    }
}, true);
window.addEventListener('keyup', (e) => {
    altHeld = e.key === 'Alt' ? false : e.altKey;
    if (e.key === 'Alt' && relayArmed) {
        relayArmed = false;
        deliver({altUp: true});
    }
}, true);
window.addEventListener('blur', () => {
    altHeld = false;
    relayArmed = false;
    endHold();
});

if (window === top) {
    // The page can post this too, like anything on the ui host bridge; it can only
    // open these panels or confirm the switcher, never reach another page.
    window.addEventListener('message', (e) => {
        const data = e.data && e.data[MSG];
        if (data && e.source !== window) {
            claimed = true;
            handleInTop(data);
        }
    });
    runtime.on('tabSwitcherUiVisible', (msg, sender, response) => {
        response({visible: isPanelOpen()});  // answered synchronously: runtime.js never keeps the channel open
    });
}

// Sent to every frame. The one with the keyboard focus acts; the top frame acts
// when focus is outside the page (address bar), or when the focused subframe
// has no content script to answer.
runtime.on('tabSwitcherCommand', (msg, sender, response) => {
    response({});  // tells the background a content script is here
    if (hasKeyboardFocus()) {
        start(msg.action, altHeld);
    } else if (window === top) {
        if (!document.hasFocus()) {
            start(msg.action, false);
        } else {
            claimed = false;
            setTimeout(() => claimed || start(msg.action, false), CLAIM_WAIT_MS);
        }
    }
});

// palette.html: the page is the panel. It opens the panel it was opened for,
// takes what the background hands over, and closes once the panel does.
let hostedStarted = false;
function startHosted() {
    const query = new URLSearchParams(location.search);
    const n = query.get('n');
    const inWindow = query.get('surface') === 'window';
    const early = window.__skEarly;  // keys typed before this ran (palette_boot.js)
    let closed = false, shown = false, closeTimer = null;
    session = generateQuickGuid();  // one switcher for the page's life: an Alt released here confirms it

    function close() {
        if (!closed) {
            closed = true;
            RUNTIME('tabSwitcherHosted', {done: true, n});
            // the background closes the fallback window's tab; this is for when it cannot
            setTimeout(() => window.close(), inWindow ? 500 : 0);
        }
    }
    function run(action) {
        document.documentElement.dataset.ui = action;  // the dropdown follows the page's size
        if (action === 'palette') {
            start('openPalette');
        } else {
            // straight to the frontend, not through deliver(): each press there
            // is a new switcher, here they are one, and the later ones move it
            host.command({action: 'openSwitcher', session});
            relayArmed = true;
        }
    }

    // Normal mode runs in this page as in any other, and the background acts
    // on the blocked tab for any request from it: a stray 'x' here would close
    // that tab. Nothing here is for the page's own keys.
    const sink = new Mode("PaletteHost");
    sink.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            close();
        } else if (holding && !e.metaKey && !e.ctrlKey) {
            holdKey(e);
        }
        e.sk_stopPropagation = true;
    }).addEventListener('keyup', (e) => {
        e.sk_stopPropagation = true;
    });
    sink.enter(9999, true);

    runtime.on('tabSwitcherHosted', (msg) => {
        if (msg.n === n) {
            msg.action === 'close' ? close() : run(msg.action);
        }
    });

    // The theme's own request went out first: its answer is in by now, so the
    // frontend is created with the theme and draws the panel in it straight away.
    RUNTIME('localData', {data: THEME_KEY}, () => {
        run(document.documentElement.dataset.ui === 'switcher' ? 'switcher' : 'palette');
        if (early) {
            early.stop();
            holding && (buffer = early.keys + buffer);
        }
        const frame = uiFrame();
        // the panel closed: so does the page, unless another one opens right after
        frame && new MutationObserver(() => {
            clearTimeout(closeTimer);
            if (frame.style.pointerEvents === 'all') {
                shown = true;
            } else if (shown) {
                closeTimer = setTimeout(close, parseFloat(frame.style.height) > 0 ? BANNER_MS : CLOSE_MS);
            }
        }).observe(frame, {attributes: true, attributeFilter: ['style']});
        setTimeout(() => shown || close(), NEVER_SHOWN_MS);
        // what was pressed while this loaded, or null: nobody is waiting for this page
        RUNTIME('tabSwitcherHosted', {ready: true, n}, (resp) => {
            const queue = resp && resp.queue;
            Array.isArray(queue) ? queue.forEach(run) : close();
        });
    });
    // the window came back (a click on its title bar): the panel wants the keys
    window.addEventListener('focus', () => {
        isPanelOpen() && uiFrame().focus();
    });
}

export default function installTabSwitcher(api, front) {
    if (window === top) {
        host = front;
    }
    holdMode = new Mode("PaletteTypeAhead");
    holdMode.addEventListener('keydown', (e) => {
        if (!e.metaKey && !e.ctrlKey) {
            holdKey(e);
            e.sk_stopPropagation = true;
        }
    });
    // Fallbacks for when the browser shortcuts are unassigned. They cannot fire
    // while another extension holds the same shortcut. Shift on a letter is
    // written as upper case.
    api.mapkey('<Alt-q>', '#3Visual tab switcher', () => start('openSwitcher', altHeld, false));
    api.mapkey('<Alt-Q>', '#3Visual tab switcher, previous tab', () => start('openSwitcher', altHeld, true));
    api.mapkey('<Meta-P>', '#8Command palette', () => start('openPalette'));
    api.mapkey('<Ctrl-P>', '#8Command palette', () => start('openPalette'));
    if (HOSTED && !hostedStarted) {
        hostedStarted = true;
        startHosted();
    }
}
