// DOM helpers shared by the settings page sections.

/*
 * h('button', {class: 'sk-btn', type: 'button', onclick: fn}, 'Save')
 *
 * Children are appended as nodes or as TEXT, never parsed as markup, so a value
 * read from storage or from a search alias cannot add elements to the page.
 * `on…` keys become listeners, not attributes: MV3's CSP drops inline handlers.
 * null, undefined and false attributes are left out; true sets an empty one.
 */
export function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const name in attrs || {}) {
        const value = attrs[name];
        if (value === null || value === undefined || value === false) {
            continue;
        }
        if (name.startsWith('on') && typeof value === 'function') {
            el.addEventListener(name.slice(2), value);
        } else if (name === 'class') {
            el.className = value;
        } else if (name === 'dataset') {
            Object.assign(el.dataset, value);
        } else {
            el.setAttribute(name, value === true ? '' : value);
        }
    }
    append(el, children);
    return el;
}

function append(el, children) {
    children.forEach((child) => {
        if (Array.isArray(child)) {
            append(el, child);
        } else if (child !== null && child !== undefined && child !== false) {
            el.append(child instanceof Node ? child : String(child));
        }
    });
}

// Folded for matching: case and accents aside, so "rose" finds "Rosé Pine".
export function fold(text) {
    return String(text).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

// A <dialog> opened modally hands focus back to whatever opened it once closed,
// the way a native modal does, even when it was closed from code.
export function openDialog(dialog) {
    const opener = document.activeElement;
    dialog.addEventListener('close', () => {
        if (opener && opener.isConnected && typeof opener.focus === 'function') {
            opener.focus();
        }
    }, {once: true});
    if (typeof dialog.showModal === 'function') {
        dialog.showModal();
    } else {
        dialog.setAttribute('open', '');
    }
}

export function closeDialog(dialog) {
    if (typeof dialog.close === 'function') {
        dialog.close();
    } else {
        dialog.removeAttribute('open');
        dialog.dispatchEvent(new Event('close'));
    }
}
