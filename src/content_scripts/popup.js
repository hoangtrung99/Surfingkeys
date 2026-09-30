// The toolbar popup: Surfingkeys on or off for the site in the active tab and
// for all sites, the built-in themes, the browser shortcuts, and the way into
// the settings and help pages.
//
// Opening it changes no setting, only using a control does: other tools open
// this page just to message the background from an extension page.
import { RUNTIME } from './common/runtime.js';
import {
    IN_PAGE_PALETTE_KEY,
    createThemePicker,
    openShortcutSettings,
    pageTokens,
    pickTheme,
    readShortcuts,
    shortcutElement,
    themeName,
    watchTheme,
} from './common/quickControls.js';

const $ = (id) => document.getElementById(id);
const version = chrome.runtime.getManifest().version;
// The store build is named apart from upstream (see webpack.config.js)
document.querySelector('header h1').textContent = chrome.runtime.getManifest().name;
let blocklist = null;
let site = null;  // the web origin of the active tab, the key the blocklist uses for it
let localFile = false;
// which of the settings' blocklistPattern and lurkingPattern take the page, as
// its own Surfingkeys answers: they live in the settings snippet, never here
let patterns = {};

$('version').textContent = version;

function say(text) {
    $('status').textContent = text;
}

// The blocklist names web sites by origin: browser pages and extension pages
// have no Surfingkeys to switch, and local files no site to switch it for.
function webOrigin(url) {
    try {
        const u = new URL(url);
        return /^https?:$/.test(u.protocol) ? u.origin : null;
    } catch (e) {
        return null;
    }
}

function renderSwitches() {
    const offEverywhere = blocklist.hasOwnProperty('.*');
    const globalSwitch = $('globalSwitch'), siteSwitch = $('siteSwitch');
    globalSwitch.checked = !offEverywhere;
    globalSwitch.disabled = false;
    $('globalNote').textContent = offEverywhere ? 'Off everywhere' : '';
    if (site) {
        const offHere = blocklist.hasOwnProperty(site);
        // a pattern turns the page off whatever the site's entry says, so the
        // switch could change nothing the user would see
        const offByPattern = !!patterns.blocklist;
        $('siteLabel').textContent = new URL(site).host;
        siteSwitch.checked = !offEverywhere && !offHere && !offByPattern;
        // the site's own entry stays as it is while everything is off
        siteSwitch.disabled = offEverywhere || offByPattern;
        $('siteNote').textContent = offEverywhere ? 'Off, with all sites'
            : offByPattern ? 'Off here: blocklistPattern in your settings'
            : offHere ? 'Off on this site'
            : patterns.lurking ? 'Lurking here: lurkingPattern in your settings' : 'On';
    } else {
        $('siteLabel').textContent = 'This page';
        siteSwitch.checked = false;
        siteSwitch.disabled = true;
        // a local file has no origin of its own to turn off (URL.origin is "null")
        $('siteNote').textContent = localFile ? 'Local files have no site switch' : 'Surfingkeys does not run here';
    }
    // tabs with Surfingkeys in them set their own icon when the blocklist changes;
    // this is the icon of the others
    RUNTIME('setSurfingkeysIcon', {status: offEverywhere ? 'disabled' : 'enabled'});
}

function toggle(args, done) {
    RUNTIME('toggleBlocklist', args, (resp) => {
        if (resp.error) {
            say(resp.error);
        } else {
            blocklist = resp.blocklist;
            done();
        }
        renderSwitches();
    });
}

$('siteSwitch').addEventListener('change', () => {
    toggle({origin: site}, () => {
        say(`Surfingkeys ${blocklist.hasOwnProperty(site) ? 'off' : 'on'} for ${new URL(site).host}`);
    });
});
$('globalSwitch').addEventListener('change', () => {
    toggle({}, () => {
        say(`Surfingkeys ${blocklist.hasOwnProperty('.*') ? 'off' : 'on'} for all sites`);
    });
});

// lastFocusedWindow: the browser window the popup was opened over
chrome.tabs.query({active: true, lastFocusedWindow: true}, (tabs) => {
    const tab = tabs && tabs[0];
    const url = tab ? tab.url || tab.pendingUrl || '' : '';
    site = webOrigin(url);
    localFile = url.startsWith('file:');
    RUNTIME('getSettings', {key: 'blocklist'}, (resp) => {
        blocklist = (resp && resp.settings && resp.settings.blocklist) || {};
        renderSwitches();
    });
    // no answer (a page loaded before Surfingkeys, a tab still loading) leaves
    // the blocklist alone to decide
    site && chrome.tabs.sendMessage(tab.id, {subject: 'getPagePatterns'}, {frameId: 0}, (resp) => {
        if (chrome.runtime.lastError || !resp) {
            return;
        }
        patterns = resp;
        blocklist && renderSwitches();
    });
});

const picker = createThemePicker($('themes'), (id) => {
    pickTheme(id);
    showTheme(id);
    say(`Theme: ${themeName(id)}`);
});
function showTheme(id) {
    $('sk_page_tokens').textContent = pageTokens(id);
    $('themeName').textContent = themeName(id);
    picker.show(id);
    document.body.classList.add('sk_ready');
}
watchTheme(showTheme);
// never left blank, should storage not answer
setTimeout(() => document.body.classList.add('sk_ready'), 300);

function renderShortcuts(list) {
    $('shortcutsSection').hidden = !list.length;
    const dl = $('shortcuts');
    dl.textContent = '';
    list.forEach((s) => {
        const dt = document.createElement('dt');
        dt.textContent = s.label;
        const dd = document.createElement('dd');
        dd.appendChild(shortcutElement(s));
        dl.append(dt, dd);
    });
    const palette = list.find((s) => s.name === 'commandPalette');
    $('inPageNote').hidden = !palette || !!palette.shortcut;
    $('inPageNote').textContent = `${IN_PAGE_PALETTE_KEY} still opens the palette inside pages.`;
    $('changeShortcuts').textContent = list.some((s) => !s.shortcut) ? 'Assign missing shortcuts' : 'Change shortcuts';
}
readShortcuts(renderShortcuts);
$('changeShortcuts').addEventListener('click', () => {
    openShortcutSettings();
    window.close();
});

$('reportIssue').href = 'https://github.com/hoangtrung99/Surfingkeys/issues/new?body=' + encodeURIComponent(
    `## Error details\n\n\n\nSurfingkeys: ${version}\n\nBrowser: ${navigator.userAgent}\n\nURL: <The_URL_Where_You_Find_The_Issue>\n\n`
    + '## Context\n\n**Please replace this with a description of how you were using Surfingkeys.**');
