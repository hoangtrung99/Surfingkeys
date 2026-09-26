// Visual Tab Switcher: a strip of tab previews, most recently used first.
// Hold Alt and press Q to move, release Alt to switch; Shift+Alt+Q, Tab,
// Shift+Tab and the arrow keys move too, Enter switches, Esc cancels.
import { RUNTIME, runtime } from '../common/runtime.js';
import { attachFaviconToImgSrc } from '../common/utils.js';
import Mode from '../common/mode';

function hostOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
        return url;
    }
}

function el(tag, className, text) {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined) {
        e.textContent = text;  // titles are page-controlled: never parse them as HTML
    }
    return e;
}

export default function createTabSwitcher(front, showElement) {
    const ui = document.getElementById('sk_switcher');
    const hud = el('div', 'sk_switcher_hud sk_theme');
    const track = el('div', 'sk_switcher_track');
    hud.setAttribute('role', 'listbox');
    hud.setAttribute('aria-label', 'Tabs');
    hud.append(track);
    ui.append(hud);

    const mode = new Mode("Switcher");
    let tabs = [], cards = [], selected = 0;
    let session = null, pendingCommit = false, pendingSteps = 0, lastPointer = null;

    function select(i) {
        if (!cards.length) {
            return;
        }
        selected = (i + cards.length) % cards.length;
        cards.forEach((c, n) => {
            c.classList.toggle('selected', n === selected);
            c.setAttribute('aria-selected', n === selected);
        });
        // the frame may still be 0px tall right after opening: measure after layout
        requestAnimationFrame(() => requestAnimationFrame(() => {
            cards[selected] && cards[selected].scrollIntoView({block: 'nearest', inline: 'nearest'});
        }));
    }

    // Presses that arrive before the tab list count too, or the selection lands short.
    function move(step) {
        if (cards.length) {
            select(selected + step);
        } else {
            pendingSteps += step;
        }
    }

    function commit() {
        if (!tabs.length) {
            pendingCommit = true;  // Alt released before the list arrived: switch as soon as it does
            return;
        }
        const tab = tabs[selected];
        // hide first: a deactivated tab keeps its frontend while a surface is showing
        front.hidePopup();
        if (tab && !tab.current) {
            RUNTIME('focusTab', {windowId: tab.windowId, tabId: tab.id});
        }
    }

    function card(tab, i) {
        const c = el('div', 'sk_switcher_card');
        c.setAttribute('role', 'option');
        c.dataset.tabId = tab.id;
        const thumb = el('div', 'sk_switcher_thumb');
        const bigIcon = el('img', 'sk_switcher_favicon');
        attachFaviconToImgSrc(tab, bigIcon);
        thumb.append(bigIcon, el('span', 'sk_switcher_host', hostOf(tab.url)));
        const meta = el('div', 'sk_switcher_meta');
        const icon = el('img', 'sk_switcher_icon');
        attachFaviconToImgSrc(tab, icon);
        meta.append(icon, el('span', 'sk_switcher_title', tab.title || hostOf(tab.url)));
        c.append(thumb, meta);
        c.addEventListener('mousemove', (e) => {
            // a strip appearing under a resting pointer must not steal the preselection
            if (lastPointer && (lastPointer[0] !== e.screenX || lastPointer[1] !== e.screenY) && selected !== i) {
                select(i);
            }
            lastPointer = [e.screenX, e.screenY];
        });
        c.addEventListener('click', () => {
            select(i);
            commit();
        });
        return c;
    }

    function render(list, backward) {
        tabs = list;
        cards = tabs.map(card);
        track.replaceChildren(...cards);
        select(tabs.length < 2 ? 0 : (backward ? tabs.length - 1 : 1) + pendingSteps);
        pendingSteps = 0;
        if (pendingCommit) {
            commit();
            return;
        }
        RUNTIME('tabSwitcherThumbnails', {tabIds: tabs.map((t) => t.id)}, (resp) => {
            const thumbs = (resp && resp.thumbs) || {};
            tabs.forEach((t, n) => {
                const shot = thumbs[t.id];
                // a thumbnail of a page the tab has since navigated away from is worse than none
                if (shot && shot.url === t.url && cards[n]) {
                    const img = el('img', 'sk_switcher_shot');
                    img.alt = '';
                    img.src = shot.thumb;
                    cards[n].querySelector('.sk_switcher_thumb').append(img);
                    cards[n].classList.add('has-shot');
                }
            });
        });
    }

    mode.addEventListener('keydown', function(event) {
        // the frontend runs a full Normal mode underneath: 'x' would close the tab
        event.sk_suppressed = true;
        let handled = true;
        // Esc arrives as <Alt-Esc> while Alt is still held, and must cancel all the same
        if (event.key === 'Escape' || Mode.isSpecialKeyOf("<Esc>", event.sk_keyName)) {
            front.hidePopup();
        } else if (event.altKey && event.keyCode === 81) {  // the letter Q on any layout, like the mapping
            move(event.shiftKey ? -1 : 1);
        } else if (event.key === 'Tab') {
            move(event.shiftKey ? -1 : 1);
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            move(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            move(-1);
        } else if (event.key === 'Enter') {
            commit();
        } else {
            handled = false;
        }
        if (handled) {
            event.sk_stopPropagation = true;
        }
    }).addEventListener('keyup', function(event) {
        event.sk_suppressed = true;
        if (event.key === 'Alt') {  // keyup carries no sk_keyName
            commit();
        }
    }).addEventListener('mousedown', function(event) {
        if (!hud.contains(event.target)) {
            front.hidePopup();
        }
        event.sk_suppressed = true;
    });

    // switching app or tab by other means leaves nothing to come back to
    window.addEventListener('blur', () => {
        if (ui.style.display !== 'none') {
            front.hidePopup();
        }
    });

    ui.onHide = function() {
        mode.exit();
        tabs = [];
        cards = [];
        session = null;
        pendingCommit = false;
        pendingSteps = 0;
        lastPointer = null;
        track.replaceChildren();
    };

    front._actions['openSwitcher'] = function(message) {
        if (ui.style.display !== 'none') {
            // pressed again while open: move instead of re-rendering
            move(message.backward ? -1 : 1);
            return;
        }
        session = message.session;
        showElement(ui, () => {
            mode.enter(0, true);
            RUNTIME('tabSwitcherTabs', {}, (resp) => {
                if (ui.style.display !== 'none' && session === message.session) {
                    render((resp && resp.tabs) || [], message.backward);
                }
            });
        });
    };
    // Alt released while focus was still in the page (see content_scripts/tabSwitcher.js).
    // It comes from the background, never over postMessage: the page can post
    // to this frame like any content script, and could then switch tabs by itself.
    // The session drops a relay left over from an earlier switcher.
    runtime.on('tabSwitcherModifierUp', function(message) {
        if (session && message.session === session && ui.style.display !== 'none') {
            commit();
        }
    });
}
