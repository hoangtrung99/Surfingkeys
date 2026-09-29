// The Advanced section: lint through the shipped worker, Save with errors, the
// unsaved-edits state, Ctrl-s, the user-scripts card and its live re-check, and
// "Load settings from" with its last result.
import { lintCounts, lintSummary, scriptNotRunning } from '../../../src/content_scripts/options/advanced.js';
import { boot, loadSettings, writes } from './page.js';

jest.mock('../../../src/content_scripts/common/runtime.js', () => ({
    RUNTIME: jest.fn(),
    dispatchSKEvent: jest.fn(),
    runtime: { conf: {} },
}));

const ON = {isMV3: true, isUserScriptsAvailable: true, showAdvanced: true};
const ERROR = {row: 0, column: 30, type: 'error', text: "Unmatched '{'."};

test('lintCounts and lintSummary count errors and warnings', () => {
    const counts = lintCounts([ERROR, {type: 'warning'}, {type: 'warning'}, {type: 'info'}]);
    expect(counts).toEqual({errors: 1, warnings: 2});
    expect(lintSummary(counts)).toBe('1 error · 2 warnings');
    expect(lintSummary({errors: 0, warnings: 0})).toBe('');
    expect(lintCounts(undefined)).toEqual({errors: 0, warnings: 0});
});

test('scriptNotRunning: a stored script, MV3, user scripts off', () => {
    expect(scriptNotRunning({isMV3: true, isUserScriptsAvailable: false, snippets: 'x'})).toBe(true);
    expect(scriptNotRunning({isMV3: true, isUserScriptsAvailable: false, snippets: '  \n'})).toBe(false);
    expect(scriptNotRunning({isMV3: true, isUserScriptsAvailable: true, snippets: 'x'})).toBe(false);
    expect(scriptNotRunning({isMV3: false, snippets: 'x'})).toBe(false);
});

let consoleError;
beforeEach(() => {
    consoleError = jest.spyOn(console, 'error');
});
afterEach(() => {
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    jest.useRealTimers();
});

function save() {
    document.getElementById('save_button').click();
}
function status() {
    return document.getElementById('saveStatus').textContent;
}
function key(k, opts = {}) {
    const e = new KeyboardEvent('keydown', Object.assign({key: k, bubbles: true, cancelable: true}, opts));
    window.dispatchEvent(e);
    return e;
}

describe('the editor', () => {
    test('lints with the worker webpack ships, loaded by URL (the CSP refuses blob: workers)', () => {
        boot({hash: '#advanced'});
        loadSettings(ON);
        expect(ace.config.set).toHaveBeenCalledWith('loadWorkerFromBlob', false);
        expect(ace.config.setModuleUrl).toHaveBeenCalledWith('ace/mode/javascript_worker', 'chrome-extension://ext/pages/worker-javascript.js');
    });

    test('shows the error count, and asks before saving a script with errors', async () => {
        const {sent, made} = boot({hash: '#advanced'});
        loadSettings(Object.assign({snippets: '// ok'}, ON));
        const editor = made.editor;
        editor.type("api.mapkey('a', 'b', function() {");
        editor.session.setAnnotations([ERROR, {row: 0, type: 'warning', text: 'w'}]);
        expect(document.getElementById('lintStatus').textContent).toBe('1 error · 1 warning');
        expect(document.getElementById('lintStatus').classList.contains('sk-lint-errors')).toBe(true);

        save();
        const dialog = document.getElementById('saveErrorsDialog');
        expect(dialog).not.toBeNull();
        expect(dialog.querySelector('li').textContent).toBe("Line 1: Unmatched '{'.");
        expect(document.activeElement.textContent).toBe('Keep editing');
        document.activeElement.click();
        await Promise.resolve();
        expect(writes(sent)).toEqual([]);
        expect(document.getElementById('saveErrorsDialog')).toBeNull();

        save();
        document.getElementById('saveAnyway').click();
        await Promise.resolve();
        expect(writes(sent)).toEqual([{snippets: "api.mapkey('a', 'b', function() {", localPath: ''}]);
        expect(status()).toBe('Saved');
    });

    test('waits for the worker to lint the latest change before deciding', () => {
        jest.useFakeTimers();
        const {sent, made} = boot({hash: '#advanced'});
        loadSettings(Object.assign({snippets: '// ok'}, ON));
        const editor = made.editor;
        editor.type('broken(');
        editor.session.setAnnotations([ERROR]);
        // fixed, and saved before the worker has answered for the fix
        editor.type('fixed();');
        save();
        expect(writes(sent)).toEqual([]);
        editor.session.setAnnotations([]);
        expect(writes(sent)).toEqual([{snippets: 'fixed();', localPath: ''}]);
        expect(document.getElementById('saveErrorsDialog')).toBeNull();
    });

    test('a worker that never answers does not hold Save back for long', () => {
        jest.useFakeTimers();
        const {sent, made} = boot({hash: '#advanced'});
        loadSettings(Object.assign({snippets: '// ok'}, ON));
        made.editor.session.setAnnotations([]);
        made.editor.type('next();');
        save();
        expect(writes(sent)).toEqual([]);
        jest.advanceTimersByTime(1500);
        expect(writes(sent)).toEqual([{snippets: 'next();', localPath: ''}]);
    });

    test('marks unsaved edits in the title and status, and guards leaving the page', () => {
        const {made} = boot({hash: '#advanced'});
        loadSettings(Object.assign({snippets: '// stored'}, ON));
        const title = document.title;
        const leave = () => {
            const e = new Event('beforeunload', {cancelable: true});
            window.dispatchEvent(e);
            return e.defaultPrevented;
        };
        expect(leave()).toBe(false);
        made.editor.type('// stored\n// more');
        expect(document.title).toBe(`• ${title}`);
        expect(status()).toBe('Unsaved changes');
        expect(document.getElementById('save_button').classList.contains('sk-dirty')).toBe(true);
        expect(leave()).toBe(true);
        // back to the stored text is no edit at all
        made.editor.type('// stored');
        expect(document.title).toBe(title);
        expect(status()).toBe('');
        expect(leave()).toBe(false);
        // a changed address is an unsaved edit too
        const path = document.getElementById('localPath');
        path.value = 'https://a.test/s.js';
        path.dispatchEvent(new Event('input'));
        expect(leave()).toBe(true);
    });

    test('a replaced text from storage is no edit, even for the moment it is empty', () => {
        const {ctx} = boot({hash: '#advanced'});
        loadSettings(Object.assign({snippets: '// one'}, ON));
        ctx.patch({snippets: '// two'});
        expect(status()).toBe('');
        expect(document.title).not.toMatch(/^•/);
    });

    test('Ctrl-s and Cmd-s save while the editor is on screen, and only then', () => {
        const {sent, made, ctx} = boot({hash: '#advanced'});
        loadSettings(Object.assign({snippets: '// a'}, ON));
        made.editor.type('// b');
        const e = key('s', {ctrlKey: true});
        expect(e.defaultPrevented).toBe(true);
        expect(writes(sent)).toEqual([{snippets: '// b', localPath: ''}]);
        made.editor.type('// c');
        key('S', {metaKey: true});
        expect(writes(sent)).toHaveLength(2);
        expect(key('s', {ctrlKey: true, shiftKey: true}).defaultPrevented).toBe(false);

        ctx.show('sites');
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        expect(key('s', {ctrlKey: true}).defaultPrevented).toBe(false);
        expect(writes(sent)).toHaveLength(2);
    });

    test('keeps edits in progress when the stored script changes elsewhere', () => {
        const {ctx, made} = boot({hash: '#advanced'});
        loadSettings(Object.assign({snippets: '// one'}, ON));
        made.editor.type('// mine');
        ctx.patch({snippets: '// theirs'});
        expect(made.editor.getValue()).toBe('// mine');
        expect(status()).toMatch(/stored script changed/);
    });
});

describe('user scripts', () => {
    const OFF = {isMV3: true, isUserScriptsAvailable: false, showAdvanced: false};

    test('says they are off, offers the extension details, and flags a script that is not running', () => {
        boot({hash: '#appearance'});
        loadSettings(Object.assign({snippets: 'a();\nb();\nc();\n'}, OFF));
        expect(document.getElementById('userScriptsCard').hidden).toBe(false);
        expect(document.getElementById('userScriptsStatus').textContent).toMatch(/^Not allowed/);
        expect(document.getElementById('advancedToggler').disabled).toBe(true);
        const note = document.getElementById('snippetNotRunning');
        expect(note.hidden).toBe(false);
        // on top of every section, not only Advanced
        expect(note.closest('.sk-section')).toBeNull();
        expect(note.textContent).toContain('Your settings script (3 lines) is not running.');
        document.getElementById('openExtensionDetails').click();
        expect(chrome.tabs.create).toHaveBeenCalledWith({url: 'chrome://extensions/?id=ext'});
    });

    test('notices when they are turned on elsewhere, once the page is back in focus', () => {
        const {sent, local} = boot({hash: '#advanced', stored: {snippets: 'a();', showAdvanced: true}});
        loadSettings(Object.assign({snippets: 'a();'}, OFF));
        // what start.js getSettings adds to a full read
        local.isMV3 = true;
        local.isUserScriptsAvailable = false;
        window.dispatchEvent(new Event('focus'));
        expect(document.getElementById('advancedToggler').disabled).toBe(true);
        local.isUserScriptsAvailable = true;
        window.dispatchEvent(new Event('focus'));
        expect(document.getElementById('advancedToggler').disabled).toBe(false);
        expect(document.getElementById('userScriptsStatus').textContent).toMatch(/^Allowed/);
        expect(document.getElementById('snippetNotRunning').hidden).toBe(true);
        expect(document.getElementById('advancedSetting').hidden).toBe(false);
        expect(sent.filter((m) => m.action === 'getSettings' && m.args === null)).toHaveLength(2);
        expect(writes(sent)).toEqual([]);
    });

    test('has no card outside MV3', () => {
        boot({hash: '#advanced', browser: 'Firefox'});
        loadSettings({isMV3: false, showAdvanced: true, snippets: 'x'});
        expect(document.getElementById('userScriptsCard').hidden).toBe(true);
        expect(document.getElementById('snippetNotRunning').hidden).toBe(true);
    });
});

describe('load settings from', () => {
    const PATH = 'https://gist.test/sk.js';

    test('reports the load the page opened with, and reloads on demand', () => {
        let file = '// from file 2';
        const {sent} = boot({hash: '#advanced', reply: {
            loadSettingsFromUrl: () => ({status: 'Succeeded', snippets: file}),
        }});
        loadSettings(Object.assign({snippets: '// from file 1', localPath: PATH}, ON));
        const state = document.getElementById('localPathStatus');
        expect(state.textContent).toMatch(/^Loaded at /);
        expect(document.getElementById('localPathReload').hidden).toBe(false);
        document.getElementById('localPathReload').click();
        expect(sent.filter((m) => m.action === 'loadSettingsFromUrl').map((m) => m.args.url)).toEqual([PATH]);
        expect(global.ace.edit().getValue()).toBe('// from file 2');
        expect(status()).toBe('Loaded');
    });

    test('says why the last load failed', () => {
        boot({hash: '#advanced'});
        loadSettings(Object.assign({snippets: '// cached', localPath: PATH, error: `Failed to read snippets from ${PATH}: 404`}, ON));
        const state = document.getElementById('localPathStatus');
        expect(state.textContent).toMatch(/^Not loaded at .*: 404\. The copy loaded last is kept\.$/);
        expect(state.classList.contains('sk-error')).toBe(true);
    });

    test('asks before a reload replaces unsaved edits', async () => {
        const {sent, made} = boot({hash: '#advanced', reply: {
            loadSettingsFromUrl: () => ({status: 'Succeeded', snippets: '// file'}),
        }});
        loadSettings(Object.assign({snippets: '// file', localPath: PATH}, ON));
        made.editor.type('// mine');
        document.getElementById('localPathReload').click();
        expect(document.getElementById('reloadDialog')).not.toBeNull();
        document.activeElement.click();
        await Promise.resolve();
        expect(sent.filter((m) => m.action === 'loadSettingsFromUrl')).toEqual([]);
        expect(made.editor.getValue()).toBe('// mine');
    });

    test('has nothing to report without an address', () => {
        boot({hash: '#advanced'});
        loadSettings(Object.assign({snippets: '// x'}, ON));
        expect(document.getElementById('localPathStatus').hidden).toBe(true);
        expect(document.getElementById('localPathReload').hidden).toBe(true);
    });
});
