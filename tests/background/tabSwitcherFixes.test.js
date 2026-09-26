// Background side of the tab switcher: the fallback when a page cannot show the
// UI, cards dropped for tabs that close while the strip is up, MRU ranking, and
// thumbnails decoded straight to their size.
import installTabSwitcher from '../../src/background/tabSwitcher.js';
import { createChromeMock, makeEvent } from './chromeMock.js';

const flush = async () => {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
};

function boot(tabs) {
    const chrome = createChromeMock({tabs});
    // what tabSwitcher.js needs beyond start.js
    chrome.windows.WINDOW_ID_NONE = -1;
    chrome.windows.getLastFocused = jest.fn((cb) => cb({id: 1}));
    chrome.tabs.get = jest.fn((id, cb) => {
        const t = chrome.state.tabs.find((x) => x.id === id);
        if (!t) {
            chrome.runtime.lastError = {message: `No tab with id: ${id}.`};
            cb(undefined);
            chrome.runtime.lastError = undefined;
            return;
        }
        cb({...t});
    });
    chrome.commands.getAll = jest.fn((cb) => cb([]));
    chrome.runtime.onInstalled = makeEvent();
    global.chrome = chrome;
    const self = {};
    installTabSwitcher(self, (message, sendResponse, result) => sendResponse(result));
    const activate = (tabId, windowId = 1) => chrome.tabs.onActivated.fire({tabId, windowId});
    const listTabs = (senderTab, message = {}) => {
        const sendResponse = jest.fn();
        self.tabSwitcherTabs(message, {tab: senderTab}, sendResponse);
        return sendResponse.mock.calls[0][0].tabs;
    };
    return {chrome, self, activate, listTabs};
}

const TABS = [
    {id: 1, windowId: 1, url: 'https://one.example/', title: 'one', lastAccessed: 10},
    {id: 2, windowId: 1, url: 'https://two.example/', title: 'two', lastAccessed: 20},
    {id: 3, windowId: 1, url: 'https://three.example/', title: 'three', lastAccessed: 30},
    {id: 4, windowId: 2, url: 'https://four.example/', title: 'four', lastAccessed: 40},
    {id: 5, windowId: 1, url: 'https://five.example/', title: 'five', lastAccessed: 5},
];

describe('a page that cannot show the switcher', () => {
    function command(name, answer) {
        const env = boot(TABS.map((t) => ({...t})));
        env.activate(2);
        env.activate(1);
        env.chrome.tabs.sendMessage = jest.fn((tabId, message, cb) => cb(answer));
        env.chrome.commands.onCommand.fire(name, {id: 1, windowId: 1});
        return env;
    }

    it('makes the switcher shortcut go back to the previous tab', () => {
        const {chrome} = command('tabSwitcher', {shown: false});
        expect(chrome.tabs.update).toHaveBeenCalledWith(2, {active: true});
    });

    it('leaves the tab alone when the page shows the switcher', () => {
        const {chrome} = command('tabSwitcher', {});
        expect(chrome.tabs.update).not.toHaveBeenCalled();
    });

    it('has no fallback for the palette', () => {
        const {chrome} = command('commandPalette', {shown: false});
        expect(chrome.tabs.update).not.toHaveBeenCalled();
    });
});

describe('a tab closed while the switcher is up', () => {
    it('is reported to the tab showing the switcher', () => {
        const {chrome, listTabs} = boot(TABS.map((t) => ({...t})));
        listTabs(TABS[0], {switcher: true});
        chrome.tabs.onRemoved.fire(3, {windowId: 1});
        expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
            1, {subject: 'tabSwitcherTabRemoved', tabId: 3}, expect.any(Function));
    });

    it('is not reported for a palette asking for the tab list', () => {
        const {chrome, listTabs} = boot(TABS.map((t) => ({...t})));
        listTabs(TABS[0]);
        chrome.tabs.onRemoved.fire(3, {windowId: 1});
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });

    it('stops being reported once the switcher tab itself closed', () => {
        const {chrome, listTabs} = boot(TABS.map((t) => ({...t})));
        listTabs(TABS[0], {switcher: true});
        chrome.tabs.onRemoved.fire(1, {windowId: 1});
        chrome.tabs.onRemoved.fire(3, {windowId: 1});
        expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    });
});

describe('tab order', () => {
    it('puts the asking tab first, then most recently used, then the rest by last access', () => {
        const {activate, listTabs} = boot(TABS.map((t) => ({...t})));
        activate(3);
        activate(1);
        activate(2);
        // unknown to the MRU list: 4 (40) before 5 (5)
        expect(listTabs(TABS[0]).map((t) => t.id)).toEqual([1, 2, 3, 4, 5]);
        expect(listTabs(TABS[2]).map((t) => t.id)).toEqual([3, 1, 2, 4, 5]);
    });
});

describe('thumbnails', () => {
    let bitmapOptions;
    beforeEach(() => {
        jest.useFakeTimers();
        bitmapOptions = [];
        global.fetch = jest.fn(() => Promise.resolve({blob: () => Promise.resolve({type: 'image/jpeg'})}));
        global.createImageBitmap = jest.fn((blob, options) => {
            bitmapOptions.push(options);
            const width = options ? options.resizeWidth : 2560;
            return Promise.resolve({width, height: Math.round(width * 0.625), close: jest.fn()});
        });
        global.OffscreenCanvas = class {
            constructor(w, h) {
                this.width = w;
                this.height = h;
            }
            getContext() {
                return {drawImage: jest.fn()};
            }
            convertToBlob() {
                return Promise.resolve({type: 'image/webp'});
            }
        };
        global.FileReader = class {
            readAsDataURL() {
                this.result = 'data:image/webp;base64,AAAA';
                this.onload();
            }
        };
    });
    afterEach(() => {
        jest.useRealTimers();
        delete global.createImageBitmap;
        delete global.OffscreenCanvas;
    });

    async function captureWith(width) {
        const tabs = TABS.map((t) => ({...t, width, active: t.id === 2}));
        const {chrome, activate} = boot(tabs);
        chrome.tabs.sendMessage = jest.fn((tabId, message, options, cb) => cb({visible: false}));
        activate(2);
        jest.advanceTimersByTime(400);
        await flush();
        expect(chrome.tabs.captureVisibleTab).toHaveBeenCalled();
    }

    it('are decoded straight to their width from a window at least that wide', async () => {
        await captureWith(1280);
        expect(bitmapOptions).toEqual([{resizeWidth: 440, resizeQuality: 'medium'}]);
    });

    it('are never scaled up from a narrow window', async () => {
        await captureWith(300);
        expect(bitmapOptions).toEqual([undefined]);
    });
});
