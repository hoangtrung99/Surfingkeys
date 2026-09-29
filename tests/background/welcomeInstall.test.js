// What installing and updating the extension opens (background/tabSwitcher.js).
import installTabSwitcher from '../../src/background/tabSwitcher.js';
import { createChromeMock } from './chromeMock.js';

function boot(commands) {
    const chrome = createChromeMock();
    chrome.windows.WINDOW_ID_NONE = -1;
    chrome.windows.getLastFocused = jest.fn((cb) => cb({id: 1}));
    chrome.commands.getAll = jest.fn((cb) => cb(commands));
    global.chrome = chrome;
    installTabSwitcher({}, (message, sendResponse, result) => sendResponse(result));
    return chrome;
}

const UNASSIGNED = [{name: 'commandPalette', shortcut: ''}, {name: 'tabSwitcher', shortcut: 'Alt+Q'}];
const ASSIGNED = [{name: 'commandPalette', shortcut: 'Ctrl+Shift+K'}, {name: 'tabSwitcher', shortcut: 'Alt+Q'}];

describe('install', () => {
    it.each([
        ['every shortcut got its key', ASSIGNED],
        ['a shortcut was left without a key', UNASSIGNED],
    ])('opens the welcome page, and only that, when %s', (what, commands) => {
        const chrome = boot(commands);
        chrome.runtime.onInstalled.fire({reason: 'install'});
        expect(chrome.tabs.create.mock.calls.map((c) => c[0].url)).toEqual(['chrome-extension://surfingkeys/pages/start.html#welcome']);
    });

    it.each(['update', 'chrome_update', 'shared_module_update'])('opens nothing on %s', (reason) => {
        const chrome = boot(UNASSIGNED);
        chrome.runtime.onInstalled.fire({reason, previousVersion: '1.0.0'});
        expect(chrome.tabs.create).not.toHaveBeenCalled();
    });
});
