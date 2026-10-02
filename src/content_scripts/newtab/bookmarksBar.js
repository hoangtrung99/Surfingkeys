// The bookmarks bar of the new tab page, laid out as Chrome's own: one row,
// folders open a dropdown, folders in it open cascading submenus, and what
// does not fit goes into a trailing "»" menu. Chrome's bar does not show on an
// extension page in its default "only on the New Tab page" mode, which is why
// this page draws its own.
//
// Read from chrome.bookmarks directly, not through the background: only the
// API itself tells of changes, and the bar follows them while the tab is open.
// Callback style, as everywhere in the extension.
import { faviconUrl } from '../common/favicon.js';
import { linkKind } from './links.js';

const HOVER_MS = 200;    // a submenu opens or closes once the pointer rests this long
const REFRESH_MS = 150;  // bookmark events come in bursts: a folder moved, a sync

// The bar folders of a chrome.bookmarks.getTree() result. Since Chrome 134 the
// API marks them with folderType, and there can be two: the account's and the
// local one. Chrome's bar shows them as one row, the account's items first.
// Before 134 there is only the local bar, which is id '1'.
export function barFolders(tree) {
    const top = (tree && tree[0] && tree[0].children) || [];
    const bars = top.filter((n) => n.folderType === 'bookmarks-bar');
    if (!bars.length) {
        return top.filter((n) => n.id === '1');
    }
    return bars.filter((n) => n.syncing).concat(bars.filter((n) => !n.syncing));
}

export function barItems(tree) {
    return barFolders(tree).reduce((items, folder) => items.concat(folder.children || []), []);
}

function textSpan(text) {
    const span = document.createElement('span');
    span.className = 'sk_bm_title';
    span.textContent = text;
    return span;
}

// One bookmark or folder, on the bar (`inMenu` false) or in a menu. A title
// left empty shows the icon alone on the bar, as Chrome does, and the address
// or "Untitled folder" in a menu.
function entry(node, inMenu) {
    let el;
    if (!node.url) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'sk_bm sk_bm_folder';
        el.setAttribute('aria-expanded', 'false');
        const icon = document.createElement('span');
        icon.className = 'sk_icon_folder';
        icon.setAttribute('aria-hidden', 'true');
        const name = node.title || (inMenu ? 'Untitled folder' : '');
        el.append(icon, textSpan(name));
        name || el.setAttribute('aria-label', 'Untitled folder');
        return el;
    }
    el = document.createElement('a');
    el.className = 'sk_bm';
    const name = node.title || (inMenu ? node.url : '');
    const icon = document.createElement('img');
    icon.src = faviconUrl(node.url, 32);
    icon.width = 16;
    icon.height = 16;
    icon.alt = '';
    el.append(icon, textSpan(name));
    name || el.setAttribute('aria-label', node.url);
    if (linkKind(node.url) === 'script') {
        // shown, so the bar is the user's bar, but never followed: it has no href
        el.setAttribute('role', 'link');
        el.setAttribute('aria-disabled', 'true');
        el.classList.add('sk_bm_disabled');
        el.title = `${node.title || 'Bookmarklet'}\nBookmarklets cannot run on this page.`;
    } else {
        el.href = node.url;
        el.title = node.title ? `${node.title}\n${node.url}` : node.url;
    }
    return el;
}

// `nav` holds #sk_bar_items (the row) and #sk_bar_more (the "»" button's box).
// `say(text)` reports what the user should know and would not see otherwise.
export function createBookmarksBar(nav, {say} = {}) {
    const row = nav.querySelector('#sk_bar_items');
    const moreBox = nav.querySelector('#sk_bar_more');
    const more = moreBox.querySelector('button');
    const nodeOf = new WeakMap();  // a bar or menu entry -> its bookmark node
    let items = [];                // the bar's nodes, in order
    let overflow = [];             // the ones only the "»" menu shows
    // The open menus, outermost first: {button, list, side}. A menu's depth is its
    // index here; a button on the bar opens depth 0, one in the menu at depth
    // k opens depth k + 1.
    const open = [];
    let menuSeq = 0;
    let hoverTimer = null;

    function childrenOf(button) {
        return button === more ? overflow : (nodeOf.get(button).children || []);
    }

    // A submenu lies inside the menu it came from, so every menu around `el`
    // contains it: its depth is that of the innermost one.
    function depthOf(el) {
        for (let i = open.length - 1; i >= 0; i--) {
            if (open[i].list.contains(el)) {
                return i + 1;
            }
        }
        return 0;
    }

    // Closes the menus at `depth` and deeper. With `refocus`, focus that was in
    // one of them goes back to the button that opened the outermost of them,
    // so the keyboard is not left on nothing.
    function closeFrom(depth, refocus) {
        const closing = open.splice(depth);
        const hadFocus = closing.some((m) => m.list.contains(document.activeElement));
        closing.forEach((m) => {
            m.list.remove();
            m.button.setAttribute('aria-expanded', 'false');
            m.button.removeAttribute('aria-controls');
        });
        refocus && hadFocus && closing[0].button.focus();
    }

    // Menus are position: fixed, at the button that opened them: anything
    // inside an element that clips (the row, a menu that scrolls) would be cut
    // off there. A submenu opens on the side its parent menu opened to (the
    // right, to begin with), and turns where the window ends: going back the
    // other way would lay it over the menus it came from. Returns the side.
    function place(list, button, depth) {
        const r = button.getBoundingClientRect();
        const width = document.documentElement.clientWidth;
        const height = document.documentElement.clientHeight;
        const m = list.getBoundingClientRect();
        let left, top, side = 'right';
        if (depth === 0) {
            left = Math.min(r.left, width - 4 - m.width);
            top = r.bottom + 2;
        } else {
            side = open[depth - 1].side;
            const toRight = r.right, toLeft = r.left - m.width;
            if (side === 'right' && toRight + m.width > width - 4) {
                side = 'left';
            } else if (side === 'left' && toLeft < 4) {
                side = 'right';
            }
            left = side === 'right' ? toRight : toLeft;
            top = r.top - 5;
        }
        top = Math.min(top, height - 4 - m.height);
        list.style.left = `${Math.max(4, left)}px`;
        list.style.top = `${Math.max(4, top)}px`;
        return side;
    }

    function openMenu(button, depth, keyboard) {
        closeFrom(depth);
        const list = document.createElement('ul');
        list.className = 'sk_menu';
        list.id = `sk_menu_${++menuSeq}`;
        const nodes = childrenOf(button);
        if (!nodes.length) {
            const li = document.createElement('li');
            li.className = 'sk_menu_empty';
            li.textContent = '(empty)';
            list.appendChild(li);
        }
        nodes.forEach((node) => {
            const li = document.createElement('li');
            const el = entry(node, true);
            nodeOf.set(el, node);
            li.appendChild(el);
            list.appendChild(li);
        });
        // a submenu stays where its folder was: when the menu scrolls, it goes
        list.addEventListener('scroll', () => closeFrom(depth + 1));
        button.parentElement.appendChild(list);
        button.setAttribute('aria-expanded', 'true');
        button.setAttribute('aria-controls', list.id);
        const menu = {button, list, side: 'right'};
        open.push(menu);
        menu.side = place(list, button, depth);
        if (keyboard) {
            const first = list.querySelector('.sk_bm');
            first && first.focus();
        }
    }

    function toggle(button, keyboard) {
        const depth = depthOf(button);
        if (open[depth] && open[depth].button === button) {
            closeFrom(depth, keyboard);
        } else {
            openMenu(button, depth, keyboard);
        }
    }

    function closeAll() {
        clearTimeout(hoverTimer);
        closeFrom(0);
    }

    // What does not fit in the row goes to the "»" menu, from the first item
    // that crosses the row's end on: the row is cut at a whole item, never
    // through one.
    function fit() {
        const lis = Array.from(row.children);
        lis.forEach((li) => {
            li.hidden = false;
        });
        moreBox.hidden = true;
        overflow = [];
        const fits = () => {
            const end = row.getBoundingClientRect().right;
            return lis.findIndex((li) => li.getBoundingClientRect().right > end + 0.5);
        };
        if (!items.length || fits() === -1) {
            return;
        }
        moreBox.hidden = false;  // the row is narrower by the button
        const cut = Math.max(0, fits());
        lis.slice(cut).forEach((li) => {
            li.hidden = true;
        });
        overflow = items.slice(cut);
    }

    function render(tree) {
        closeAll();
        items = barItems(tree);
        const lis = items.map((node) => {
            const li = document.createElement('li');
            const el = entry(node, false);
            nodeOf.set(el, node);
            li.appendChild(el);
            return li;
        });
        if (!lis.length) {
            const note = document.createElement('li');
            note.className = 'sk_bar_note';
            note.textContent = 'Bookmarks you add to the bookmarks bar show up here.';
            lis.push(note);
        }
        row.replaceChildren(...lis);
        fit();
    }

    function refresh() {
        chrome.bookmarks.getTree((tree) => {
            if (chrome.runtime.lastError || !tree) {
                say && say('Could not read the bookmarks.');
                return;
            }
            render(tree);
        });
    }

    // --- events -----------------------------------------------------------
    nav.addEventListener('click', (e) => {
        const el = e.target.closest('.sk_bm');
        if (!el) {
            return;
        }
        if (el.tagName === 'BUTTON') {
            // Enter or Space: the keyboard is on the button, and goes into the menu
            toggle(el, e.isTrusted && e.detail === 0);
        } else if (el.getAttribute('aria-disabled') !== 'true') {
            // after the click is done with: links.js may still need the link in the page
            setTimeout(closeAll, 0);
        }
    });
    // pointerover, not mouseover: link hints send a mouseover just before their
    // click, which would open the folder's menu here for the click to close again.
    nav.addEventListener('pointerover', (e) => {
        const el = e.target.closest('.sk_bm');
        if (!el) {
            return;
        }
        const depth = depthOf(el);
        clearTimeout(hoverTimer);
        if (depth === 0) {
            // along the bar with a menu open, the menu follows the pointer, as on Chrome's bar
            if (open.length && el.tagName === 'BUTTON' && open[0].button !== el) {
                openMenu(el, 0, false);
            }
            return;
        }
        hoverTimer = setTimeout(() => {
            if (!el.isConnected) {
                return;
            }
            if (el.tagName !== 'BUTTON') {
                closeFrom(depth);
            } else if (!(open[depth] && open[depth].button === el)) {
                openMenu(el, depth, false);
            }
        }, HOVER_MS);
    });
    document.addEventListener('pointerdown', (e) => {
        open.length && !nav.contains(e.target) && closeAll();
    });
    document.addEventListener('focusin', (e) => {
        open.length && !nav.contains(e.target) && closeAll();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && open.length) {
            clearTimeout(hoverTimer);
            closeFrom(open.length - 1, true);
        }
    });
    window.addEventListener('blur', closeAll);
    let fitFrame = null;
    window.addEventListener('resize', () => {
        closeAll();
        cancelAnimationFrame(fitFrame);
        fitFrame = requestAnimationFrame(fit);
    });

    if (chrome.bookmarks) {
        let timer = null, importing = false;
        const later = () => {
            clearTimeout(timer);
            importing || (timer = setTimeout(refresh, REFRESH_MS));
        };
        ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered'].forEach((name) => {
            chrome.bookmarks[name] && chrome.bookmarks[name].addListener(later);
        });
        // an import fires an event per bookmark: draw once, at the end
        chrome.bookmarks.onImportBegan && chrome.bookmarks.onImportBegan.addListener(() => {
            importing = true;
        });
        chrome.bookmarks.onImportEnded && chrome.bookmarks.onImportEnded.addListener(() => {
            importing = false;
            later();
        });
    }

    return {refresh, render, fit, closeAll};
}
