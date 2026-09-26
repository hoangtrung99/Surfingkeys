// api.js (src/user_scripts/index.js) runs the settings snippet it is handed as text:
// a syntax error in it is caught, shown, and reported to the background like any
// other error, where pasting the text into the registered script lost it silently.
global.chrome = {
    runtime: {
        id: 'surfingkeys-test',
        lastError: undefined,
        getURL: (p) => `chrome-extension://surfingkeys${p}`,
        sendMessage: jest.fn(),
        onMessage: {addListener: () => {}},
    },
};

const runSnippets = require('../../src/user_scripts/index.js').default;
const { snippetsRevision } = require('../../src/common/utils.js');

const ROOT = 'chrome-extension://surfingkeys/';

function frontEvents() {
    const seen = [];
    const listener = (e) => seen.push(e.detail);
    document.addEventListener('surfingkeys:front', listener);
    return {seen, stop: () => document.removeEventListener('surfingkeys:front', listener)};
}
const reports = () => chrome.runtime.sendMessage.mock.calls.map(([m]) => m).filter((m) => m.action === 'reportSnippetsError');

describe('the settings snippet as text', () => {
    it('shows a syntax error and reports it with the revision of the text that ran', () => {
        const events = frontEvents();
        const snippets = 'settings.scrollStepSize = 140;\nthis is not javascript(';
        runSnippets(ROOT, snippets);
        events.stop();
        const popup = events.seen.find((d) => d[0] === 'showPopup');
        expect(popup && popup[1]).toMatch(/^\[SurfingKeys\] Error found in settings: SyntaxError/);
        expect(reports()).toEqual([expect.objectContaining({error: expect.stringMatching(/^SyntaxError/), rev: snippetsRevision(snippets)})]);
    });

    it('runs a valid snippet with api and settings in scope', () => {
        const events = frontEvents();
        runSnippets(ROOT, 'settings.scrollStepSize = typeof api.mapkey === "function" ? 140 : 0;');
        events.stop();
        expect(events.seen).toContainEqual(['applySettingsFromSnippets', {scrollStepSize: 140}]);
        expect(reports()).toEqual([]);
    });

    it('still runs the function a script registered by an older version hands over', () => {
        const events = frontEvents();
        runSnippets(ROOT, (api, settings) => {
            settings.scrollStepSize = 90;
        });
        events.stop();
        expect(events.seen).toContainEqual(['applySettingsFromSnippets', {scrollStepSize: 90}]);
    });

    it('reports a runtime error of an older function without a revision', () => {
        runSnippets(ROOT, () => {
            throw new Error('boom');
        });
        expect(reports()).toEqual([expect.objectContaining({error: 'Error: boom', rev: undefined})]);
    });
});
