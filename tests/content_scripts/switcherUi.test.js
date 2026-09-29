// The Visual Tab Switcher strip (ui/tabSwitcher.js) in the real frontend: which
// card starts selected, how keys, clicks and the Alt release move and commit,
// and what closes it without switching.
import { bootFrontend } from '../helpers/bootFrontend.js';
import { BOOT_TIMEOUT } from '../helpers/jsdomEnv.js';

// MRU order as background/tabSwitcher.js answers it: the switcher's own tab first
const tab = (id, title, url, extra) => Object.assign({ id, windowId: 1, title, url, favIconUrl: '' }, extra);
const TABS = [
    tab(1, 'Here', 'https://here.test/', { current: true }),
    tab(2, 'Previous', 'https://prev.test/'),
    tab(3, 'Older', 'https://older.test/', { windowId: 2 }),
    tab(4, 'Oldest', 'https://oldest.test/'),
];

let f, list, session = 0;

const ui = () => document.getElementById('sk_switcher');
const cards = () => Array.from(ui().querySelectorAll('.sk_switcher_card'));
const selected = () => cards().findIndex((c) => c.classList.contains('selected'));
const isOpen = () => ui().style.display !== 'none';
const sentAll = (action) => f.sent.filter((m) => m.action === action);
const tabsRequests = () => f.held.filter((h) => h.message.action === 'tabSwitcherTabs');

// as the page's host.command sends it (content_scripts/tabSwitcher.js)
async function open({ backward = false, held = false } = {}) {
    if (held) {
        delete f.answers.tabSwitcherTabs;
    }
    const id = 'session' + (++session);
    f.post({ action: 'openSwitcher', backward, session: id });
    await f.settle();
    return id;
}

function answerTabs(tabs = list) {
    tabsRequests().pop().respond({ tabs });
    return f.settle();
}

// the Alt release a page frame relays through the background
const modifierUp = (id, at) => f.deliver({ subject: 'tabSwitcherModifierUp', session: id, at });

function expectSwitchedTo(id) {
    const focus = sentAll('focusTab');
    expect(focus).toHaveLength(1);
    expect(focus[0]).toEqual(expect.objectContaining({ tabId: id, windowId: list.find((t) => t.id === id).windowId }));
    expect(isOpen()).toBe(false);
}

function expectClosedWithoutSwitch() {
    expect(sentAll('focusTab')).toHaveLength(0);
    expect(isOpen()).toBe(false);
}

beforeAll(async () => {
    f = await bootFrontend();
    jest.spyOn(window, 'postMessage').mockImplementation(() => {});
    f.post({ action: 'initFrontend', origin: 'http://localhost', winSize: [1280, 800] });
    // select() scrolls the card into view, which jsdom does not implement
    Element.prototype.scrollIntoView = jest.fn();
}, BOOT_TIMEOUT);

beforeEach(() => {
    list = TABS;
    f.held.length = 0;
    f.answers.tabSwitcherTabs = () => ({ tabs: list });
    f.answers.tabSwitcherThumbnails = () => ({ thumbs: {} });
});

afterEach(async () => {
    f.Front.hidePopup();
    await f.settle();
});

describe('opening', () => {
    test('draws a card per tab, the previous tab selected', async () => {
        await open();
        expect(isOpen()).toBe(true);
        expect(cards().map((c) => c.dataset.tabId)).toEqual(['1', '2', '3', '4']);
        expect(cards().map((c) => c.querySelector('.sk_switcher_title').textContent)).toEqual(['Here', 'Previous', 'Older', 'Oldest']);
        expect(selected()).toBe(1);
        expect(cards()[1].getAttribute('aria-selected')).toBe('true');
    });

    test('backward selects the last tab', async () => {
        await open({ backward: true });
        expect(selected()).toBe(3);
    });

    test('with a single tab selects it', async () => {
        list = TABS.slice(0, 1);
        await open();
        expect(selected()).toBe(0);
    });

    test('a hostile title is shown as text, and no title falls back to the host', async () => {
        list = [TABS[0], tab(9, '<img src=x onerror=alert(1)>', 'https://evil.test/'), tab(10, '', 'https://www.plain.test/p')];
        await open();
        const titles = cards().map((c) => c.querySelector('.sk_switcher_title'));
        expect(titles[1].textContent).toBe('<img src=x onerror=alert(1)>');
        expect(titles[1].children).toHaveLength(0);
        expect(titles[2].textContent).toBe('plain.test');
        expect(cards()[1].querySelector('.sk_switcher_host').textContent).toBe('evil.test');
    });

    test('a thumbnail is used only for the page the tab still shows', async () => {
        f.answers.tabSwitcherThumbnails = (msg) => ({
            thumbs: {
                2: { url: 'https://prev.test/', thumb: 'data:image/webp;base64,AAAA' },
                3: { url: 'https://older.test/before', thumb: 'data:image/webp;base64,BBBB' },
            },
            asked: msg.tabIds,
        });
        await open();
        expect(sentAll('tabSwitcherThumbnails')[0].tabIds).toEqual([1, 2, 3, 4]);
        const shot = (i) => cards()[i].querySelector('img.sk_switcher_shot');
        expect(shot(1).getAttribute('src')).toBe('data:image/webp;base64,AAAA');
        expect(cards()[1].classList.contains('has-shot')).toBe(true);
        expect(shot(2)).toBeNull();
        expect(cards()[2].classList.contains('has-shot')).toBe(false);
    });

    test('pressed again while open moves instead of redrawing', async () => {
        await open();
        const first = cards()[0];
        f.post({ action: 'openSwitcher', backward: false, session: 'again' });
        await f.settle();
        expect(selected()).toBe(2);
        expect(cards()[0]).toBe(first);
        expect(sentAll('tabSwitcherTabs')).toHaveLength(1);
    });

    test('a tab list that comes after the strip closed is ignored', async () => {
        await open({ held: true });
        f.Front.hidePopup();
        await answerTabs();
        expect(cards()).toHaveLength(0);
        expect(sentAll('tabSwitcherThumbnails')).toHaveLength(0);
    });
});

describe('moving', () => {
    test.each([
        ['<Alt-q>', 2],
        ['<Alt-Q>', 0],
        ['<Tab>', 2],
        ['<Shift-Tab>', 0],
        ['<ArrowRight>', 2],
        ['<ArrowDown>', 2],
        ['<ArrowLeft>', 0],
        ['<ArrowUp>', 0],
    ])('%s moves to card %i', async (key, to) => {
        await open();
        const [down] = f.press(key);
        expect(selected()).toBe(to);
        expect(down.defaultPrevented).toBe(true);
        expect(isOpen()).toBe(true);
    });

    test('moves wrap around both ends', async () => {
        await open();
        f.press('<Alt-q><Alt-q><Alt-q>');
        expect(selected()).toBe(0);
        f.press('<Alt-Q>');
        expect(selected()).toBe(3);
    });

    test('Alt-q presses before the tab list add up', async () => {
        await open({ held: true });
        f.press('<Alt-q><Alt-q>');
        expect(cards()).toHaveLength(0);
        await answerTabs();
        expect(selected()).toBe(3);
    });

    test('a key the strip does not use reaches nothing else ("x" would close the tab)', async () => {
        await open();
        const [down] = f.press('x');
        expect(down.sk_suppressed).toBe(true);
        expect(f.sent.filter((m) => m.action !== 'tabSwitcherThumbnails' && m.action !== 'tabSwitcherTabs')).toEqual([]);
        expect(isOpen()).toBe(true);
        expect(selected()).toBe(1);
    });

    test('the first mousemove does not steal the preselection, a real move does', async () => {
        await open();
        const move = (x) => cards()[3].dispatchEvent(new MouseEvent('mousemove', { bubbles: true, screenX: x, screenY: 5 }));
        move(10);
        expect(selected()).toBe(1);
        move(10);
        expect(selected()).toBe(1);
        move(11);
        expect(selected()).toBe(3);
    });
});

describe('committing', () => {
    test('Enter switches to the selected tab and closes', async () => {
        await open();
        f.press('<Alt-q><Enter>');
        expectSwitchedTo(3);
    });

    test('Enter on the current tab closes without switching', async () => {
        await open();
        f.press('<Alt-Q><Enter>');
        expectClosedWithoutSwitch();
    });

    test('Enter before the tab list switches once it arrives', async () => {
        await open({ held: true });
        f.press('<Enter>');
        expect(isOpen()).toBe(true);
        await answerTabs();
        expectSwitchedTo(2);
    });

    test('a click on a card switches to it', async () => {
        await open();
        cards()[2].click();
        expectSwitchedTo(3);
    });

    test('an Alt release relayed after the strip was drawn switches', async () => {
        const id = await open();
        modifierUp(id, performance.timeOrigin + performance.now() + 1);
        expectSwitchedTo(2);
    });

    test('an Alt release from before the strip was drawn leaves it open to pick from', async () => {
        const id = await open({ held: true });
        const before = performance.timeOrigin + performance.now() - 1;
        await answerTabs();
        modifierUp(id, before);
        expect(isOpen()).toBe(true);
        expect(sentAll('focusTab')).toHaveLength(0);
        f.press('<Enter>');
        expectSwitchedTo(2);
    });

    test('an Alt release before the tab list came leaves the strip open', async () => {
        const id = await open({ held: true });
        modifierUp(id, performance.timeOrigin + performance.now());
        await answerTabs();
        expect(isOpen()).toBe(true);
        expect(sentAll('focusTab')).toHaveLength(0);
    });

    test('a relay for another session, or with no time, switches nothing', async () => {
        const id = await open();
        const later = performance.timeOrigin + performance.now() + 1000;
        modifierUp('session-from-earlier', later);
        modifierUp(id, undefined);
        expect(isOpen()).toBe(true);
        expect(sentAll('focusTab')).toHaveLength(0);
    });

    test('a relay after the strip closed switches nothing', async () => {
        const id = await open();
        f.Front.hidePopup();
        modifierUp(id, performance.timeOrigin + performance.now() + 1000);
        expect(sentAll('focusTab')).toHaveLength(0);
    });

    test('Alt going up in this frame after the strip was drawn switches', async () => {
        await open();
        f.press('<Alt-q>');
        document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', keyCode: 18, bubbles: true }));
        expectSwitchedTo(3);
    });
});

describe('closing without a switch', () => {
    test('Esc', async () => {
        await open();
        f.press('<Esc>');
        expectClosedWithoutSwitch();
    });

    test('Esc while Alt is still held', async () => {
        await open();
        f.press('<Alt-Esc>');
        expectClosedWithoutSwitch();
    });

    test('a mousedown outside the strip', async () => {
        await open();
        ui().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expectClosedWithoutSwitch();
    });

    test('but not a mousedown on it', async () => {
        await open();
        cards()[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(isOpen()).toBe(true);
    });

    test('the window losing focus', async () => {
        await open();
        window.dispatchEvent(new Event('blur'));
        expectClosedWithoutSwitch();
    });

    test('closing clears the cards, and the next strip starts over', async () => {
        await open();
        f.press('<Alt-q>');
        f.press('<Esc>');
        expect(cards()).toHaveLength(0);
        await open();
        expect(selected()).toBe(1);
    });
});
