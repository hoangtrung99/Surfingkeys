// Surfingkeys' new tab page (pages/newtab.html): a bookmarks bar and the top
// sites, in the colours of the theme in use, with Surfingkeys running in it.
// The Chromium build only; the browser shows it as its new tab page through a
// flag the user sets (README: "New tab page"), not through the manifest.
import { pageTokens, watchTheme } from '../common/quickControls.js';
import { renderTopSites } from '../common/topSites.js';
import { createBookmarksBar } from './bookmarksBar.js';
import { installLinks } from './links.js';

export const FOCUS_MARKER = 'focus';
// the last tokens drawn, so the next tab paints in them before storage answers
export const TOKENS_CACHE_KEY = 'sk_newtab_tokens';

export function hasFocusMarker(search) {
    return (search || '').replace(/^\?/, '').split('&').some((p) => p.split('=')[0] === FOCUS_MARKER);
}

// `href` with the marker added to its query, the rest of it kept
export function focusUrl(href) {
    const m = href.match(/^([^?#]*)(?:\?([^#]*))?(#.*)?$/);
    return `${m[1]}?${m[2] ? `${m[2]}&` : ''}${FOCUS_MARKER}${m[3] || ''}`;
}

function readCache() {
    try {
        return localStorage.getItem(TOKENS_CACHE_KEY);
    } catch (e) {
        return null;  // storage blocked: the page waits for the theme instead
    }
}

function writeCache(css) {
    try {
        localStorage.setItem(TOKENS_CACHE_KEY, css);
    } catch (e) {
        // a convenience only
    }
}

function whenParsed(doc, fn) {
    if (doc.readyState === 'loading') {
        doc.addEventListener('DOMContentLoaded', fn, {once: true});
    } else {
        fn();
    }
}

// Runs from <head>, before the body is parsed. Returns false when it sends the
// tab on to the page with the marker instead.
export function startNewTab(loc, doc) {
    // This has to stay the page's first act: a location.replace to an address
    // that differs in path or QUERY. Chromium puts the keyboard in the address
    // bar on a new tab page (it goes by the chrome://newtab address the tab
    // still shows), so Surfingkeys' keys would do nothing until the user clicks
    // the page; a navigation the page starts itself moves the focus into the
    // page, and a fragment change is no navigation at all. replace, not
    // location.href: it takes the place of the new tab entry, so Back cannot
    // land on a page that sends the user forward again. Nothing else runs on the
    // page being left, Surfingkeys included: it would only hold up the one
    // replacing it.
    if (!hasFocusMarker(loc.search)) {
        loc.replace(focusUrl(loc.href));
        return false;
    }

    const root = doc.documentElement;
    const tokens = doc.getElementById('sk_page_tokens');
    const ready = () => root.classList.add('sk_ready');
    const cached = readCache();
    if (cached) {
        tokens.textContent = cached;
        ready();
    }
    watchTheme((id) => {
        const css = pageTokens(id);
        tokens.textContent = css;
        writeCache(css);
        ready();
    });
    // never left blank, should storage not answer
    setTimeout(ready, 300);

    whenParsed(doc, () => build(doc));
    return true;
}

function build(doc) {
    // a live region, so it stays in the page: hidden, it would not be read out
    const status = doc.getElementById('sk_status');
    let statusTimer = null;
    function say(text) {
        status.textContent = text;
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => {
            status.textContent = '';
        }, 6000);
    }

    installLinks(doc, say);

    const nav = doc.getElementById('sk_bar');
    if (chrome.bookmarks && chrome.bookmarks.getTree) {
        createBookmarksBar(nav, {say}).refresh();
    } else {
        nav.hidden = true;
    }

    const top = doc.getElementById('sk_top');
    if (chrome.topSites && chrome.topSites.get) {
        chrome.topSites.get((sites) => {
            sites = (!chrome.runtime.lastError && sites) || [];
            renderTopSites(top.querySelector('ul'), sites, 24);
            top.hidden = !sites.length;
        });
    }

    // Surfingkeys itself, as start.html has it, but only now that the page is
    // known to stay (see startNewTab) and its markup is all there for hints.
    const content = doc.createElement('script');
    content.src = '../content.js';
    doc.body.appendChild(content);
}
