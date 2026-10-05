// The New tab page section: there only where the build ships the page, the
// page's address from the running extension, Copy, the buttons that open the
// browser's pages, and the line that says whether the page is the new tab yet.
import { FLAGS_URL, STARTUP_URL, seenText } from '../../../src/content_scripts/options/newtab.js';
import { SEEN_KEY } from '../../../src/content_scripts/common/newTabPage.js';
import { boot } from './page.js';

jest.mock('../../../src/content_scripts/common/runtime.js', () => ({
    RUNTIME: jest.fn(),
    dispatchSKEvent: jest.fn(),
    runtime: { conf: {} },
}));

// boot() makes the extension's address chrome-extension://ext/, not the release's ID
const ADDRESS = 'chrome-extension://ext/pages/newtab.html';
const $ = (id) => document.getElementById(id);

let consoleError;
beforeEach(() => {
    window.localStorage.clear();
    consoleError = jest.spyOn(console, 'error');
});
afterEach(() => {
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    delete navigator.clipboard;
});

function stubClipboard(writeText) {
    Object.defineProperty(navigator, 'clipboard', {value: {writeText: jest.fn(writeText)}, configurable: true});
    return navigator.clipboard.writeText;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('new tab page section', () => {
    test('comes after Keys in Chrome, and options.html#newtab opens it', () => {
        boot({hash: '#newtab'});
        const links = Array.from(document.querySelectorAll('nav[aria-label=Settings] a')).map((a) => a.getAttribute('href'));
        expect(links.slice(0, 3)).toEqual(['#appearance', '#keys', '#newtab']);
        expect($('settings-newtab').hidden).toBe(false);
        expect($('settingsHeading-newtab').textContent).toBe('New tab page');
    });

    test.each(['Firefox', 'Safari', 'Safari-iOS'])('is left out in %s, whose build has no new tab page', (browser) => {
        boot({hash: '#newtab', browser});
        expect(document.querySelector('a[href="#newtab"]')).toBeNull();
        expect($('settings-newtab')).toBeNull();
        expect($('newTabAddress')).toBeNull();
        // the page lands where it would without the hash
        expect(window.location.hash).toBe('#appearance');
    });

    test('shows the address the running extension gives the page, in both sets of steps', () => {
        boot({hash: '#newtab'});
        expect($('newTabAddress').textContent).toBe(ADDRESS);
        expect($('newTabStartupAddress').textContent).toBe(ADDRESS);
    });

    test('Copy puts the address on the clipboard and says so', async () => {
        const {deps} = boot({hash: '#newtab'});
        const writeText = stubClipboard(() => Promise.resolve());
        $('newTabAddressCopy').click();
        await settle();
        expect(writeText).toHaveBeenCalledWith(ADDRESS);
        expect(deps.showBanner).toHaveBeenLastCalledWith('Copied', 1500);
        $('newTabStartupAddressCopy').click();
        await settle();
        expect(writeText).toHaveBeenCalledTimes(2);
        expect(writeText).toHaveBeenLastCalledWith(ADDRESS);
    });

    test('says when the clipboard refuses', async () => {
        const {deps} = boot({hash: '#newtab'});
        stubClipboard(() => Promise.reject(new Error('Document is not focused.')));
        $('newTabAddressCopy').click();
        await settle();
        expect(deps.showBanner).toHaveBeenLastCalledWith('Could not copy: Document is not focused.', 1500);
    });

    test.each([
        ['newTabFlags', FLAGS_URL, 'chrome://flags/#custom-ntp'],
        ['newTabStartup', STARTUP_URL, 'chrome://settings/onStartup'],
        ['newTabPreview', null, `${ADDRESS}?focus`],
    ])('%s opens %s through chrome.tabs', (id, constant, url) => {
        boot({hash: '#newtab'});
        constant && expect(constant).toBe(url);
        $(id).click();
        expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
        expect(chrome.tabs.create).toHaveBeenCalledWith({url});
    });

    test('says the page is not the new tab yet, then that it is once a new tab opens as it', () => {
        boot({hash: '#newtab'});
        const status = $('newTabStatus');
        expect(status.textContent).toBe(seenText(null));
        expect(status.textContent).toMatch(/^Not detected as your new tab yet/);
        expect(status.classList.contains('sk-ok')).toBe(false);

        // what the page does in another tab (common/newTabPage.js), and the event this tab gets
        const seen = Date.UTC(2026, 9, 5, 8, 42);
        window.localStorage.setItem(SEEN_KEY, String(seen));
        window.dispatchEvent(new StorageEvent('storage', {key: SEEN_KEY}));
        expect(status.textContent).toBe(seenText(seen));
        expect(status.textContent).toMatch(/^Your new tab is this page: it last opened as one on .*2026/);
        expect(status.classList.contains('sk-ok')).toBe(true);
    });

    test('reads the note again when shown, and leaves other keys alone', () => {
        boot({hash: '#keys'});
        const status = $('newTabStatus');
        window.localStorage.setItem(SEEN_KEY, '1700000000000');
        window.dispatchEvent(new StorageEvent('storage', {key: 'surfingkeys.settings.section'}));
        expect(status.classList.contains('sk-ok')).toBe(false);
        window.location.hash = 'newtab';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        expect(status.classList.contains('sk-ok')).toBe(true);
    });

    test('opening the section writes nothing and sends nothing', () => {
        const {sent} = boot({hash: '#newtab'});
        // a localData with an object stores it; the shell's own read names keys in an array
        const writes = sent.filter((m) => m.action === 'updateSettings'
            || (m.action === 'localData' && typeof m.args.data === 'object' && !Array.isArray(m.args.data)));
        expect(writes).toEqual([]);
        expect(chrome.tabs.create).not.toHaveBeenCalled();
        expect(window.localStorage.getItem(SEEN_KEY)).toBeNull();
    });

    test('"Find a setting" finds the startup steps and the incognito note by their words', () => {
        boot({hash: '#newtab'});
        const filter = $('settingsFilter');
        filter.value = 'incognito';
        filter.dispatchEvent(new Event('input'));
        expect($('newTabNotes').classList.contains('sk-filtered-out')).toBe(false);
        expect($('newTabOnStartup').classList.contains('sk-filtered-out')).toBe(true);
        filter.value = 'continue where';
        filter.dispatchEvent(new Event('input'));
        expect($('newTabOnStartup').classList.contains('sk-filtered-out')).toBe(false);
        expect($('newTabHelium').classList.contains('sk-filtered-out')).toBe(true);
    });
});
