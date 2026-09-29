// The Sites section: origin normalisation, and that every change reads storage
// right before writing it, and that the lists follow storage.
import { ALL_SITES, blockedOrigins, normalizeOrigin, patternSettings } from '../../../src/content_scripts/options/sites.js';
import { boot, loadSettings, writes } from './page.js';

jest.mock('../../../src/content_scripts/common/runtime.js', () => ({
    RUNTIME: jest.fn(),
    dispatchSKEvent: jest.fn(),
    runtime: { conf: {} },
}));

describe('normalizeOrigin', () => {
    test.each([
        ['example.com', 'https://example.com'],
        ['  Example.COM  ', 'https://example.com'],
        ['example.com/some/path?q=1#x', 'https://example.com'],
        ['https://example.com/', 'https://example.com'],
        ['http://example.com', 'http://example.com'],
        ['HTTP://Example.com:80/a', 'http://example.com'],
        ['https://example.com:443', 'https://example.com'],
        ['example.com:8443', 'https://example.com:8443'],
        ['localhost:3000', 'https://localhost:3000'],
        ['http://localhost:3000/app', 'http://localhost:3000'],
        ['127.0.0.1', 'https://127.0.0.1'],
        ['[::1]:8080', 'https://[::1]:8080'],
        ['user:pw@example.com', 'https://example.com'],
        ['bücher.de', 'https://xn--bcher-kva.de'],
        ['a.test', 'https://a.test'],
    ])('%p is %p', (input, origin) => {
        expect(normalizeOrigin(input)).toBe(origin);
    });

    test.each([
        '', '   ', undefined, null, 'not a site', 'exa mple.com', '*.example.com', 'https://*.example.com',
        'file:///home/me/a.html', 'ftp://example.com', 'chrome://extensions', 'javascript:alert(1)', 'https://', '//',
    ])('%p names no site', (input) => {
        expect(normalizeOrigin(input)).toBeNull();
    });
});

test('blockedOrigins lists the sites turned off, by host, without the all-sites entry', () => {
    expect(blockedOrigins({'https://b.test': 1, [ALL_SITES]: 1, 'http://a.test': 1, 'https://a.test': 1, 'https://gone.test': 0}))
        .toEqual(['http://a.test', 'https://a.test', 'https://b.test']);
    expect(blockedOrigins(undefined)).toEqual([]);
});

test('patternSettings names the pattern settings an active script sets', () => {
    expect(patternSettings({showAdvanced: true, snippets: 'settings.blocklistPattern = /a/;\nsettings.lurkingPattern = /b/;'}))
        .toEqual(['blocklistPattern', 'lurkingPattern']);
    expect(patternSettings({showAdvanced: false, snippets: 'settings.blocklistPattern = /a/;'})).toEqual([]);
    expect(patternSettings({showAdvanced: true, snippets: 'settings.myblocklistPatterns = 1;'})).toEqual([]);
    expect(patternSettings(null)).toEqual([]);
});

function listed(id = 'blocklistSites') {
    return Array.from(document.querySelectorAll(`#${id} .sk-sitename`)).map((e) => e.title);
}
function submit(inputId, value) {
    const input = document.getElementById(inputId);
    input.value = value;
    input.form.dispatchEvent(new Event('submit', {cancelable: true}));
}

let consoleError;
beforeEach(() => {
    consoleError = jest.spyOn(console, 'error');
});
afterEach(() => {
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
});

describe('sites section', () => {
    test('lists the stored sites and the all-sites switch', () => {
        boot({hash: '#sites'});
        loadSettings({blocklist: {'https://b.test': 1, 'https://a.test': 1}, mouseSelectToQuery: ['https://m.test']});
        expect(listed()).toEqual(['https://a.test', 'https://b.test']);
        expect(listed('mouseQuerySites')).toEqual(['https://m.test']);
        expect(document.getElementById('sitesAllOn').checked).toBe(true);
        expect(document.getElementById('blocklistSitesEmpty').hidden).toBe(true);
        const remove = document.querySelector('#blocklistSites button');
        expect(remove.getAttribute('aria-label')).toBe('Turn Surfingkeys back on for a.test');
    });

    test('follows a change stored elsewhere (Alt-s in another tab), with no reload', () => {
        const {store, storageListeners} = boot({hash: '#sites'});
        loadSettings({blocklist: {}});
        expect(document.getElementById('blocklistSitesEmpty').hidden).toBe(false);
        store({blocklist: {'https://a.test': 1}});
        expect(listed()).toEqual(['https://a.test']);
        store({blocklist: {[ALL_SITES]: 1, 'https://a.test': 1}});
        expect(document.getElementById('sitesAllOn').checked).toBe(false);
        // a reset removes the key
        storageListeners.forEach((fn) => fn({blocklist: {oldValue: {'https://a.test': 1}}}, 'local'));
        expect(listed()).toEqual([]);
        expect(document.getElementById('sitesAllOn').checked).toBe(true);
    });

    test('Remove writes back what is stored now, not what the page loaded', () => {
        const {sent, local} = boot({hash: '#sites'});
        loadSettings({blocklist: {'https://a.test': 1}});
        // Alt-s in another tab, whose onChanged has not reached this page yet
        local.blocklist = {'https://a.test': 1, 'https://new.test': 1};
        document.querySelector('#blocklistSites button[data-origin="https://a.test"]').click();
        expect(writes(sent)).toEqual([{blocklist: {'https://new.test': 1}}]);
        expect(listed()).toEqual(['https://new.test']);
        const reads = sent.filter((m) => m.action === 'getSettings').map((m) => m.args.key);
        expect(reads).toEqual(['blocklist']);
    });

    test('Add normalises to an origin, and refuses what names no site', () => {
        const {sent} = boot({hash: '#sites', stored: {blocklist: {'https://a.test': 1}}});
        loadSettings({blocklist: {'https://a.test': 1}});
        submit('blocklistAdd', 'B.test/path');
        expect(writes(sent)).toEqual([{blocklist: {'https://a.test': 1, 'https://b.test': 1}}]);
        expect(document.getElementById('blocklistAdd').value).toBe('');

        submit('blocklistAdd', 'not a site');
        expect(writes(sent)).toHaveLength(1);
        const error = document.getElementById('blocklistAddError');
        expect(error.hidden).toBe(false);
        expect(document.getElementById('blocklistAdd').getAttribute('aria-invalid')).toBe('true');
        document.getElementById('blocklistAdd').dispatchEvent(new Event('input'));
        expect(error.hidden).toBe(true);

        // already there: nothing to write
        submit('blocklistAdd', 'https://a.test/');
        expect(writes(sent)).toHaveLength(1);
    });

    test('the all-sites switch writes .* and keeps the sites listed', () => {
        const {sent} = boot({hash: '#sites', stored: {blocklist: {'https://a.test': 1}}});
        loadSettings({blocklist: {'https://a.test': 1}});
        const all = document.getElementById('sitesAllOn');
        all.checked = false;
        all.dispatchEvent(new Event('change'));
        all.checked = true;
        all.dispatchEvent(new Event('change'));
        expect(writes(sent)).toEqual([{blocklist: {'https://a.test': 1, [ALL_SITES]: 1}}, {blocklist: {'https://a.test': 1}}]);
        expect(all.disabled).toBe(false);
    });

    test('the mouse-select list adds and removes by origin', () => {
        const {sent} = boot({hash: '#sites'});
        loadSettings({});
        expect(document.getElementById('mouseQuerySitesEmpty').hidden).toBe(false);
        submit('mouseQueryAdd', 'm.test');
        submit('mouseQueryAdd', 'n.test');
        document.querySelector('#mouseQuerySites button[data-origin="https://m.test"]').click();
        expect(writes(sent)).toEqual([
            {mouseSelectToQuery: ['https://m.test']},
            {mouseSelectToQuery: ['https://m.test', 'https://n.test']},
            {mouseSelectToQuery: ['https://n.test']},
        ]);
        expect(listed('mouseQuerySites')).toEqual(['https://n.test']);
    });

    test('notes pattern settings in an active script', () => {
        boot({hash: '#sites'});
        loadSettings({showAdvanced: true, snippets: 'settings.lurkingPattern = /x/;'});
        const note = document.getElementById('sitesPatternNote');
        expect(note.hidden).toBe(false);
        expect(note.textContent).toContain('lurkingPattern');
    });

    test('opening the page writes nothing', () => {
        const {sent} = boot({hash: '#sites'});
        loadSettings({blocklist: {'https://a.test': 1}, mouseSelectToQuery: ['https://m.test']});
        expect(writes(sent)).toEqual([]);
    });
});
