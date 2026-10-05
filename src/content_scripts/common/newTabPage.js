// Surfingkeys' new tab page (pages/newtab.html, newtab/page.js) as the pages that
// lead to it see it: where it is, which builds ship it, and the note it leaves
// when it opens as the browser's new tab, which Settings -> New tab page
// (options/newtab.js) reads. Light on purpose: the toolbar popup imports it.
import { getBrowserName } from './browserName.js';

export const NEW_TAB_PATH = 'pages/newtab.html';
// Settings -> New tab page, linked from the other extension pages in pages/
export const SETUP_HREF = 'options.html#newtab';

// Only the Chromium build ships the page (config/webpack.config.js).
export function shipsNewTabPage() {
    return getBrowserName() === 'Chrome';
}

// The quick guide's markdown (start.html #quickIntroSource), less its lines that
// link to the page's setup where the build has no page.
export function guideForBuild(markdown, ships) {
    return ships ? markdown : markdown.split('\n').filter((line) => line.indexOf(`(${SETUP_HREF})`) === -1).join('\n');
}

// The query parameter the page moves itself to (newtab/page.js startNewTab);
// arriving with it, the page stays.
export const FOCUS_MARKER = 'focus';

export function hasFocusMarker(search) {
    return (search || '').replace(/^\?/, '').split('&').some((p) => p.split('=')[0] === FOCUS_MARKER);
}

// `href` with the marker added to its query, the rest of it kept
export function focusUrl(href) {
    const m = href.match(/^([^?#]*)(?:\?([^#]*))?(#.*)?$/);
    return `${m[1]}?${m[2] ? `${m[2]}&` : ''}${FOCUS_MARKER}${m[3] || ''}`;
}

// When the page last opened as the browser's new tab, in ms. It stays in the
// localStorage of the extension's origin, which the settings page shares, and
// out of chrome.storage.local, where the settings live: written there on every
// new tab, it would reach each open settings page as a setting (options/shell.js
// copies every local change into its settings) and go with a reset.
export const SEEN_KEY = 'sk_newtab_seen';
// the longest the page holds up its move to the marker for the browser's answer
export const SEEN_WAIT_MS = 50;

/*
 * The address a tab has while the browser shows this page as its new tab. The
 * browser rewrites chrome://newtab to the page, for Helium's Custom New Tab Page
 * flag as for an extension's chrome_url_overrides, and the tab keeps the address
 * it was asked for (the navigation entry's virtual URL): chrome.tabs reports
 * chrome://newtab/, never the page's own address. The page opened any other way
 * (Preview, a bookmark, the startup page) reports its chrome-extension:// one.
 * Any scheme is taken, for a browser that names its own pages otherwise.
 */
export function isBrowserNewTab(url) {
    return /^[a-z][a-z0-9+.-]*:\/\/newtab\/?$/i.test(url || '');
}

function pageStorage() {
    try {
        return window.localStorage;
    } catch (e) {
        return null;
    }
}

/*
 * Asks the browser what this tab's address is, notes the time when it is the
 * new tab's, then calls `done`: once, as soon as the answer is in, or after
 * SEEN_WAIT_MS without one. An answer arriving after that is still noted.
 */
export function noteIfNewTab(done) {
    let waiting = true;
    const finish = () => {
        if (waiting) {
            waiting = false;
            clearTimeout(timer);
            done();
        }
    };
    const timer = setTimeout(finish, SEEN_WAIT_MS);
    try {
        chrome.tabs.getCurrent((tab) => {
            if (!chrome.runtime.lastError && tab && isBrowserNewTab(tab.url)) {
                try {
                    pageStorage().setItem(SEEN_KEY, String(Date.now()));
                } catch (e) {
                    // storage blocked: the settings page just cannot say
                }
            }
            finish();
        });
    } catch (e) {
        finish();  // no chrome.tabs to ask
    }
}

// When the page last opened as the browser's new tab, or null when that was never noted.
export function lastSeenAsNewTab() {
    try {
        const t = Number(pageStorage().getItem(SEEN_KEY));
        return t > 0 ? t : null;
    } catch (e) {
        return null;
    }
}
