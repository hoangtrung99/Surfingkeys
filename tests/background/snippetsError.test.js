// The settings snippet in MV3: registered as text that api.js compiles inside its
// own try, and an error it throws in a page kept for the settings page.
import { start } from '../../src/background/start.js';
import { snippetsRevision } from '../../src/common/utils.js';
import { createBrowserStub, createChromeMock } from './chromeMock.js';

const TAB = {id: 12, index: 0, windowId: 1, url: 'https://b.example/', active: true};

function bootstrap({settings = {}, session = null} = {}) {
    const chrome = createChromeMock({tabs: [{...TAB}]});
    if (session) {
        chrome.storage.session = session;
    }
    global.chrome = chrome;
    start(createBrowserStub({settings}));
    const dispatch = (message, sender = {tab: {...TAB}, frameId: 0, url: TAB.url}) => {
        const sendResponse = jest.fn();
        chrome.runtime.onMessage.listeners[0](message, sender, sendResponse);
        return sendResponse;
    };
    const fullSettings = () => dispatch({action: 'getSettings', needResponse: true}).mock.calls[0][0].settings;
    return {chrome, dispatch, fullSettings};
}

function sessionArea() {
    const data = {};
    return {
        data,
        get: jest.fn((key, cb) => cb(key in data ? {[key]: data[key]} : {})),
        set: jest.fn((items, cb) => {
            Object.assign(data, items);
            cb && cb();
        }),
    };
}

describe('settings snippet registration', () => {
    it('hands the snippet to api.js as text, so a syntax error in it cannot stop the script parsing', async () => {
        const snippets = 'this is not javascript(\n"quoted" \\ `tick` ${x} </script>';
        const {chrome, fullSettings} = bootstrap({settings: {showAdvanced: true, snippets}});
        fullSettings();
        const code = chrome.userScripts.register.mock.calls[0][0][0].js[0].code;
        let handed;
        const api = {default: (root, text) => {
            handed = text;
        }};
        // run the registered script with api.js stubbed: it parses, and passes the text on unchanged
        await new Function('api', `return ${code.replace("import('./api.js')", 'Promise.resolve(api)')}`)(api);
        expect(handed).toBe(snippets);
    });

    it('configures the world for eval before registering, whatever set it up before', () => {
        const {chrome, fullSettings} = bootstrap({settings: {showAdvanced: true, snippets: 'api.map("a", "b");'}});
        fullSettings();
        expect(chrome.userScripts.configureWorld).toHaveBeenCalledWith(
            expect.objectContaining({csp: expect.stringContaining("'unsafe-eval'"), messaging: true}));
        expect(chrome.userScripts.configureWorld.mock.invocationCallOrder[0])
            .toBeLessThan(chrome.userScripts.register.mock.invocationCallOrder[0]);
    });
});

describe('snippet errors reported by pages', () => {
    const snippets = 'api.map("a", "b");\nthis is not javascript(';

    it('are handed to the settings page by getSettings', () => {
        const {dispatch, fullSettings} = bootstrap({settings: {showAdvanced: true, snippets}});
        dispatch({action: 'reportSnippetsError', error: 'SyntaxError: Unexpected identifier', rev: snippetsRevision(snippets)});
        expect(fullSettings().snippetsError).toEqual({
            error: 'SyntaxError: Unexpected identifier',
            url: TAB.url,
            at: expect.any(Number),
        });
    });

    it('are dropped once the saved snippet is another one', () => {
        const {dispatch, fullSettings} = bootstrap({settings: {showAdvanced: true, snippets: 'api.map("a", "b");'}});
        dispatch({action: 'reportSnippetsError', error: 'SyntaxError: old', rev: snippetsRevision(snippets)});
        expect(fullSettings()).not.toHaveProperty('snippetsError');
    });

    it('are not handed out while advanced mode is off', () => {
        const {dispatch, fullSettings} = bootstrap({settings: {showAdvanced: false, snippets}});
        dispatch({action: 'reportSnippetsError', error: 'SyntaxError: x', rev: snippetsRevision(snippets)});
        expect(fullSettings()).not.toHaveProperty('snippetsError');
    });

    it('outlive the worker in storage.session', () => {
        const session = sessionArea();
        const first = bootstrap({settings: {showAdvanced: true, snippets}, session});
        first.dispatch({action: 'reportSnippetsError', error: 'SyntaxError: x', rev: snippetsRevision(snippets)});
        expect(session.data.snippetsError).toMatchObject({error: 'SyntaxError: x'});
        // a new worker, the same session
        const second = bootstrap({settings: {showAdvanced: true, snippets}, session});
        expect(second.fullSettings().snippetsError).toMatchObject({error: 'SyntaxError: x', url: TAB.url});
    });
});

describe('snippetsRevision', () => {
    it('tells snippets apart and is stable', () => {
        expect(snippetsRevision('a')).toBe(snippetsRevision('a'));
        expect(snippetsRevision('a')).not.toBe(snippetsRevision('b'));
        expect(snippetsRevision('ab')).not.toBe(snippetsRevision('ba'));
    });
});
