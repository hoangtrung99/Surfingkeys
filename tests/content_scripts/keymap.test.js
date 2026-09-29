// The default Normal-mode keymap as a contract: which keys reach which
// background request (RUNTIME) or which UI request (front.command), with the
// repeat count rules on top. Remapping a default key on purpose means updating
// its row here.
import { bootContent } from '../helpers/bootContent.js';
import { BOOT_TIMEOUT } from '../helpers/jsdomEnv.js';

const PAGE = `
<form method="post" action="/login">
  <input name="user" value="ann"><input name="tags" value="a"><input name="tags" value="b">
</form>
<p>Some text</p>`;
const PAGE_URL = 'http://localhost/';

let h;
beforeAll(async () => {
    h = await bootContent({ html: PAGE });
    document.title = 'Fixture page';
}, BOOT_TIMEOUT);

// setLastKeys records every multi-key action with localData, for '.'
const requests = () => h.sent.filter((m) => m.action !== 'localData');
// Mode.showStatus and banners ride along with other requests
const uiRequests = () => h.ui().filter((a) => !['showStatus', 'showBanner'].includes(a.action));

afterEach(() => {
    // no test may leave a prefix or a count pending for the next one
    h.press('<Esc>');
});

describe('keys that ask the background', () => {
    test.each([
        ['x', 'closeTab', { repeats: 1 }],
        ['3x', 'closeTab', { repeats: 3 }],
        ['E', 'previousTab', { repeats: 1 }],
        ['R', 'nextTab', { repeats: 1 }],
        // E and R are never throttled: no confirmation above repeatThreshold
        ['12E', 'previousTab', { repeats: 12 }],
        ['X', 'openLast', {}],
        ['yt', 'duplicateTab', {}],
        ['yT', 'duplicateTab', { active: false }],
        ['gxt', 'closeTabLeft', { repeats: 1 }],
        ['gxT', 'closeTabRight', { repeats: 1 }],
        ['gx0', 'closeTabsToLeft', {}],
        ['gx$', 'closeTabsToRight', {}],
        ['gxx', 'tabOnly', {}],
        ['gxp', 'closeAudibleTab', {}],
        ['<<', 'moveTab', { step: -1, repeats: 1 }],
        ['>>', 'moveTab', { step: 1, repeats: 1 }],
        ['2>>', 'moveTab', { step: 1, repeats: 2 }],
        ['<Alt-p>', 'togglePinTab', {}],
        ['<Alt-m>', 'muteTab', {}],
        ['r', 'reloadTab', { nocache: false, repeats: 1 }],
        ['B', 'historyTab', { backward: true }],
        ['F', 'historyTab', { backward: false }],
        ['gT', 'historyTab', { index: 0 }],
        ['gt', 'historyTab', { index: -1 }],
        ['<Ctrl-6>', 'goToLastTab', {}],
        ['zi', 'setZoom', { zoomFactor: 0.1, repeats: 1 }],
        ['zo', 'setZoom', { zoomFactor: -0.1, repeats: 1 }],
        ['zr', 'setZoom', { zoomFactor: 0, repeats: 1 }],
        [';gw', 'gatherWindows', {}],
        ['gs', 'viewSource', { tab: { tabbed: true } }],
        ['on', 'openLink', { url: 'chrome://newtab/', tab: { tabbed: true } }],
        [';e', 'openLink', { url: '/pages/options.html', tab: { tabbed: true } }],
        ['oi', 'openIncognito', { url: PAGE_URL }],
        [';j', 'closeDownloadsShelf', { clearHistory: true }],
        [';dh', 'deleteHistoryOlderThan', { days: 30 }],
        [';db', 'removeBookmark', {}],
        [';cq', 'clearQueueURLs', {}],
        ['ZZ', 'createSession', { name: 'LAST', quitAfterSaved: true }],
        ['ZR', 'openSession', { name: 'LAST' }],
        ['cp', 'updateProxy', { host: 'localhost', operation: 'toggle' }],
        ['ma', 'addVIMark', { mark: { a: { url: PAGE_URL, scrollLeft: 0, scrollTop: 0 } } }],
        ["'a", 'jumpVIMark', { mark: 'a' }],
        ['<Alt-s>', 'toggleBlocklist', { blocklistPattern: '' }],
    ])('%s sends %s', (keys, action, args) => {
        h.press(keys);
        expect(requests()).toEqual([expect.objectContaining(Object.assign({ action }, args))]);
    });

    test('a prefix sends nothing until its sequence is complete', () => {
        h.press('g');
        h.press('x');
        expect(requests()).toEqual([]);
        h.press('x');
        expect(requests()).toEqual([expect.objectContaining({ action: 'tabOnly' })]);
    });
});

describe('keys that ask the UI', () => {
    test.each([
        ['t', { action: 'openOmnibar', type: 'URLs' }],
        ['go', { action: 'openOmnibar', type: 'URLs', tabbed: false }],
        ['b', { action: 'openOmnibar', type: 'Bookmarks' }],
        ['ox', { action: 'openOmnibar', type: 'RecentlyClosed' }],
        ['oh', { action: 'openOmnibar', type: 'History' }],
        ['W', { action: 'openOmnibar', type: 'Windows' }],
        [';gt', { action: 'openOmnibar', type: 'Tabs', extra: { action: 'gather' } }],
        [':', { action: 'openOmnibar', type: 'Commands' }],
        ['om', { action: 'openOmnibar', type: 'VIMarks' }],
        ['H', { action: 'openOmnibar', type: 'TabURLs' }],
        [';x', { action: 'openOmnibar', type: 'CloseTabs' }],
        ['ab', { action: 'openOmnibar', type: 'AddBookmark', extra: { url: PAGE_URL, title: 'Fixture page' } }],
        ['A', { action: 'openOmnibar', type: 'LLMChat', extra: { url: PAGE_URL } }],
        ['og', { action: 'openOmnibar', type: 'SearchEngine', extra: 'g' }],
        ['od', { action: 'openOmnibar', type: 'SearchEngine', extra: 'd' }],
        [';T', { action: 'openOmnibar', type: 'Themes' }],
        ['T', { action: 'chooseTab' }],
        [';G', { action: 'groupTab' }],
        ['/', { action: 'openFinder' }],
        ['g0', { action: 'executeCommand', cmdline: 'feedkeys 99E' }],
        ['g$', { action: 'executeCommand', cmdline: 'feedkeys 99R' }],
        ['ZQ', { action: 'executeCommand', cmdline: 'quit' }],
        [';pa', { action: 'executeCommand', cmdline: 'setProxyMode always' }],
        [';pb', { action: 'executeCommand', cmdline: 'setProxyMode byhost' }],
        [';pd', { action: 'executeCommand', cmdline: 'setProxyMode direct' }],
        [';ps', { action: 'executeCommand', cmdline: 'setProxyMode system' }],
        [';pc', { action: 'executeCommand', cmdline: 'setProxyMode clear' }],
        [';u', { action: 'showEditor', type: 'url', content: PAGE_URL }],
        [';U', { action: 'showEditor', type: 'url', content: PAGE_URL }],
        ['<Alt-q>', { action: 'openSwitcher', backward: false, session: expect.any(String) }],
        ['<Alt-Q>', { action: 'openSwitcher', backward: true, session: expect.any(String) }],
    ])('%s asks for %o', (keys, request) => {
        h.press(keys);
        expect(uiRequests()).toEqual([expect.objectContaining(request)]);
        expect(requests()).toEqual([]);
    });

    test('? shows the usage of every mode, built-in and fork mappings alike', () => {
        h.press('?');
        const [usage] = uiRequests();
        expect(usage.action).toBe('showUsage');
        expect(usage.metas).toEqual(expect.arrayContaining([
            expect.objectContaining({ word: 'x', annotation: ['Close current tab'] }),
            expect.objectContaining({ word: 'j', annotation: 'Scroll down' }),
            expect.objectContaining({ word: ';T', annotation: ['Choose a theme'] }),
        ]));
    });

    test.each(['<Ctrl-P>', '<Meta-P>'])('%s opens the palette and hands it the keys typed right after', async (keys) => {
        // typed by the user: keys the page dispatches are never held
        h.press(keys, { trusted: true });
        // a trusted key also shows and hides the keystroke popup
        expect(uiRequests().filter((a) => !/Keystroke$/.test(a.action))).toEqual([expect.objectContaining({ action: 'togglePalette' })]);
        h.press('x', { trusted: true });
        // focus leaving the page ends the hold at once, instead of after 500 ms
        window.dispatchEvent(new Event('blur'));
        // handed over once the frontend is up (front.afterCommands)
        await h.settle();
        expect(requests().filter((m) => m.action === 'closeTab')).toEqual([]);
        // through the background, never the UI host's postMessage, which the page can use too
        expect(h.ui('paletteTypeAhead')).toEqual([]);
        expect(h.sent.filter((m) => /TypeAhead/.test(m.action))).toEqual([
            expect.objectContaining({ action: 'tabSwitcherPaletteTypeAhead', text: 'x' }),
        ]);
    });
});

describe('repeat counts', () => {
    test('a count above repeatThreshold asks first and sends nothing', () => {
        h.press('10x');
        expect(uiRequests()).toEqual([expect.objectContaining({
            action: 'showDialog',
            question: 'Do you really want to repeat this action (Close current tab) 10 times?',
        })]);
        expect(requests()).toEqual([]);
    });

    test('confirming the dialog sends the action with the whole count', () => {
        h.press('10x');
        h.message({ action: 'dialogResponse', result: 'Ok' });
        expect(requests()).toEqual([expect.objectContaining({ action: 'closeTab', repeats: 10 })]);
    });

    test('cancelling the dialog sends nothing, and the count is gone', () => {
        h.press('10x');
        h.message({ action: 'dialogResponse', result: 'Cancel' });
        expect(requests()).toEqual([]);
        h.press('x');
        expect(requests()).toEqual([expect.objectContaining({ action: 'closeTab', repeats: 1 })]);
    });

    test('Esc drops a count typed so far', () => {
        h.press('3<Esc>x');
        expect(requests()).toEqual([expect.objectContaining({ action: 'closeTab', repeats: 1 })]);
    });

    test('Esc drops a prefix typed so far', () => {
        h.press('g<Esc>x');
        expect(requests()).toEqual([expect.objectContaining({ action: 'closeTab', repeats: 1 })]);
    });

    test('with digitForRepeat off a digit is not a count', () => {
        h.settingsUpdated({ digitForRepeat: false });
        try {
            h.press('3x');
            expect(requests()).toEqual([expect.objectContaining({ action: 'closeTab', repeats: 1 })]);
        } finally {
            h.settingsUpdated({ digitForRepeat: true });
        }
    });

    test('. replays the last keys the background holds for this profile', () => {
        h.press('yT');
        // the background stores lastKeys and broadcasts them to every tab
        const [saved] = h.sent.filter((m) => m.action === 'localData');
        expect(saved.data).toEqual({ lastKeys: ['yT'] });
        h.settingsUpdated(saved.data);
        jest.useFakeTimers();
        try {
            h.press('.');
            expect(requests()).toEqual([]);
            jest.advanceTimersByTime(1);
            expect(requests()).toEqual([expect.objectContaining({ action: 'duplicateTab', active: false })]);
        } finally {
            jest.useRealTimers();
        }
    });

    test(';ql shows the last keys', () => {
        h.settingsUpdated({ lastKeys: ['yT'] });
        h.press(';ql');
        expect(h.ui('showPopup')).toEqual([expect.objectContaining({ content: 'yT' })]);
    });

    // lastKeys is "" (runtime.conf's default) until an action is recorded
    test(';ql and . with no last action say so, and do nothing', () => {
        h.settingsUpdated({ lastKeys: '' });
        jest.useFakeTimers();
        try {
            expect(() => h.press(';ql')).not.toThrow();
            expect(h.ui('showPopup')).toEqual([]);
            expect(h.ui('showBanner')).toEqual([expect.objectContaining({ content: 'No last action.' })]);
            expect(() => {
                h.press('.');
                jest.advanceTimersByTime(1);
            }).not.toThrow();
            expect(requests()).toEqual([]);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('marks', () => {
    test('m takes the next key as the mark name and says what it saved', () => {
        h.press('mb');
        expect(requests()).toEqual([expect.objectContaining({ action: 'addVIMark', mark: { b: expect.objectContaining({ url: PAGE_URL }) } })]);
        expect(h.ui('showBanner')).toEqual([expect.objectContaining({ content: `Mark 'b' added for: ${PAGE_URL}.` })]);
    });

    // "Jump to vim-like mark in new tab" must ask for one: the background reuses
    // an open tab for a request like the one ' sends
    test("<Ctrl-'> asks for a mark in a new tab, unlike '", () => {
        h.press("'a");
        const [sameTab] = requests();
        h.chrome.runtime.sendMessage.mockClear();
        h.press("<Ctrl-'>a");
        const [newTab] = requests();
        expect(newTab).toEqual(expect.objectContaining({ action: 'jumpVIMark', mark: 'a' }));
        expect(newTab).not.toEqual(sameTab);
    });
});

describe('copying', () => {
    beforeEach(() => {
        h.board.text = '';
    });

    test.each([
        ['yy', PAGE_URL],
        ['yl', 'Fixture page'],
        ['yh', 'localhost'],
        ['yf', JSON.stringify({ 'post::/login': { user: 'ann', tags: ['a', 'b'] } }, null, 4)],
        ['yp', JSON.stringify([{ 'post::http://localhost/login': 'user=ann&tags=a&tags=b' }], null, 4)],
    ])('%s copies %p', (keys, text) => {
        h.press(keys);
        expect(h.board.text).toBe(text);
        expect(h.ui('showBanner')).toEqual([expect.objectContaining({ content: `Copied: ${text}` })]);
    });

    test('ys copies the page source', () => {
        h.press('ys');
        expect(h.board.text).toMatch(/^<html>/);
        expect(h.board.text).toContain('<form method="post" action="/login">');
    });

    describe('with the tabs of this window', () => {
        const tabs = [
            { url: 'https://a.example/' },
            { url: 'https://b.example/', active: true },
            { url: 'https://c.example/' },
            { url: 'https://d.example/' },
        ];
        beforeAll(() => {
            h.answers.getTabs = () => ({ tabs });
        });
        afterAll(() => {
            delete h.answers.getTabs;
        });

        test('yY copies every tab URL, one per line', async () => {
            h.press('yY');
            await h.settle();
            expect(h.board.text).toBe(tabs.map((t) => t.url).join('\n'));
        });

        test('a count on yy copies that many URLs from the current tab on', async () => {
            h.press('2yy');
            await h.settle();
            expect(requests()).toEqual([expect.objectContaining({ action: 'getTabs' })]);
            expect(h.board.text).toBe('https://b.example/\nhttps://c.example/');
        });
    });

    test('yj copies the raw settings the background answers', async () => {
        const raw = { smoothScroll: false, blocklist: { 'https://a.example': 1 } };
        const answer = h.answers.getSettings;
        h.answers.getSettings = (m) => (m.key === 'RAW' ? { settings: raw } : answer(m));
        try {
            h.press('yj');
            await h.settle();
            expect(requests()).toEqual([expect.objectContaining({ action: 'getSettings', key: 'RAW' })]);
            expect(h.board.text).toBe(JSON.stringify(raw, null, 4));
        } finally {
            h.answers.getSettings = answer;
        }
    });
});

describe('what the page gets', () => {
    let seen;
    const onKey = (e) => seen.push(e.key);
    beforeEach(() => {
        seen = [];
        document.addEventListener('keydown', onKey);
    });
    afterEach(() => {
        document.removeEventListener('keydown', onKey);
    });

    test('an unmapped key reaches the page untouched', () => {
        const [down] = h.press('K');
        expect(seen).toEqual(['K']);
        expect(down.defaultPrevented).toBe(false);
        expect(requests()).toEqual([]);
    });

    test('a mapped key never reaches the page', () => {
        const [down] = h.press('x');
        expect(seen).toEqual([]);
        expect(down.defaultPrevented).toBe(true);
    });

    test('every key of a sequence is kept from the page', () => {
        const downs = h.press('gxx');
        expect(seen).toEqual([]);
        expect(downs.map((e) => e.defaultPrevented)).toEqual([true, true, true]);
    });
});
