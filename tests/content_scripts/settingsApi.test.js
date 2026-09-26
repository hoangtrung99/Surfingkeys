// The settings API end to end. Under MV3 the user's settings snippet runs in the
// user-script world (src/user_scripts/index.js) and reaches the content script
// only through surfingkeys:api / surfingkeys:front / surfingkeys:user events; here
// both sides share one jsdom realm, the way they share one DOM in a tab. The
// basic-mode settings (no snippet) arrive with settingsUpdated instead.
import { bootContent } from '../helpers/bootContent.js';
import { BOOT_TIMEOUT } from '../helpers/jsdomEnv.js';

let h, KeyboardUtils;
beforeAll(async () => {
    h = await bootContent({ html: '<input id="field" value="hello big world"><p>page</p>' });
    KeyboardUtils = require('../../src/content_scripts/common/keyboardUtils.js').default;
}, BOOT_TIMEOUT);

afterEach(() => {
    // leaves Insert mode as well as any pending keys
    h.press('<Esc>');
});

const requests = () => h.sent.filter((m) => m.action !== 'localData');
const uiRequests = () => h.ui().filter((a) => !['showStatus', 'showBanner'].includes(a.action));
const words = (mode) => mode.mappings.getWords().map((w) => KeyboardUtils.decodeKeystroke(w));

// the user's settings snippet: (api, settings) => {...}
const userScript = (uf) => h.runUserScript(uf);

// what LOG() prints at level warn while fn runs
function warningsFrom(fn) {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    h.chrome.storage.local.get.mockImplementation((keys, cb) => cb({ logLevels: ['warn'] }));
    try {
        fn();
        return warn.mock.calls.map((call) => call[0]);
    } finally {
        warn.mockRestore();
        h.chrome.storage.local.get.mockReset();
    }
}

function clickInto(el) {
    h.clickInto(el);
    expect(h.Mode.getCurrent().name).toBe('Insert');
}

describe('mapkey', () => {
    test('runs the user function on its keys', () => {
        const calls = [];
        userScript((api) => api.mapkey('zq', '#0zq', () => calls.push('zq')));
        h.press('zq');
        expect(calls).toEqual(['zq']);
        expect(requests()).toEqual([]);
    });

    test('hands the next key to a function that takes one', () => {
        const calls = [];
        userScript((api) => api.mapkey('zw', '#0zw', (key) => calls.push(key)));
        h.press('zwm');
        expect(calls).toEqual(['m']);
    });

    test.each([
        [/example\.com/, false],
        [/localhost/, true],
    ])('with domain %p applies on http://localhost/: %p', (domain, applies) => {
        const calls = [];
        userScript((api) => api.mapkey('zd', '#0zd', () => calls.push('zd'), { domain }));
        h.press('zd');
        expect(calls).toEqual(applies ? ['zd'] : []);
        expect(words(h.normal).includes('zd')).toBe(applies);
        h.api.unmap('zd');
    });

    test('takes a default key over, with a warning', () => {
        const calls = [];
        const warnings = warningsFrom(() => {
            userScript((api) => api.mapkey('X', '#0mine', () => calls.push('X')));
        });
        expect(warnings).toEqual(['X for [Restore closed tab] is overridden by [#0mine].']);
        h.press('X');
        expect(calls).toEqual(['X']);
        expect(requests()).toEqual([]);
    });

    test('is refused under a key that acts at once, which keeps acting', () => {
        const calls = [];
        const warnings = warningsFrom(() => {
            userScript((api) => api.mapkey('xx', '#0xx', () => calls.push('xx')));
        });
        expect(warnings).toEqual(['x for [Close current tab] precedes xx.']);
        h.press('xx');
        expect(calls).toEqual([]);
        expect(requests()).toEqual([
            expect.objectContaining({ action: 'closeTab' }),
            expect.objectContaining({ action: 'closeTab' }),
        ]);
    });
});

describe('map and unmap', () => {
    test('map adds a key for an action and the old key keeps it', async () => {
        userScript((api) => api.map('Q', 'yt'));
        h.press('Q');
        h.press('yt');
        expect(requests()).toEqual([
            expect.objectContaining({ action: 'duplicateTab' }),
            expect.objectContaining({ action: 'duplicateTab' }),
        ]);
        await h.settle();
        // the frontend keeps its own copy of the keymap for the usage page
        expect(h.ui('addMapkey')).toEqual([expect.objectContaining({ mode: 'Normal', new_keystroke: 'Q', old_keystroke: 'yt' })]);
    });

    test('map to a :command runs it in the frontend', () => {
        userScript((api) => api.map('zc', ':quit'));
        h.press('zc');
        expect(uiRequests()).toEqual([expect.objectContaining({ action: 'executeCommand', cmdline: 'quit' })]);
    });

    test('map to <Esc> makes the new key leave Insert mode too, until it is unmapped', async () => {
        const field = document.getElementById('field');
        userScript((api) => api.map('<Ctrl-[>', '<Esc>'));
        clickInto(field);
        h.press('<Ctrl-[>');
        expect(h.Mode.getCurrent().name).toBe('Normal');
        expect(document.activeElement).not.toBe(field);
        await h.settle();
        expect(h.ui('addMapkey')).toEqual([expect.objectContaining({ mode: 'Mode', new_keystroke: '<Ctrl-[>', old_keystroke: '<Esc>' })]);

        userScript((api) => api.unmap('<Ctrl-[>'));
        clickInto(field);
        h.press('<Ctrl-[>');
        expect(h.Mode.getCurrent().name).toBe('Insert');
    });

    test('unmap removes a key', () => {
        userScript((api) => api.unmap('yT'));
        h.press('yT');
        expect(requests()).toEqual([]);
        expect(words(h.normal)).not.toContain('yT');
    });

    test('unmap for another domain leaves the key alone', () => {
        userScript((api) => api.unmap('gT', /example\.com/));
        h.press('gT');
        expect(requests()).toEqual([expect.objectContaining({ action: 'historyTab', index: 0 })]);
    });

    test('cmap tells the frontend, which owns the omnibar keys', async () => {
        userScript((api) => api.cmap('<Ctrl-y>', '<Ctrl-n>'));
        await h.settle();
        expect(h.ui('addMapkey')).toEqual([expect.objectContaining({ mode: 'Omnibar', new_keystroke: '<Ctrl-y>', old_keystroke: '<Ctrl-n>' })]);
    });

    test('vmapkey and vunmap edit the Visual keymap', () => {
        userScript((api) => api.vmapkey('zq', '#9zq', () => {}));
        expect(words(h.visual)).toContain('zq');
        userScript((api) => api.vunmap('zq'));
        expect(words(h.visual)).not.toContain('zq');
    });
});

describe('Insert-mode keys from the settings', () => {
    let field;
    beforeEach(() => {
        field = document.getElementById('field');
        field.value = 'hello big world';
    });

    test('imapkey runs the user function and types nothing', () => {
        const calls = [];
        userScript((api) => api.imapkey(',,', '#15mine', () => calls.push(',,')));
        clickInto(field);
        field.setSelectionRange(5, 5);
        const downs = h.press(',,');
        expect(calls).toEqual([',,']);
        expect(field.value).toBe('hello big world');
        expect(downs.map((e) => e.defaultPrevented)).toEqual([true, true]);
    });

    test('imap adds a key for an Insert-mode action', () => {
        userScript((api) => api.imap('<Ctrl-y>', '<Ctrl-e>'));
        clickInto(field);
        field.setSelectionRange(0, 0);
        h.press('<Ctrl-y>');
        expect(field.selectionStart).toBe(field.value.length);
    });

    test('iunmap removes an Insert-mode key', () => {
        userScript((api) => api.iunmap('<Ctrl-u>'));
        clickInto(field);
        field.setSelectionRange(6, 6);
        const [down] = h.press('<Ctrl-u>');
        expect(field.value).toBe('hello big world');
        expect(down.defaultPrevented).toBe(false);
    });
});

describe('search aliases', () => {
    const SEARCH = 'https://kagi.example/search?q=';
    const SUGGEST = 'https://kagi.example/suggest?q=';

    test('addSearchAlias registers the engine with the frontend and maps o<alias>', async () => {
        userScript((api) => api.addSearchAlias('k', 'kagi', SEARCH, 's', SUGGEST, (response) => JSON.parse(response.text)));
        await h.settle();
        expect(h.ui('addSearchAlias')).toEqual([expect.objectContaining({ alias: 'k', prompt: 'kagi', url: SEARCH, suggestionURL: SUGGEST })]);
        h.press('ok');
        expect(h.ui('openOmnibar')).toEqual([expect.objectContaining({ type: 'SearchEngine', extra: 'k' })]);
    });

    test("the user's parser answers the frontend's suggestion request", async () => {
        const requestsSeen = [];
        userScript((api) => api.addSearchAlias('k', 'kagi', SEARCH, 's', SUGGEST, (response, request) => {
            requestsSeen.push(request);
            return JSON.parse(response.text).map((s) => s.toUpperCase());
        }));
        h.message({
            action: 'getSearchSuggestions', ack: true, id: 'sug1', origin: 'chrome-extension://x',
            url: SUGGEST, requestUrl: `${SUGGEST}fo`, query: 'fo', response: { text: '["foo","fob"]' },
        });
        await h.settle();
        expect(requestsSeen).toEqual([{ url: `${SUGGEST}fo`, query: 'fo' }]);
        expect(h.toUiHost).toHaveBeenCalledWith({ surfingkeys_uihost_data: expect.objectContaining({ id: 'sug1', data: ['FOO', 'FOB'], toFrontend: true }) });
    });

    test("a parser that throws answers the frontend with no suggestions", async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            userScript((api) => api.addSearchAlias('k', 'kagi', SEARCH, 's', SUGGEST, () => {
                throw new Error('bad JSON');
            }));
            h.message({
                action: 'getSearchSuggestions', ack: true, id: 'sug2', origin: 'chrome-extension://x',
                url: SUGGEST, requestUrl: `${SUGGEST}fo`, query: 'fo', response: { text: '<html>' },
            });
            await h.settle();
            expect(h.toUiHost).toHaveBeenCalledWith({ surfingkeys_uihost_data: expect.objectContaining({ id: 'sug2', data: [] }) });
        } finally {
            error.mockRestore();
        }
    });

    test('removeSearchAlias undoes it', async () => {
        userScript((api) => api.addSearchAlias('k', 'kagi', SEARCH));
        userScript((api) => api.removeSearchAlias('k'));
        await h.settle();
        expect(h.ui('removeSearchAlias')).toEqual([expect.objectContaining({ alias: 'k' })]);
        h.press('ok');
        expect(h.ui('openOmnibar')).toEqual([]);
    });

    test('an alias that is not ASCII stops the settings with an error popup', async () => {
        const after = [];
        userScript((api) => {
            api.addSearchAlias('ké', 'nope', SEARCH);
            after.push('ran on');
        });
        await h.settle();
        expect(after).toEqual([]);
        expect(h.ui('showPopup')).toEqual([expect.objectContaining({
            content: '[SurfingKeys] Error found in settings: Invalid alias ké, which must be ASCII characters.',
        })]);
    });
});

describe('commands and omnibar callbacks', () => {
    test('addCommand lists the command and runs it with its arguments', async () => {
        const calls = [];
        userScript((api) => api.addCommand('hello', 'say hello', (...args) => calls.push(args)));
        await h.settle();
        expect(h.ui('addCommand')).toEqual([expect.objectContaining({ name: 'hello', description: 'say hello' })]);
        h.message({ action: 'executeUserCommand', name: 'hello', args: ['a', 'b'] });
        expect(calls).toEqual([['a', 'b']]);
    });

    test("Front.openOmnibar keeps onEnter in the settings' world and calls it for the picked item", () => {
        const picked = [];
        const items = [{ title: 'Docs', url: 'https://docs.example/' }];
        userScript((api) => api.Front.openOmnibar({ type: 'UserURLs', extra: items, onEnter: (item, ctrlKey) => picked.push([item, ctrlKey]) }));
        const [open] = h.ui('openOmnibar');
        expect(open).toEqual(expect.objectContaining({ type: 'UserURLs', extra: items }));
        expect(open).not.toHaveProperty('onEnter');
        expect(open).not.toHaveProperty('_hasCustomOnEnter');

        h.message({ action: 'userURLs_entered', item: items[0], ctrlKey: true, tabbed: true });
        expect(picked).toEqual([[items[0], true]]);
        expect(requests()).toEqual([]);
    });

    test('without onEnter the picked URL is opened', () => {
        userScript((api) => api.Front.openOmnibar({ type: 'UserURLs', extra: [] }));
        h.message({ action: 'userURLs_entered', item: { url: 'https://docs.example/' }, ctrlKey: false, tabbed: true });
        expect(requests()).toEqual([expect.objectContaining({ action: 'openLink', url: 'https://docs.example/', tab: { tabbed: true, active: true } })]);
    });

    test("Front.showEditor hands what the editor saved to the settings' onWrite", () => {
        const written = [];
        userScript((api) => api.Front.showEditor('draft', (data) => written.push(data), 'url'));
        expect(h.ui('showEditor')).toEqual([expect.objectContaining({ type: 'url', content: 'draft' })]);
        h.message({ action: 'ace_editor_saved', data: 'final' });
        expect(written).toEqual(['final']);
    });

    test.each([
        ['Front.showBanner', (api) => api.Front.showBanner('hi there'), { action: 'showBanner', content: 'hi there' }],
        ['Front.showPopup', (api) => api.Front.showPopup('<b>hi</b>'), { action: 'showPopup', content: '<b>hi</b>' }],
    ])('%s reaches the frontend', (_, uf, request) => {
        userScript(uf);
        expect(h.ui(request.action)).toEqual([expect.objectContaining(request)]);
    });

    test.each([
        ['Normal.jumpVIMark', (api) => api.Normal.jumpVIMark('a'), { action: 'jumpVIMark', mark: 'a' }],
        ['readText', (api) => api.readText('hello'), { action: 'read', content: 'hello' }],
        ['RUNTIME', (api) => api.RUNTIME('getTabs', { queryInfo: { audible: true } }), { action: 'getTabs', queryInfo: { audible: true } }],
    ])('%s reaches the background', (_, uf, request) => {
        userScript(uf);
        expect(requests()).toEqual([expect.objectContaining(request)]);
    });

    test('Clipboard.write and Clipboard.read reach the system clipboard', () => {
        const read = [];
        userScript((api) => {
            api.Clipboard.write('from settings');
            api.Clipboard.read((response) => read.push(response.data));
        });
        expect(h.board.text).toBe('from settings');
        expect(read).toEqual(['from settings']);
    });
});

describe('settings.*', () => {
    test('a setting the page knows goes into its conf', () => {
        userScript((api, settings) => {
            settings.scrollStepSize = 25;
        });
        expect(h.runtime.conf.scrollStepSize).toBe(25);
        expect(requests().filter((m) => m.action === 'updateSettings')).toEqual([]);
    });

    test('a setting the page does not know goes to the background, for this session only', () => {
        userScript((api, settings) => {
            settings.myUnknownKey = 1;
        });
        expect(requests()).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'updateSettings', scope: 'snippets', settings: { myUnknownKey: 1 } }),
        ]));
    });

    test('a regex setting is a RegExp again on the page', () => {
        // content.js re-reads the conf once per settings load, for the snippet that follows it
        h.settingsUpdated({});
        userScript((api, settings) => {
            settings.nextLinkRegex = /weiter/i;
        });
        expect(h.runtime.conf.nextLinkRegex).toBeInstanceOf(RegExp);
        expect(h.runtime.conf.nextLinkRegex.test('Weiter »')).toBe(true);
    });

    test('settings.blocklistPattern goes with the next state request', () => {
        h.settingsUpdated({});
        userScript((api, settings) => {
            settings.blocklistPattern = /mail\.example/i;
        });
        const [ask] = requests().filter((m) => m.action === 'getState');
        // what the background receives, after the message is serialised
        expect(JSON.parse(JSON.stringify(ask.blocklistPattern))).toEqual({ source: 'mail\\.example', flags: 'i' });
    });

    test('a throwing snippet shows its error', () => {
        userScript(() => {
            throw new Error('boom');
        });
        expect(h.ui('showPopup')).toEqual([expect.objectContaining({ content: '[SurfingKeys] Error found in settings: Error: boom' })]);
    });

    test('settings.theme wins over a built-in theme picked later', async () => {
        userScript((api, settings) => {
            settings.theme = '#sk_status { color: red; }';
        });
        await h.settle();
        expect(h.front.hasUserTheme()).toBe(true);
        expect(h.ui('applyUserSettings')).toEqual([expect.objectContaining({ userSettings: { theme: '#sk_status { color: red; }' } })]);
        h.message({ action: 'pickTheme', name: 'nord' });
        expect(h.ui('showBanner')).toEqual([expect.objectContaining({ content: 'Theme: Nord, but settings.theme in your settings overrides it' })]);
    });
});

describe('Normal and Hints through the bridge', () => {
    test('Normal.feedkeys types keys as if pressed', () => {
        jest.useFakeTimers();
        try {
            userScript((api) => api.Normal.feedkeys('2x'));
            expect(requests()).toEqual([]);
            jest.advanceTimersByTime(1);
            expect(requests()).toEqual([expect.objectContaining({ action: 'closeTab', repeats: 2 })]);
        } finally {
            jest.useRealTimers();
        }
    });

    test('Normal.passThrough suppresses Surfingkeys for its timeout', () => {
        jest.useFakeTimers();
        try {
            userScript((api) => api.Normal.passThrough(500));
            expect(h.Mode.getCurrent().name).toBe('PassThrough');
            h.press('x');
            expect(requests()).toEqual([]);
            jest.advanceTimersByTime(500);
            expect(h.Mode.getCurrent().name).toBe('Normal');
        } finally {
            jest.useRealTimers();
        }
    });

    test('Hints.setCharacters changes the hint labels of the page', () => {
        userScript((api) => api.Hints.setCharacters('abc'));
        expect(h.hints.getCharacters()).toBe('abc');
    });

    // known bug hint-chars-skip-frontend: the bridge calls hints.setCharacters
    // alone (api.js "hints:setCharacters"), so the frontend's tab hints (T) keep
    // the default characters under MV3
    test.failing('Hints.setCharacters changes the hint labels of the frontend too', async () => {
        userScript((api) => api.Hints.setCharacters('qwe'));
        await h.settle();
        expect(h.ui('setHintsCharacters')).toEqual([expect.objectContaining({ characters: 'qwe' })]);
    });
});

describe('basic mode: key changes from the settings page', () => {
    test('swapping two keys swaps their actions, and swapping again restores them', () => {
        h.settingsUpdated({ basicMappings: { E: 'R', R: 'E' } });
        h.press('E');
        h.press('R');
        expect(requests().map((m) => m.action)).toEqual(['nextTab', 'previousTab']);

        h.settingsUpdated({ basicMappings: { E: 'R', R: 'E' } });
        h.press('E');
        expect(requests().map((m) => m.action)).toEqual(['previousTab']);
    });

    test('a key given a new key keeps working (D1)', () => {
        h.settingsUpdated({ basicMappings: { x: 'q' } });
        h.press('q');
        h.press('x');
        expect(requests().map((m) => m.action)).toEqual(['closeTab', 'closeTab']);
    });

    test('a key given no key is gone', () => {
        h.settingsUpdated({ basicMappings: { gxp: '' } });
        h.press('gxp');
        expect(requests()).toEqual([]);
    });

    test('a disabled search alias is removed from the page and the frontend', async () => {
        h.settingsUpdated({ disabledSearchAliases: { g: 'google' } });
        await h.settle();
        expect(h.ui('removeSearchAlias')).toEqual([expect.objectContaining({ alias: 'g' })]);
        h.frontCmd.mockClear();
        h.press('og');
        expect(h.ui('openOmnibar')).toEqual([]);
    });

    test('with advanced settings on, basic key changes are ignored', () => {
        h.settingsUpdated({ showAdvanced: true, basicMappings: { gxt: '' } });
        h.press('gxt');
        expect(requests()).toEqual([expect.objectContaining({ action: 'closeTabLeft' })]);
    });
});

// last: it empties the keymap for the rest of this file
describe('unmapAllExcept', () => {
    test('for another domain it changes nothing', () => {
        userScript((api) => api.unmapAllExcept(['j', 'k'], /example\.com/));
        h.press('R');
        expect(requests()).toEqual([expect.objectContaining({ action: 'nextTab' })]);
    });

    test('keeps only the listed keys, in Normal and Insert mode', () => {
        userScript((api) => api.unmapAllExcept(['j', 'k', '<Ctrl-e>']));
        expect(words(h.normal).sort()).toEqual(['j', 'k']);
        expect(words(h.insert)).toEqual(['<Ctrl-e>']);
        h.press('R');
        expect(requests()).toEqual([]);
    });
});
