// Page side of the Command Palette and the Visual Tab Switcher.
//
// The browser shortcuts (chrome.commands, see background/tabSwitcher.js) and
// the in-page mappings below both end up in the frontend frame: the palette is
// an omnibar type, the switcher is the #sk_switcher surface (ui/tabSwitcher.js).
import { runtime } from './common/runtime.js';
import { generateQuickGuid } from './common/utils.js';
import Mode from './common/mode.js';

const TYPE_AHEAD_MS = 500;

// The frontend frame is interactive (a panel, not just the status strip).
function isPanelOpen() {
    for (const host of document.documentElement.children) {
        const frame = host.shadowRoot && host.shadowRoot.querySelector('iframe.sk_ui');
        if (frame) {
            return frame.style.pointerEvents === 'all';
        }
    }
    return false;
}

// This frame holds the keyboard focus (not one of its subframes).
function hasKeyboardFocus() {
    const active = document.activeElement;
    return document.hasFocus() && !(active && /^(IFRAME|FRAME)$/.test(active.tagName));
}

export default function installTabSwitcher(api, front) {
    // Alt is tracked all the time: the browser shortcut consumes Alt+Q itself, and
    // a quick tap can release Alt before this frame even hears about the command.
    let altHeld = false;
    window.addEventListener('keydown', (e) => {
        altHeld = e.altKey;
    }, true);
    window.addEventListener('keyup', (e) => {
        altHeld = e.key === 'Alt' ? false : e.altKey;
    }, true);
    window.addEventListener('blur', () => {
        altHeld = false;
    });

    // Releasing Alt switches to the selected tab. Focus reaches the frontend frame
    // a few hops after the key-down, so relay the keyup that lands here meanwhile;
    // once focus has moved into the frame, the frame sees the keyup itself.
    let disarmRelay = () => {};
    function openSwitcher(backward) {
        const session = generateQuickGuid();
        front.command({action: 'openSwitcher', backward, session});
        disarmRelay();
        if (!altHeld) {
            front.command({action: 'switcherModifierUp', session});
            return;
        }
        const onKeyUp = (e) => {
            if (e.key === 'Alt') {
                disarmRelay();
                front.command({action: 'switcherModifierUp', session});
            }
        };
        disarmRelay = () => {
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', disarmRelay);
            disarmRelay = () => {};
        };
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', disarmRelay);
    }

    // Until the palette's input has focus, keys still land in this page, where
    // Normal mode would run them ('x' closes the tab). Hold them and hand them over.
    const typeAhead = new Mode("PaletteTypeAhead");
    let buffer = '', typeAheadTimer = null, typing = false;
    typeAhead.addEventListener('keydown', (event) => {
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            buffer += event.key;
        } else if (event.key === 'Backspace') {
            buffer = buffer.slice(0, -1);
        }
        if (!event.metaKey && !event.ctrlKey) {
            event.sk_stopPropagation = true;
        }
    });
    function endTypeAhead() {
        clearTimeout(typeAheadTimer);
        window.removeEventListener('blur', endTypeAhead);
        if (typing) {
            typing = false;
            typeAhead.exit(true);  // peek: leave whatever mode sits above untouched
        }
        if (buffer) {
            front.command({action: 'paletteTypeAhead', text: buffer});
            buffer = '';
        }
    }
    function openPalette() {
        front.command({action: 'togglePalette'});
        endTypeAhead();
        if (isPanelOpen()) {
            return;  // focus is already in the frame (and closing needs no hold at all)
        }
        typing = true;
        typeAhead.enter(0, true);
        window.addEventListener('blur', endTypeAhead);  // the palette took focus
        typeAheadTimer = setTimeout(endTypeAhead, TYPE_AHEAD_MS);
    }

    // Fallbacks for when the browser shortcuts are unassigned. They cannot fire
    // while another extension holds the same shortcut. Shift on a letter is
    // written as upper case.
    api.mapkey('<Alt-q>', '#3Visual tab switcher', () => openSwitcher(false));
    api.mapkey('<Alt-Q>', '#3Visual tab switcher, previous tab', () => openSwitcher(true));
    api.mapkey('<Meta-P>', '#8Command palette', openPalette);
    api.mapkey('<Ctrl-P>', '#8Command palette', openPalette);

    // Sent to every frame; the one with the keyboard focus acts, or the top frame
    // when focus is outside the page (address bar), where Alt cannot be tracked.
    runtime.on('tabSwitcherCommand', (msg, sender, response) => {
        response({});  // answered synchronously: tells the background a content script is here
        if (hasKeyboardFocus() || (window === top && !document.hasFocus())) {
            msg.action === 'openSwitcher' ? openSwitcher(false) : openPalette();
        }
    });
    if (window === top) {
        runtime.on('tabSwitcherUiVisible', (msg, sender, response) => {
            response({visible: isPanelOpen()});
        });
    }
}
