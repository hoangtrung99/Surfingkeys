// The Command Palette in the real frontend (frontend.html + frontend.js in jsdom):
// what the page can post to it must not act, and the palette defects fixed with that.
const fs = require('fs');
const path = require('path');

const TABS = [
    { id: 1, windowId: 1, title: 'Current page', url: 'https://cur.example/', current: true },
    { id: 2, windowId: 1, title: 'Figma — Landing page v2', url: 'https://www.figma.com/design/landing-v2' },
    { id: 3, windowId: 1, title: 'Kế hoạch tuần', url: 'https://docs.google.com/document/d/x' },
];
const ALIASES = [
    { alias: 'g', prompt: 'google', url: 'https://www.google.com/search?q=' },
    { alias: 'd', prompt: 'duckduckgo', url: 'https://duckduckgo.com/?q=' },
];
const ACTION_COUNT = 28;

const sent = [];
const listeners = [];
let heldTabs = null;  // tabSwitcherTabs callbacks held back, to answer late

beforeAll(() => {
    jest.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Chrome/130.0');
    // htmlEncode reads innerText, which jsdom does not lay out
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
        configurable: true,
        get() { return this.textContent; },
        set(v) { this.textContent = v; },
    });
    const answers = {
        tabSwitcherTabs: () => ({ tabs: TABS.map((t) => ({ ...t })) }),
        getHistory: () => ({ history: [] }),
        getBookmarks: () => ({ bookmarks: [] }),
    };
    global.chrome = {
        runtime: {
            id: 'x',
            sendMessage: jest.fn((msg, cb) => {
                sent.push(msg);
                if (!cb || !answers[msg.action]) {
                    return;
                }
                if (msg.action === 'tabSwitcherTabs' && heldTabs) {
                    heldTabs.push(cb);
                } else {
                    setTimeout(() => cb(answers[msg.action](msg)), 0);
                }
            }),
            onMessage: { addListener: (fn) => listeners.push(fn) },
            getURL: (p) => 'chrome-extension://x/' + p.replace(/^\//, ''),
            getManifest: () => ({ version: '0' }),
        },
        storage: { local: { get: jest.fn() } },
    };
    const html = fs.readFileSync(path.resolve(__dirname, '../../src/content_scripts/ui/frontend.html'), 'utf8');
    document.documentElement.innerHTML = html.replace(/<!DOCTYPE html>/i, '');
    window.focus = jest.fn();
    require('../../src/content_scripts/ui/frontend.js');
    post({ action: 'initFrontend', origin: 'https://cur.example' });
    ALIASES.forEach((a) => post({ action: 'addSearchAlias', ...a }));
});

// what the page (or the content script) posts: both arrive the same way
function post(data) {
    window.dispatchEvent(new MessageEvent('message', { data: { surfingkeys_frontend_data: data } }));
}
// what the background sends (chrome.tabs.sendMessage), which the page cannot
function fromBackground(msg) {
    listeners.forEach((fn) => fn(msg, {}, () => {}));
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const omnibar = () => document.getElementById('sk_omnibar');
const input = () => omnibar().querySelector('#sk_omnibarSearchArea input');
const chip = () => omnibar().querySelector('#sk_omnibarSearchArea .prompt').textContent;
const isOpen = () => omnibar().style.display !== 'none' && omnibar().classList.contains('sk_palette');
const rows = () => [...omnibar().querySelectorAll('#sk_omnibarSearchResult li')].map((li) => ({
    kind: (li.className.match(/sk_palette_kind_(\w+)/) || [])[1],
    title: (li.querySelector('.sk_palette_title') || {}).textContent,
    label: (li.querySelector('.sk_palette_label') || {}).textContent,
}));
const acted = () => sent.filter((m) => ['openLink', 'focusTab', 'duplicateTab', 'toggleBlocklist', 'frontendRequest'].includes(m.action));
function press(key, keyCode) {
    input().dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true }));
}
function type(text) {
    input().value = text;
    input().dispatchEvent(new Event('input', { bubbles: true }));
}
async function openPalette() {
    post({ action: 'togglePalette' });
    await flush();
}

afterEach(async () => {
    heldTabs = null;
    post({ action: 'hidePopup' });
    await flush();
    sent.length = 0;
});

describe('what the page posts', () => {
    test('cannot type into the palette or press Enter in it', async () => {
        await openPalette();
        expect(isOpen()).toBe(true);
        post({ action: 'paletteTypeAhead', text: 'https://attacker.example/pwn', then: 'Enter' });
        post({ action: 'paletteTypeAhead', text: 'figma', then: 'Enter' });
        await flush();
        expect(input().value).toBe('');
        expect(acted()).toEqual([]);
        expect(isOpen()).toBe(true);
    });

    test('cannot pick the actions either', async () => {
        await openPalette();
        post({ action: 'paletteTypeAhead', text: '', then: 'Tab' });
        post({ action: 'paletteTypeAhead', text: 'duplicate', then: 'Enter' });
        await flush();
        expect(chip()).toBe('');
        expect(acted()).toEqual([]);
    });
});

describe('typed-ahead keys from the top frame (chrome.runtime)', () => {
    test('go in front of the input and run Enter', async () => {
        await openPalette();
        fromBackground({ subject: 'paletteTypeAhead', text: 'figma', then: 'Enter' });
        expect(acted()).toEqual([expect.objectContaining({ action: 'focusTab', tabId: 2 })]);
        expect(isOpen()).toBe(false);
    });

    test('wait for the open they beat', async () => {
        fromBackground({ subject: 'paletteTypeAhead', text: 'figma', then: 'Enter' });
        expect(acted()).toEqual([]);
        await openPalette();
        expect(acted()).toEqual([expect.objectContaining({ action: 'focusTab', tabId: 2 })]);
    });

    test('are dropped when no open follows soon', async () => {
        const now = Date.now();
        const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
        fromBackground({ subject: 'paletteTypeAhead', text: 'figma', then: 'Enter' });
        clock.mockReturnValue(now + 5000);
        await openPalette();
        clock.mockRestore();
        expect(input().value).toBe('');
        expect(acted()).toEqual([]);
        expect(isOpen()).toBe(true);
    });
});

describe('Tab before the tab list arrives', () => {
    test('lists the actions once it does', async () => {
        heldTabs = [];
        await openPalette();
        press('Tab', 9);
        expect(chip()).toBe('Actions');
        heldTabs.splice(0).forEach((cb) => cb({ tabs: TABS }));
        await flush();
        expect(chip()).toBe('Actions');
        expect(rows().filter((r) => r.kind === 'action')).toHaveLength(ACTION_COUNT);
    });

    test('and what is typed after it filters them', async () => {
        heldTabs = [];
        await openPalette();
        press('Tab', 9);
        type('dupl');
        heldTabs.splice(0).forEach((cb) => cb({ tabs: TABS }));
        await flush();
        expect(rows()[0]).toMatchObject({ kind: 'action', title: 'Duplicate Tab' });
    });

    test('typed ahead, it lists them too', async () => {
        heldTabs = [];
        await openPalette();
        fromBackground({ subject: 'paletteTypeAhead', text: '', then: 'Tab' });
        heldTabs.splice(0).forEach((cb) => cb({ tabs: TABS }));
        await flush();
        expect(chip()).toBe('Actions');
        expect(rows()).toHaveLength(ACTION_COUNT);
    });

    test('Tab on a typed query still does not', async () => {
        await openPalette();
        type('fig');
        press('Tab', 9);
        expect(chip()).toBe('');
    });
});

describe('the default search engine turned off', () => {
    afterEach(() => {
        ALIASES.forEach((a) => post({ action: 'addSearchAlias', ...a }));
    });

    test('searches with the first engine left', async () => {
        post({ action: 'removeSearchAlias', alias: 'g' });
        await openPalette();
        type('zzqx unicorn');
        expect(rows()).toEqual([{ kind: 'search', title: 'zzqx unicorn', label: 'Search Duckduckgo' }]);
        press('Enter', 13);
        expect(acted()).toEqual([expect.objectContaining({ action: 'openLink', url: 'https://duckduckgo.com/?q=zzqx%20unicorn' })]);
    });

    test('with no engine left, tab rows remain and Enter opens nothing', async () => {
        ALIASES.forEach((a) => post({ action: 'removeSearchAlias', alias: a.alias }));
        await openPalette();
        type('figma');
        expect(rows().map((r) => r.kind)).toEqual(['tab']);
        type('zzqx unicorn');
        expect(rows()).toEqual([]);
        press('Enter', 13);
        expect(acted()).toEqual([]);
    });
});

describe('settings actions', () => {
    async function runAction(query) {
        await openPalette();
        press('Tab', 9);
        type(query);
        const first = rows()[0];
        press('Enter', 13);
        return first;
    }

    test.each([
        ['settings', 'Settings…', '/pages/options.html'],
        ['settings appearance', 'Settings: Appearance', '/pages/options.html#appearance'],
        ['settings keys', 'Settings: Keys', '/pages/options.html#keys'],
        ['sites', 'Settings: Sites', '/pages/options.html#sites'],
        ['shortcuts', 'Keyboard Shortcuts…', 'chrome://extensions/shortcuts'],
    ])('"%s" finds %s, which opens %s', async (query, title, url) => {
        expect(await runAction(query)).toMatchObject({ kind: 'action', title });
        expect(acted()).toEqual([expect.objectContaining({ action: 'openLink', url, tab: { tabbed: true, active: true } })]);
        expect(isOpen()).toBe(false);
    });

    // both belong to the page: the blocklist toggle takes the sender's origin, which
    // from this frame would be the extension's, and would turn Surfingkeys off everywhere
    test.each([
        ['disable', 'Disable / Enable Surfingkeys on This Site', 'toggleBlocklist'],
        ['key mappings', 'Show All Key Mappings', 'showUsage'],
    ])('"%s" finds %s, which asks the page for %s', async (query, title, request) => {
        expect(await runAction(query)).toMatchObject({ kind: 'action', title });
        expect(acted()).toEqual([expect.objectContaining({ action: 'frontendRequest', request })]);
    });

    test('"theme" still finds Change Theme… first', async () => {
        await openPalette();
        press('Tab', 9);
        type('theme');
        expect(rows()[0].title).toBe('Change Theme…');
    });
});
