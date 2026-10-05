// New tab page (Chromium builds, the only ones that ship pages/newtab.html):
// what the page gives, the steps that make it Helium's new tab through its
// Custom New Tab Page flag, the steps that open it when the browser starts, and
// whether it has opened as the new tab yet. Surfingkeys does not take over the
// new tab itself (no chrome_url_overrides): the user turns the page on in the
// browser, so this section only leads the way there.
import { NEW_TAB_PATH, SEEN_KEY, focusUrl, lastSeenAsNewTab } from '../common/newTabPage.js';
import { h } from './dom.js';

// chrome:// pages open only through chrome.tabs, never from a link; Helium
// takes these addresses for its own helium:// pages
export const FLAGS_URL = 'chrome://flags/#custom-ntp';
export const STARTUP_URL = 'chrome://settings/onStartup';

// The status line for `seen`, when the page last opened as the new tab (ms), or null.
export function seenText(seen) {
    if (!seen) {
        return 'Not detected as your new tab yet. Once it is set up, open a new tab and this line changes.';
    }
    const when = new Date(seen).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'});
    return `Your new tab is this page: it last opened as one on ${when}.`;
}

export default {
    id: 'newtab',
    title: 'New tab page',
    keywords: 'new tab newtab ntp start page startup homepage bookmarks bar top sites helium flag',
    available(ctx) {
        return ctx.browserName === 'Chrome';
    },
    create(ctx, root) {
        // the running extension's own address: the store build's ID differs from the release's
        const address = chrome.runtime.getURL(NEW_TAB_PATH);
        const open = (url) => chrome.tabs.create({url});
        const button = (id, label, url) => h('button', {type: 'button', class: 'sk-btn', id, onclick: () => open(url)}, label);

        function addressRow(id) {
            const copy = h('button', {type: 'button', class: 'sk-btn', id: `${id}Copy`, 'aria-describedby': id}, 'Copy');
            copy.addEventListener('click', () => {
                navigator.clipboard.writeText(address).then(() => {
                    ctx.announce('Copied');
                }, (e) => {
                    ctx.announce(`Could not copy: ${e.message}`);
                });
            });
            return h('div', {class: 'sk-address'}, h('code', {id}, address), copy);
        }

        const status = h('p', {id: 'newTabStatus', class: 'sk-ntp-state'});
        root.append(
            h('div', {class: 'sk-ntp-intro'},
                h('p', {class: 'sk-lead'}, 'A start page with your bookmarks bar, its folders opening as dropdowns, and your top sites, in your theme. Surfingkeys’ keys work the moment it opens.'),
                button('newTabPreview', 'Preview the page', focusUrl(address))),
            h('div', {class: 'sk-card sk-row', id: 'newTabHelium', dataset: {keywords: 'helium flag flags custom new tab page ntp address url copy relaunch'}},
                h('h3', null, 'Every new tab, in Helium'),
                status,
                h('ol', {class: 'sk-steps sk-ntp-steps'},
                    h('li', null, 'Copy the page’s address:', addressRow('newTabAddress')),
                    h('li', null, 'Open the ', h('b', null, 'Custom New Tab Page'), ' flag and paste the address into its field.',
                        h('div', {class: 'sk-actions'}, button('newTabFlags', 'Open the flag', FLAGS_URL))),
                    h('li', null, h('b', null, 'Relaunch'), ' Helium with the button the flags page shows. No question about your new tab page is expected; should one come up, click nothing in it: its ',
                        h('b', null, 'Change it back'), ' turns off all of Surfingkeys.'))),
            h('div', {class: 'sk-note sk-ntp-note sk-row', id: 'newTabOtherBrowsers',dataset: {keywords: 'chrome edge brave vivaldi opera other chromium browsers bookmark'}},
                h('p', null, h('b', null, 'Other Chromium browsers'), ' (Chrome, Edge, Brave…) have no such flag. Open the page when the browser starts (below), or preview it and bookmark it.')),
            h('div', {class: 'sk-card sk-row', id: 'newTabOnStartup', dataset: {keywords: 'startup start launch on startup open a specific page set of pages session restore continue where you left off homepage'}},
                h('h3', null, 'When the browser starts'),
                h('p', {class: 'sk-muted'}, 'In Helium and every other Chromium browser. This and the new tab flag are separate: use either one, or both.'),
                h('ol', {class: 'sk-steps sk-ntp-steps'},
                    h('li', null, 'Open the browser’s ', h('b', null, 'On startup'), ' settings.',
                        h('div', {class: 'sk-actions'}, button('newTabStartup', 'Open startup settings', STARTUP_URL))),
                    h('li', null, 'Choose ', h('b', null, 'Open a specific page or set of pages'), ', click ', h('b', null, 'Add a new page'),
                        ' and paste the page’s address. The address ending in ', h('code', null, '?focus'), ' works as well.',
                        addressRow('newTabStartupAddress')),
                    h('li', null, 'Click ', h('b', null, 'Add'), '.')),
                h('p', {class: 'sk-muted'}, 'This takes the place of ', h('b', null, 'Continue where you left off'),
                    ', so the browser no longer reopens the last session’s tabs: press ', h('kbd', null, 'ZR'),
                    ' on the start page to restore the session Surfingkeys saved with ', h('kbd', null, 'ZZ'), '.')),
            h('div', {class: 'sk-card sk-row', id: 'newTabNotes', dataset: {keywords: 'incognito private address bar omnibox keyboard focus settings script mappings advanced'}},
                h('h3', null, 'Good to know'),
                h('ul', {class: 'sk-steps sk-ntp-steps'},
                    h('li', null, 'The keyboard starts in the page, not in the address bar, which shows the page’s ', h('code', null, 'chrome-extension://'), ' address. To type a URL, press ',
                        h('kbd', null, '⌘L'), ' or ', h('kbd', null, 'Ctrl+L'), ' first, or use ', h('kbd', null, 't'), '.'),
                    h('li', null, 'Helium uses the flag in incognito windows too, where the page loads only if Surfingkeys is allowed in incognito (its ',
                        h('b', null, 'Details'), ' in the extensions page, then ', h('b', null, 'Allow in Incognito'), ').'),
                    h('li', null, 'Your settings script (Advanced) does not run on Surfingkeys’ own pages, the new tab page included, so its mappings are missing there. Changes made in Keys work there as everywhere.'))));

        function showSeen() {
            const seen = lastSeenAsNewTab();
            status.classList.toggle('sk-ok', !!seen);
            status.textContent = seenText(seen);
        }
        // the page notes it as it opens in another tab (common/newTabPage.js)
        window.addEventListener('storage', (e) => {
            if (e.key === SEEN_KEY || e.key === null) {
                showSeen();
            }
        });
        window.addEventListener('focus', showSeen);
        showSeen();

        return {
            onShow: showSeen,
        };
    },
};
