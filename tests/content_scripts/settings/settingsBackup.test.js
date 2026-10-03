// The backup file: what an export holds, how an import is read, what it changes,
// and how the Backup section splits an import for the background.
import { BACKUP_FORMAT, BACKUP_VERSION, DATA_KEYS, NEVER_KEYS, SETTINGS_KEYS, buildExport, diffSettings,
    exportFileName, mentionsSecret, parseImport } from '../../../src/content_scripts/common/settingsBackup.js';
import { KEY_LABELS, importPlan } from '../../../src/content_scripts/options/backup.js';

jest.mock('../../../src/content_scripts/common/runtime.js', () => ({
    RUNTIME: jest.fn(),
    dispatchSKEvent: jest.fn(),
    runtime: { conf: {} },
}));

// what getSettings 'RAW' hands back on a well-used profile
const RAW = {
    snippets: "api.map('gt', 'T');",
    localPath: '',
    showAdvanced: true,
    basicMappings: {d: 'q', x: ''},
    disabledSearchAliases: {w: 'bing'},
    blocklist: {'https://a.test': 1},
    mouseSelectToQuery: ['https://m.test'],
    noPdfViewer: false,
    proxyMode: 'byhost',
    proxy: ['PROXY 127.0.0.1:1080'],
    autoproxy_hosts: [['x.test']],
    paletteTheme: 'nord',
    marks: {m: {url: 'https://devnotes.dev/m', scrollLeft: 0, scrollTop: 0}},
    sessions: {work: {tabs: [['https://devnotes.dev/a']]}},
    findHistory: ['secret search'],
    cmdHistory: ['open secret'],
    lastKeys: 'gg',
    savedAt: 1700000000000,
    logLevels: ['log'],
    _llmProviderConfig: {bedrock: {accessKeyId: 'AKIA', secretAccessKey: 'SHH'}},
};

describe('buildExport', () => {
    test('writes the versioned wrapper around the settings', () => {
        const file = buildExport(RAW, {exportedAt: '2026-09-29T08:00:00.000Z', extensionVersion: '1.2.3'});
        expect(file).toEqual({
            format: BACKUP_FORMAT,
            version: BACKUP_VERSION,
            exportedAt: '2026-09-29T08:00:00.000Z',
            extensionVersion: '1.2.3',
            settings: expect.any(Object),
        });
        expect(BACKUP_FORMAT).toBe('surfingkeys-settings');
        expect(BACKUP_VERSION).toBe(1);
    });

    test('holds every setting and, by default, no marks, sessions, histories or credentials', () => {
        const {settings} = buildExport(RAW);
        expect(Object.keys(settings).sort()).toEqual(SETTINGS_KEYS.slice().sort());
        expect(settings.basicMappings).toEqual({d: 'q', x: ''});
        expect(settings.paletteTheme).toBe('nord');
        const text = JSON.stringify(settings);
        ['AKIA', 'SHH', 'secret search', 'open secret'].forEach((s) => expect(text).not.toContain(s));
    });

    test('adds marks and sessions when asked, and still never the rest', () => {
        const {settings} = buildExport(RAW, {includeData: true});
        expect(settings.marks).toEqual(RAW.marks);
        expect(settings.sessions).toEqual(RAW.sessions);
        NEVER_KEYS.forEach((k) => expect(settings).not.toHaveProperty(k));
    });

    test('leaves out what is not stored, and copes with nothing stored', () => {
        expect(buildExport({blocklist: {}}).settings).toEqual({blocklist: {}});
        expect(buildExport(undefined).settings).toEqual({});
    });

    test('never exports a key it does not know', () => {
        expect(buildExport({isMV3: true, error: 'x', basicMappings: {}}).settings).toEqual({basicMappings: {}});
    });
});

test('names the file by the local date', () => {
    expect(exportFileName(new Date(2026, 0, 5, 23, 59))).toBe('surfingkeys-settings-2026-01-05.json');
});

describe('parseImport', () => {
    test('reads what an export writes', () => {
        const file = buildExport(RAW, {includeData: true, exportedAt: '2026-09-29T08:00:00.000Z', extensionVersion: '1.2.3'});
        const parsed = parseImport(JSON.stringify(file));
        expect(parsed).toEqual({version: 1, exportedAt: '2026-09-29T08:00:00.000Z', extensionVersion: '1.2.3',
            settings: file.settings, ignored: []});
    });

    test('takes what yj copies as version 0, without credentials, histories or bookkeeping', () => {
        const parsed = parseImport(JSON.stringify(RAW));
        expect(parsed.version).toBe(0);
        expect(Object.keys(parsed.settings).sort()).toEqual(SETTINGS_KEYS.concat(DATA_KEYS).sort());
        expect(parsed.ignored.sort()).toEqual(NEVER_KEYS.slice().sort());
    });

    test('ignores keys it does not know, and says which', () => {
        const parsed = parseImport(JSON.stringify({format: BACKUP_FORMAT, version: 1, settings: {basicMappings: {}, smoothScroll: false, _llmProviderConfig: {}}}));
        expect(parsed.settings).toEqual({basicMappings: {}});
        expect(parsed.ignored).toEqual(['smoothScroll', '_llmProviderConfig']);
    });

    test.each([
        ['{not json', /not JSON/],
        ['[1, 2]', /not a Surfingkeys settings file/],
        ['"text"', /not a Surfingkeys settings file/],
        ['null', /not a Surfingkeys settings file/],
        ['{"name": "a package.json"}', /not a Surfingkeys settings file/],
        ['{}', /not a Surfingkeys settings file/],
        ['{"format": "something-else", "version": 1, "settings": {}}', /not a Surfingkeys settings file/],
        ['{"format": "surfingkeys-settings", "settings": {}}', /no valid version/],
        ['{"format": "surfingkeys-settings", "version": "1", "settings": {}}', /no valid version/],
        ['{"format": "surfingkeys-settings", "version": 2, "settings": {}}', /newer Surfingkeys \(file version 2\)/],
        ['{"format": "surfingkeys-settings", "version": 1}', /holds no settings/],
        ['{"format": "surfingkeys-settings", "version": 1, "settings": []}', /holds no settings/],
        ['{"format": "surfingkeys-settings", "version": 1, "settings": {"basicMappings": "d"}}', /“basicMappings” is not an object of keys/],
        ['{"format": "surfingkeys-settings", "version": 1, "settings": {"basicMappings": {"d": 1}}}', /“basicMappings”/],
        ['{"format": "surfingkeys-settings", "version": 1, "settings": {"showAdvanced": "yes"}}', /“showAdvanced” is not true or false/],
        ['{"format": "surfingkeys-settings", "version": 1, "settings": {"mouseSelectToQuery": "https://a.test"}}', /“mouseSelectToQuery” is not a list of text/],
        ['{"format": "surfingkeys-settings", "version": 1, "settings": {"snippets": null}}', /“snippets” is not text/],
        ['{"format": "surfingkeys-settings", "version": 1, "settings": {"blocklist": null}}', /“blocklist” is not an object/],
        ['{"snippets": 42}', /“snippets” is not text/],
    ])('refuses %s with a readable error', (text, message) => {
        expect(() => parseImport(text)).toThrow(message);
    });

    test('takes the shapes older builds stored, as this build stores them', () => {
        const parsed = parseImport(JSON.stringify({proxy: 'PROXY a:1', autoproxy_hosts: 'x.test', paletteTheme: null}));
        expect(parsed.settings).toEqual({proxy: ['PROXY a:1'], autoproxy_hosts: [['x.test']], paletteTheme: null});
        expect(parseImport(JSON.stringify({proxy: 'PROXY a:1', autoproxy_hosts: ['x.test', 'y.test']})).settings)
            .toEqual({proxy: ['PROXY a:1'], autoproxy_hosts: [['x.test', 'y.test']]});
    });

    // the background maps over every host list as a list when it applies the
    // proxy, and writes the mode into the PAC script it builds
    test.each([
        [{proxyMode: 'byhost', proxy: ['PROXY x:1'], autoproxy_hosts: ['a.com']}, /“autoproxy_hosts” is not a list of hosts for each “proxy”/],
        [{proxy: ['PROXY x:1'], autoproxy_hosts: 'a.com'}, /“autoproxy_hosts” is not a list of hosts for each/],
        [{proxy: 'PROXY x:1', autoproxy_hosts: [['a.com']]}, /not one list of hosts for its one “proxy”/],
        [{proxy: ['PROXY x:1']}, /only one of “proxy” and “autoproxy_hosts”/],
        [{autoproxy_hosts: [['a.com']]}, /only one of “proxy” and “autoproxy_hosts”/],
        [{proxyMode: "byhost'; x(); '"}, /“proxyMode” is not one of always, byhost, bypass, clear, direct, system/],
        [{proxyMode: 'fixed_servers'}, /“proxyMode”/],
    ])('refuses a proxy the background cannot apply: %j', (settings, message) => {
        expect(() => parseImport(JSON.stringify({format: BACKUP_FORMAT, version: 1, settings}))).toThrow(message);
    });
});

describe('diffSettings', () => {
    test('sorts keys into added, changed and left as they are', () => {
        const current = {basicMappings: {d: 'q'}, blocklist: {'https://a.test': 1}, snippets: 'old', marks: {m: {}}};
        const incoming = {basicMappings: {d: 'q'}, blocklist: {'https://b.test': 1}, snippets: 'new', paletteTheme: 'nord', proxyMode: 'clear'};
        expect(diffSettings(current, incoming)).toEqual({
            added: ['proxyMode', 'paletteTheme'],
            changed: ['snippets', 'blocklist'],
            removed: ['marks'],
        });
    });

    test('an empty value counts as none, and key order as no change', () => {
        expect(diffSettings({blocklist: {}, showAdvanced: false, basicMappings: {a: 'b', c: 'd'}},
            {blocklist: {}, snippets: '', basicMappings: {c: 'd', a: 'b'}, mouseSelectToQuery: []}))
            .toEqual({added: [], changed: [], removed: []});
    });

    test('emptying a setting is a change', () => {
        expect(diffSettings({blocklist: {'https://a.test': 1}}, {blocklist: {}}).changed).toEqual(['blocklist']);
    });

    test('never lists what an import never writes', () => {
        const diff = diffSettings(RAW, {});
        expect(diff.removed).not.toEqual(expect.arrayContaining(['findHistory']));
        NEVER_KEYS.forEach((k) => expect(diff.removed).not.toContain(k));
    });
});

test.each([
    ["const service = {apiKey: 'x'};", true],
    ['const TOKEN = 1;', true],
    ['// my client_secret', true],
    ['password', true],
    ["api.map('gt', 'T');", false],
    [undefined, false],
])('mentionsSecret(%p) is %p', (text, found) => {
    expect(mentionsSecret(text)).toBe(found);
});

describe('importPlan', () => {
    const settings = {snippets: 'x', localPath: 'https://a.test/s.js', showAdvanced: true, basicMappings: {d: 'q'}, paletteTheme: 'nord'};

    test('stores the theme apart, and all the rest in one write', () => {
        expect(importPlan(settings)).toEqual({
            settings: {snippets: 'x', localPath: 'https://a.test/s.js', showAdvanced: true, basicMappings: {d: 'q'}},
            theme: 'nord',
            advancedHeldBack: false,
        });
    });

    test('without the script, drops it, where it loads from and the mode that runs it', () => {
        expect(importPlan(settings, {withScript: false}).settings).toEqual({basicMappings: {d: 'q'}});
    });

    test('holds advanced mode back while user scripts are off, since the background refuses it', () => {
        const plan = importPlan(settings, {userScriptsOff: true});
        expect(plan.settings).not.toHaveProperty('showAdvanced');
        expect(plan.settings.snippets).toBe('x');
        expect(plan.advancedHeldBack).toBe(true);
        expect(importPlan({showAdvanced: false}, {userScriptsOff: true})).toEqual({settings: {showAdvanced: false}, theme: undefined, advancedHeldBack: false});
    });

    test('does not touch what it was given', () => {
        const copy = JSON.parse(JSON.stringify(settings));
        importPlan(settings, {withScript: false, userScriptsOff: true});
        expect(settings).toEqual(copy);
    });
});

test('the preview has a name for every key a backup carries', () => {
    SETTINGS_KEYS.concat(DATA_KEYS).forEach((k) => expect(KEY_LABELS[k]).toEqual(expect.any(String)));
});
