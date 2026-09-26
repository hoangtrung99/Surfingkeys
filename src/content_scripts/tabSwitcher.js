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
// Anything that can end in a tab switch travels over chrome.runtime, through the
// background: the page can post to window.postMessage like any content script,
// and a switch it could trigger there would move the user with no key pressed.
import { RUNTIME, runtime } from './common/runtime.js';
import { generateQuickGuid } from './common/utils.js';
import Mode from './common/mode.js';

const TYPE_AHEAD_MS = 500;
const CLAIM_WAIT_MS = 100;

let altHeld = false;
let holding = false, buffer = '', holdTimer = null;
let heldKey = null;  // Enter, Esc or Tab typed ahead: the palette runs it after the text
let relayArmed = false;
let host = null;  // the top frame's Surfingkeys front, once installTabSwitcher ran there
let holdMode = null;  // where Surfingkeys runs, its mode stack decides who sees a key first
let session = null, claimed = false;
let lastCmdId = null;  // the browser shortcut press the top frame last acted on

// This frame holds the keyboard focus (not one of its subframes).
function hasKeyboardFocus() {
    const active = document.activeElement;
    return document.hasFocus() && !(active && /^(IFRAME|FRAME)$/.test(active.tagName));
}

// The frontend frame is interactive (a panel, not just the status strip).
function isPanelOpen() {
    for (const el of document.documentElement.children) {
        const frame = el.shadowRoot && el.shadowRoot.querySelector('iframe.sk_ui');
        if (frame) {
            return frame.style.pointerEvents === 'all';
        }
    }
    return false;
}

function deliver(data) {
    if (window === top) {
        handleInTop(data);
    } else {
        RUNTIME('tabSwitcherRelay', {data});
    }
}

function handleInTop(data) {
    if (!host) {
        return;
    }
    if (data.open && data.cmdId) {
        // A focused iframe inside a shadow root: the top frame sees the shadow host
        // as its active element and acts too, and a second open of one press would
        // close the palette at once or move the switcher on (a fresh session drops
        // the relayed Alt release as well).
        if (data.cmdId === lastCmdId) {
            return;
        }
        lastCmdId = data.cmdId;
    }
    if (data.open === 'openSwitcher') {
        session = generateQuickGuid();
        // Never switched from here, even when Alt looks released already: this frame
        // knows Alt is down only if it saw the key go down, which it misses whenever
        // focus was elsewhere (address bar, a frame without this script, a page that
        // just got focus). Guessing a quick tap from that switched tabs with no
        // switcher shown; the UI decides instead (ui/tabSwitcher.js).
        host.command({action: 'openSwitcher', backward: !!data.backward, session});
    } else if (data.open === 'openPalette') {
        host.command({action: 'togglePalette'});
    } else if (data.altUp && session) {
        RUNTIME('tabSwitcherModifierUp', {session, at: data.at});
    } else if (typeof data.typeAhead === 'string') {
        // they can end in Enter, so chrome.runtime (see above), and only once the
        // frontend is up: until then nothing would take them
        host.afterCommands(() => RUNTIME('tabSwitcherPaletteTypeAhead', {text: data.typeAhead, then: data.then, shift: data.shift}));
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
        (buffer || heldKey) && deliver({typeAhead: buffer, then: heldKey && heldKey.key, shift: heldKey && heldKey.shift});
        buffer = '';
        heldKey = null;
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
// `alt` only arms that relay: a release this frame never sees switches nothing.
function start(action, alt, backward, cmdId) {
    if (action === 'openSwitcher') {
        deliver({open: 'openSwitcher', altHeld: alt, backward, cmdId});
        relayArmed = alt;
    } else {
        const closing = window === top && isPanelOpen();
        deliver({open: 'openPalette', cmdId});
        closing || beginHold();  // closing needs no hold, and focus is already in the frame when open
    }
}

function holdKey(e) {
    if (e.key.length === 1 && !e.altKey) {
        buffer += e.key;
    } else if (e.key === 'Backspace') {
        buffer = buffer.slice(0, -1);
    } else if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') {
        // swallowed like the rest, so it is handed over too; nothing typed after it counts
        heldKey = {key: e.key, shift: e.shiftKey};
        setTimeout(endHold, 0);
    }
}

// keys the page makes up (dispatchEvent) are not the user's
window.addEventListener('keydown', (e) => {
    if (!e.isTrusted) {
        return;
    }
    altHeld = e.altKey;
    // a frame Surfingkeys has not set up: nothing else is listening for these keys
    if (holding && !holdMode && !e.metaKey && !e.ctrlKey) {
        holdKey(e);
        e.preventDefault();
        e.stopImmediatePropagation();
    }
}, true);
window.addEventListener('keyup', (e) => {
    if (!e.isTrusted) {
        return;
    }
    altHeld = e.key === 'Alt' ? false : e.altKey;
    if (e.key === 'Alt' && relayArmed) {
        relayArmed = false;
        // when the key went up, as a time every frame reads alike: the relay can land
        // after the strip is drawn, from a release that came before it
        deliver({altUp: true, at: performance.timeOrigin + e.timeStamp});
    }
}, true);
window.addEventListener('blur', () => {
    altHeld = false;
    relayArmed = false;
    endHold();
});

if (window === top) {
    // from a subframe, through the background (see above)
    runtime.on('tabSwitcherRelay', (msg) => {
        claimed = true;
        handleInTop(msg.data || {});
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
        start(msg.action, altHeld, false, msg.cmdId);
    } else if (window === top) {
        if (!document.hasFocus()) {
            start(msg.action, false, false, msg.cmdId);
        } else {
            claimed = false;
            setTimeout(() => claimed || start(msg.action, false, false, msg.cmdId), CLAIM_WAIT_MS);
        }
    }
});

export default function installTabSwitcher(api, front) {
    if (window === top) {
        host = front;
    }
    holdMode = new Mode("PaletteTypeAhead");
    // keys the page makes up are not held: handed over, an Enter among them would
    // let the page pick a tab or open a URL through the palette
    holdMode.addEventListener('keydown', (e) => {
        if (e.isTrusted && !e.metaKey && !e.ctrlKey) {
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
}
