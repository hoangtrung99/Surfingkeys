// The tab switcher strip (ui/tabSwitcher.js) when a tab it shows closes, and the
// page side (content_scripts/tabSwitcher.js) in a document that cannot show it.
const listeners = [];
global.chrome = {
    runtime: {
        id: 'surfingkeys-test',
        lastError: undefined,
        getURL: (p) => `chrome-extension://surfingkeys${p}`,
        sendMessage: jest.fn(),
        onMessage: {addListener: (fn) => listeners.push(fn)},
    },
};
// the strip scrolls the selected card into view, which jsdom does not lay out
Element.prototype.scrollIntoView = function() {};

const Mode = require('../../src/content_scripts/common/mode.js').default;
const createTabSwitcher = require('../../src/content_scripts/ui/tabSwitcher.js').default;
const installTabSwitcher = require('../../src/content_scripts/tabSwitcher.js').default;

Mode.init();

// what the background sends to the tab, as chrome.runtime.onMessage delivers it
function deliver(message) {
    const response = jest.fn();
    listeners.forEach((fn) => fn(message, {}, response));
    return response;
}

const TABS = [1, 2, 3, 4].map((id) => ({id, windowId: 1, url: `https://t${id}.example/`, title: `t${id}`, current: id === 1}));

describe('switcher strip, a tab closing while it is up', () => {
    let ui, front, answerTabs;
    beforeAll(() => {
        document.body.innerHTML = '<div id="sk_switcher" style="display: none"></div>';
        ui = document.getElementById('sk_switcher');
        front = {
            _actions: {},
            hidePopup: jest.fn(() => {
                ui.style.display = 'none';
                ui.onHide();
            }),
        };
        createTabSwitcher(front, (el, render) => {
            el.style.display = '';
            render();
        });
    });
    beforeEach(() => {
        answerTabs = null;
        chrome.runtime.sendMessage.mockImplementation((message, cb) => {
            if (message.action === 'tabSwitcherTabs') {
                answerTabs = cb;
            } else if (message.action === 'tabSwitcherThumbnails') {
                cb({thumbs: {}});
            }
        });
    });
    afterEach(() => {
        ui.style.display !== 'none' && front.hidePopup();
    });

    const open = () => front._actions.openSwitcher({session: 's' + Math.random(), backward: false});
    const cardIds = () => [...ui.querySelectorAll('.sk_switcher_card')].map((c) => +c.dataset.tabId);
    const selectedId = () => +ui.querySelector('.sk_switcher_card.selected').dataset.tabId;
    const focused = () => chrome.runtime.sendMessage.mock.calls.filter(([m]) => m.action === 'focusTab').map(([m]) => m.tabId);
    const press = (key) => window.dispatchEvent(new KeyboardEvent('keydown', {key, keyCode: key === 'Enter' ? 13 : 0, bubbles: true}));

    it('asks for the tab list as the switcher, so the background reports closed tabs', () => {
        open();
        expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({action: 'tabSwitcherTabs', switcher: true}), expect.any(Function));
    });

    it('drops the selected card and selects the one that takes its place', () => {
        open();
        answerTabs({tabs: TABS});
        expect(selectedId()).toBe(2);
        deliver({subject: 'tabSwitcherTabRemoved', tabId: 2});
        expect(cardIds()).toEqual([1, 3, 4]);
        expect(selectedId()).toBe(3);
        press('Enter');
        expect(focused()).toEqual([3]);
    });

    it('keeps the selection on its card when an earlier one goes', () => {
        open();
        answerTabs({tabs: TABS});
        press('ArrowRight');
        expect(selectedId()).toBe(3);
        deliver({subject: 'tabSwitcherTabRemoved', tabId: 2});
        expect(selectedId()).toBe(3);
    });

    it('selects the new last card when the last one goes', () => {
        open();
        answerTabs({tabs: TABS});
        press('ArrowLeft');
        press('ArrowLeft');
        expect(selectedId()).toBe(4);
        deliver({subject: 'tabSwitcherTabRemoved', tabId: 4});
        expect(cardIds()).toEqual([1, 2, 3]);
        expect(selectedId()).toBe(3);
    });

    it('leaves out a tab that closed before the list arrived', () => {
        open();
        deliver({subject: 'tabSwitcherTabRemoved', tabId: 2});
        answerTabs({tabs: TABS});
        expect(cardIds()).toEqual([1, 3, 4]);
        expect(selectedId()).toBe(3);
    });

    it('a click still picks the card clicked once cards before it are gone', () => {
        open();
        answerTabs({tabs: TABS});
        deliver({subject: 'tabSwitcherTabRemoved', tabId: 2});
        ui.querySelectorAll('.sk_switcher_card')[2].click();
        expect(focused()).toEqual([4]);
    });

    it('ignores a closed tab while the strip is hidden', () => {
        open();
        answerTabs({tabs: TABS});
        front.hidePopup();
        deliver({subject: 'tabSwitcherTabRemoved', tabId: 2});
        open();
        answerTabs({tabs: TABS});
        expect(cardIds()).toEqual([1, 2, 3, 4]);
    });
});

describe('page side, a document that cannot show the UI', () => {
    const host = {command: jest.fn()};
    beforeAll(() => {
        installTabSwitcher({mapkey: jest.fn()}, host);
    });

    it('answers shown:false and holds no keys when there is no <body>', () => {
        const body = document.body;
        document.documentElement.removeChild(body);
        try {
            const switcher = deliver({subject: 'tabSwitcherCommand', action: 'openSwitcher'});
            const palette = deliver({subject: 'tabSwitcherCommand', action: 'openPalette'});
            expect(switcher).toHaveBeenCalledWith({shown: false});
            expect(palette).toHaveBeenCalledWith({shown: false});
            expect(host.command).not.toHaveBeenCalled();
            expect(Mode.getCurrent() && Mode.getCurrent().name).not.toBe('PaletteTypeAhead');
        } finally {
            document.documentElement.appendChild(body);
        }
    });

    it('answers as before, and opens the switcher, on an ordinary page', () => {
        const response = deliver({subject: 'tabSwitcherCommand', action: 'openSwitcher'});
        expect(response).toHaveBeenCalledWith({});
        expect(host.command).toHaveBeenCalledWith(expect.objectContaining({action: 'openSwitcher'}));
    });
});

describe('page side, whether a panel is up', () => {
    // a frontend host as uiframe.js builds it, its frame interactive
    function uiHost() {
        const el = document.createElement('div');
        el.attachShadow({mode: 'open'});
        const ifr = document.createElement('iframe');
        ifr.className = 'sk_ui';
        ifr.style.pointerEvents = 'all';
        el.shadowRoot.appendChild(ifr);
        return el;
    }
    function withFullscreen(el, run) {
        Object.defineProperty(document, 'fullscreenElement', {configurable: true, get: () => el});
        try {
            run();
        } finally {
            delete document.fullscreenElement;
        }
    }
    const visible = () => deliver({subject: 'tabSwitcherUiVisible'}).mock.calls[0][0].visible;

    it('finds the host moved into the element in fullscreen', () => {
        const player = document.createElement('div');
        const host = uiHost();
        player.appendChild(host);
        document.body.appendChild(player);
        try {
            withFullscreen(player, () => expect(visible()).toBe(true));
        } finally {
            player.remove();
        }
    });

    it('finds it in an element in fullscreen inside a shadow root', () => {
        const player = document.createElement('x-player');
        player.attachShadow({mode: 'open'});
        const inner = document.createElement('div');
        player.shadowRoot.appendChild(inner);
        inner.appendChild(uiHost());
        Object.defineProperty(player.shadowRoot, 'fullscreenElement', {get: () => inner});
        document.body.appendChild(player);
        try {
            withFullscreen(player, () => expect(visible()).toBe(true));
        } finally {
            player.remove();
        }
    });
});
