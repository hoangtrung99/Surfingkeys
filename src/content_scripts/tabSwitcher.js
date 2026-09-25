// Page side of the Command Palette and the Visual Tab Switcher.
//
// The browser shortcuts (chrome.commands, see background/tabSwitcher.js) and
// the in-page mappings below both end up in the frontend frame: the palette is
// an omnibar type, the switcher is the #sk_switcher surface (ui/tabSwitcher.js).
import { runtime } from './common/runtime.js';
import { generateQuickGuid } from './common/utils.js';

function isFrontendVisible() {
    for (const host of document.documentElement.children) {
        const frame = host.shadowRoot && host.shadowRoot.querySelector('iframe.sk_ui');
        if (frame) {
            return !!frame.style.height && frame.style.height !== '0px';
        }
    }
    return false;
}

export default function installTabSwitcher(api, front) {
    function openPalette() {
        front.command({action: 'togglePalette'});
    }

    // Releasing Alt switches to the selected tab. The key-down lands here, in the
    // page, and focus reaches the frontend frame a few hops later, so a quick tap
    // can release Alt while this window still has focus. Relay that one keyup;
    // once focus has moved into the frame, the frame sees the keyup itself.
    function openSwitcher(backward) {
        const session = generateQuickGuid();
        front.command({action: 'openSwitcher', backward, session});
        const onKeyUp = (e) => {
            if (e.key === 'Alt') {
                cleanup();
                front.command({action: 'switcherModifierUp', session});
            }
        };
        const cleanup = () => {
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', cleanup);
        };
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', cleanup);
    }

    // Fallbacks for when the browser shortcuts are unassigned or taken by
    // another extension. Shift on a letter is written as upper case.
    api.mapkey('<Alt-q>', '#3Visual tab switcher', () => openSwitcher(false));
    api.mapkey('<Alt-Q>', '#3Visual tab switcher, previous tab', () => openSwitcher(true));
    api.mapkey('<Meta-P>', '#8Command palette', openPalette);
    api.mapkey('<Ctrl-P>', '#8Command palette', openPalette);

    if (window === top) {
        runtime.on('tabSwitcherCommand', (msg) => {
            msg.action === 'openSwitcher' ? openSwitcher(false) : openPalette();
        });
        // answered synchronously: runtime.js never keeps the channel open
        runtime.on('tabSwitcherUiVisible', (msg, sender, response) => {
            response({visible: isFrontendVisible()});
        });
    }
}
