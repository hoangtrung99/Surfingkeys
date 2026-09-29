// A content script left running in a page across an extension reload or update
// is cut off: chrome.runtime.id is gone and every chrome.runtime call throws.
// Such a copy must go inert and give the page its keys and messages back
// (mode.js isOrphaned/retire, front.js, runtime.js).
//
// Retiring removes Mode's window listeners for good, so this file boots its own
// page and the orphaned cases come last.
import { bootContent } from '../helpers/bootContent.js';
import { BOOT_TIMEOUT } from '../helpers/jsdomEnv.js';

let h, extensionId;
beforeAll(async () => {
    h = await bootContent();
    extensionId = h.chrome.runtime.id;
}, BOOT_TIMEOUT);

let pageKeys, pageMessages;
const onKey = (e) => pageKeys.push(e.key);
const onMessage = (e) => pageMessages.push(e.data);
beforeEach(() => {
    pageKeys = [];
    pageMessages = [];
    document.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
});
afterEach(() => {
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('message', onMessage);
});

// the frontend reporting the item picked in a UserURLs omnibar
const PICKED = { action: 'userURLs_entered', item: { url: 'https://a.example/' }, ctrlKey: false, tabbed: true };

describe('while the extension is there', () => {
    test('a mapped key acts and the page never sees it', () => {
        const [down] = h.press('x');
        expect(h.sent).toEqual([expect.objectContaining({ action: 'closeTab' })]);
        expect(pageKeys).toEqual([]);
        expect(down.defaultPrevented).toBe(true);
    });

    test('a message from the frontend is handled and kept from the page', () => {
        h.message(PICKED);
        expect(h.sent).toEqual([expect.objectContaining({ action: 'openLink', url: 'https://a.example/' })]);
        expect(pageMessages).toEqual([]);
    });

    test('an answer that lands after the reload is dropped', () => {
        const callback = jest.fn();
        h.RUNTIME('getTabs', {}, callback);
        const { respond } = h.held.pop();
        delete h.chrome.runtime.id;
        try {
            respond({ tabs: [] });
        } finally {
            h.chrome.runtime.id = extensionId;
        }
        expect(callback).not.toHaveBeenCalled();
    });

    test('an answer that comes with lastError is dropped', () => {
        const callback = jest.fn();
        h.RUNTIME('getTabs', {}, callback);
        const { respond } = h.held.pop();
        h.chrome.runtime.lastError = { message: 'The message port closed before a response was received.' };
        try {
            respond(undefined);
        } finally {
            h.chrome.runtime.lastError = undefined;
        }
        expect(callback).not.toHaveBeenCalled();
    });

    test('an answer while connected is handed over', () => {
        const callback = jest.fn();
        h.RUNTIME('getTabs', {}, callback);
        h.held.pop().respond({ tabs: [] });
        expect(callback).toHaveBeenCalledWith({ tabs: [] });
    });
});

describe('once chrome.runtime.id is gone', () => {
    beforeAll(() => {
        delete h.chrome.runtime.id;
    });

    test('keys reach the page untouched and act on nothing', () => {
        const downs = h.press('xgxx');
        expect(h.sent).toEqual([]);
        expect(pageKeys).toEqual(['x', 'g', 'x', 'x']);
        expect(downs.some((e) => e.defaultPrevented)).toBe(false);
    });

    test('messages from the frontend are left to the page', () => {
        h.message(PICKED);
        expect(h.sent).toEqual([]);
        expect(pageMessages).toEqual([{ surfingkeys_content_data: PICKED }]);
    });

    test('the id coming back does not revive the keys', () => {
        h.press('x');
        h.chrome.runtime.id = extensionId;
        try {
            h.press('x');
            expect(h.sent).toEqual([]);
            expect(pageKeys).toEqual(['x', 'x']);
        } finally {
            delete h.chrome.runtime.id;
        }
    });
});
