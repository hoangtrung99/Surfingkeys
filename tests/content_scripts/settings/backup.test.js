// The Backup section: the export download, and an import through its preview and
// trust questions to the writes the background gets.
import { boot, loadSettings, writes } from './page.js';

jest.mock('../../../src/content_scripts/common/runtime.js', () => ({
    RUNTIME: jest.fn(),
    dispatchSKEvent: jest.fn(),
    runtime: { conf: {} },
}));

const STORED = {
    basicMappings: {d: 'q'},
    blocklist: {'https://a.test': 1},
    paletteTheme: 'nord',
    marks: {m: {url: 'https://devnotes.dev/m'}},
    findHistory: ['secret search'],
    _llmProviderConfig: {bedrock: {accessKeyId: 'AKIA'}},
    savedAt: 1,
};

let consoleError, clicked, blobs;
beforeEach(() => {
    consoleError = jest.spyOn(console, 'error');
    clicked = [];
    blobs = [];
    // jsdom has no object URLs, and would try to navigate for a download
    URL.createObjectURL = jest.fn((blob) => {
        blobs.push(blob);
        return `blob:settings/${blobs.length}`;
    });
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function() {
        clicked.push({href: this.getAttribute('href'), download: this.getAttribute('download'), connected: this.isConnected});
    });
});
afterEach(() => {
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    HTMLAnchorElement.prototype.click.mockRestore();
});

function readBlob(blob) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(JSON.parse(reader.result));
        reader.readAsText(blob);
    });
}

// Let the promise chain of the import (file.text, the dialogs) run.
async function settle() {
    for (let i = 0; i < 5; i++) {
        await Promise.resolve();
    }
}

async function pick(text, name = 'backup.json') {
    const input = document.getElementById('backupFile');
    Object.defineProperty(input, 'files', {value: [{name, size: text.length, text: () => Promise.resolve(text)}], configurable: true});
    input.dispatchEvent(new Event('change'));
    await settle();
}

async function answer(id) {
    document.getElementById(id).click();
    await settle();
}

describe('export', () => {
    test('downloads the versioned file, with no credentials, histories or (by default) marks', async () => {
        const {sent} = boot({hash: '#backup', stored: STORED});
        loadSettings({});
        document.getElementById('backupExport').click();
        expect(sent.filter((m) => m.action === 'getSettings').map((m) => m.args.key)).toEqual(['RAW']);
        expect(clicked).toHaveLength(1);
        expect(clicked[0].href).toBe('blob:settings/1');
        expect(clicked[0].download).toMatch(/^surfingkeys-settings-\d{4}-\d\d-\d\d\.json$/);
        expect(clicked[0].connected).toBe(true);
        expect(document.querySelector('a[download]')).toBeNull();
        expect(blobs[0].type).toBe('application/json');
        const file = await readBlob(blobs[0]);
        expect(file.format).toBe('surfingkeys-settings');
        expect(file.version).toBe(1);
        expect(file.extensionVersion).toBe('9.9.9');
        expect(Date.parse(file.exportedAt)).not.toBeNaN();
        expect(file.settings).toEqual({basicMappings: {d: 'q'}, blocklist: {'https://a.test': 1}, paletteTheme: 'nord'});
        expect(writes(sent)).toEqual([]);
    });

    test('adds marks and sessions when asked', async () => {
        boot({hash: '#backup', stored: STORED});
        loadSettings({});
        document.getElementById('backupIncludeData').checked = true;
        document.getElementById('backupExport').click();
        const file = await readBlob(blobs[0]);
        expect(file.settings.marks).toEqual(STORED.marks);
        expect(file.settings).not.toHaveProperty('findHistory');
    });

    test('warns when the script looks like it holds a secret', () => {
        boot({hash: '#backup'});
        loadSettings({snippets: "const service = {apiKey: 'sk-1'};"});
        expect(document.getElementById('backupSecretNote').hidden).toBe(false);
        loadSettings({snippets: "api.map('gt', 'T');"});
        expect(document.getElementById('backupSecretNote').hidden).toBe(true);
    });
});

describe('import', () => {
    const FILE = {format: 'surfingkeys-settings', version: 1, exportedAt: '2026-09-29T08:00:00.000Z', extensionVersion: '1.2.3',
        settings: {basicMappings: {d: 'q'}, blocklist: {}, paletteTheme: 'latte'}};

    test('previews what changes, and stores nothing until confirmed', async () => {
        const {sent} = boot({hash: '#backup', stored: {blocklist: {'https://a.test': 1}, marks: {m: {}}}});
        loadSettings({isMV3: true, isUserScriptsAvailable: true});
        await pick(JSON.stringify(FILE));
        const dialog = document.getElementById('importDialog');
        expect(dialog).not.toBeNull();
        const groups = Array.from(dialog.querySelectorAll('.sk-import-group')).map((g) => ({
            title: g.querySelector('h4').textContent,
            keys: Array.from(g.querySelectorAll('li')).map((li) => li.dataset.key),
        }));
        expect(groups).toEqual([
            {title: 'New', keys: ['basicMappings', 'paletteTheme']},
            {title: 'Replaced', keys: ['blocklist']},
            {title: 'Not in the file · kept as they are', keys: ['marks']},
        ]);
        expect(dialog.textContent).toContain('backup.json');
        expect(dialog.textContent).toContain('from Surfingkeys 1.2.3');
        expect(document.activeElement.textContent).toBe('Cancel');
        document.activeElement.click();
        await settle();
        expect(document.getElementById('importDialog')).toBeNull();
        expect(writes(sent)).toEqual([]);
        // localData writes only with an object; the page reads the theme with a key array
        expect(sent.filter((m) => m.action === 'localData' && m.args.data.constructor === Object)).toEqual([]);
    });

    test('stores the settings in one write, then the theme, then re-reads them', async () => {
        const {sent, local, deps} = boot({hash: '#backup'});
        loadSettings({isMV3: true, isUserScriptsAvailable: true});
        await pick(JSON.stringify(FILE));
        await answer('importConfirm');
        expect(writes(sent)).toEqual([{basicMappings: {d: 'q'}, blocklist: {}}]);
        expect(local.paletteTheme).toBe('latte');
        const order = sent.map((m) => m.action);
        expect(order.slice(order.indexOf('updateSettings'))).toEqual(['updateSettings', 'localData', 'getSettings']);
        expect(deps.showBanner).toHaveBeenLastCalledWith('Settings imported', 2000);
    });

    test('asks before trusting a script, and can leave it out', async () => {
        const withScript = {format: 'surfingkeys-settings', version: 1,
            settings: {snippets: 'a();\nb();', showAdvanced: true, localPath: 'https://gist.test/s.js', basicMappings: {d: 'q'}}};
        const {sent} = boot({hash: '#backup'});
        loadSettings({isMV3: true, isUserScriptsAvailable: true});
        await pick(JSON.stringify(withScript));
        await answer('importConfirm');
        const trust = document.getElementById('importTrustDialog');
        expect(trust.textContent).toContain('a settings script (2 lines)');
        expect(trust.textContent).toContain('https://gist.test/s.js');
        expect(document.activeElement.textContent).toBe('Cancel');
        expect(writes(sent)).toEqual([]);
        await answer('importWithoutScript');
        expect(writes(sent)).toEqual([{basicMappings: {d: 'q'}}]);

        await pick(JSON.stringify(withScript));
        await answer('importConfirm');
        await answer('importWithScript');
        expect(writes(sent)[1]).toEqual(withScript.settings);
    });

    test('holds advanced mode back while user scripts are off, and says so', async () => {
        const {sent, deps} = boot({hash: '#backup'});
        loadSettings({isMV3: true, isUserScriptsAvailable: false});
        await pick(JSON.stringify({snippets: 'a();', showAdvanced: true}), 'yj.json');
        expect(document.getElementById('importPreview').textContent).toContain('copied with yj');
        await answer('importConfirm');
        await answer('importWithScript');
        expect(writes(sent)).toEqual([{snippets: 'a();'}]);
        expect(deps.showBanner.mock.calls.pop()[0]).toMatch(/Advanced mode stays off until user scripts are allowed/);
    });

    test('shows what the background refused', async () => {
        const {deps} = boot({hash: '#backup', reply: {updateSettings: () => ({error: 'Nope.'})}});
        loadSettings({});
        await pick(JSON.stringify(FILE));
        await answer('importConfirm');
        expect(deps.showBanner).toHaveBeenLastCalledWith('Nope.', 6000);
    });

    test('a refused import stores no theme either', async () => {
        const {sent, local} = boot({hash: '#backup', stored: {paletteTheme: 'nord'}, reply: {updateSettings: () => ({error: 'Nope.'})}});
        loadSettings({});
        await pick(JSON.stringify(FILE));
        await answer('importConfirm');
        expect(local.paletteTheme).toBe('nord');
        expect(sent.filter((m) => m.action === 'localData' && m.args.data.constructor === Object)).toEqual([]);
    });

    test('says an imported proxy applies at once, and applies it from what is stored', async () => {
        const proxy = {proxyMode: 'byhost', proxy: ['PROXY p.test:1'], autoproxy_hosts: [['a.test']]};
        const {sent, deps} = boot({hash: '#backup', stored: {autoproxy_hosts: [['old.test']]}, reply: {updateProxy: () => ({})}});
        loadSettings({});
        await pick(JSON.stringify({format: 'surfingkeys-settings', version: 1, settings: proxy}));
        expect(document.getElementById('importProxyNote').textContent).toContain('mode “byhost”');
        await answer('importConfirm');
        expect(writes(sent)).toEqual([proxy]);
        expect(sent.filter((m) => m.action === 'updateProxy').map((m) => m.args))
            .toEqual([{operation: 'set', mode: 'byhost', proxy: ['PROXY p.test:1'], host: [['a.test']]}]);
        expect(deps.showBanner).toHaveBeenLastCalledWith('Settings imported', 2000);
    });

    test('has no proxy note or proxy change for a file without one', async () => {
        const {sent} = boot({hash: '#backup'});
        loadSettings({});
        await pick(JSON.stringify(FILE));
        expect(document.getElementById('importProxyNote')).toBeNull();
        await answer('importConfirm');
        expect(sent.filter((m) => m.action === 'updateProxy')).toEqual([]);
    });

    test('refuses a broken file with a readable error, and opens nothing', async () => {
        const {sent} = boot({hash: '#backup'});
        loadSettings({});
        await pick('{not json');
        const error = document.getElementById('backupImportError');
        expect(error.hidden).toBe(false);
        expect(error.textContent).toMatch(/not JSON/);
        expect(document.querySelector('dialog[open]')).toBeNull();
        // a new pick clears it
        document.getElementById('backupFile').click = jest.fn();
        document.getElementById('backupImport').click();
        expect(error.hidden).toBe(true);
        expect(writes(sent)).toEqual([]);
    });

    test('refuses a file too large to be settings without reading it', async () => {
        boot({hash: '#backup'});
        loadSettings({});
        const input = document.getElementById('backupFile');
        const text = jest.fn();
        Object.defineProperty(input, 'files', {value: [{name: 'big.json', size: 6 * 1024 * 1024, text}]});
        input.dispatchEvent(new Event('change'));
        expect(text).not.toHaveBeenCalled();
        expect(document.getElementById('backupImportError').hidden).toBe(false);
    });
});
