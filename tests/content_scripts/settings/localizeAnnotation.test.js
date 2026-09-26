import { localizeAnnotation } from '../../../src/content_scripts/common/utils.js';

// runtime.js talks to the extension as it loads
jest.mock('../../../src/content_scripts/common/runtime.js', () => ({
    RUNTIME: jest.fn(),
    dispatchSKEvent: jest.fn(),
    runtime: { conf: {} },
}));

describe('localizeAnnotation', () => {
    const upper = (s) => s.toUpperCase();

    test('translates a plain annotation', () => {
        expect(localizeAnnotation((s) => s, '#3Close current tab')).toBe('#3Close current tab');
        expect(localizeAnnotation(upper, 'scroll down')).toBe('SCROLL DOWN');
    });

    test('fills the format string of an array annotation with its arguments', () => {
        expect(localizeAnnotation((s) => s, ['#8Open Omnibar for {0} Search', 'google']))
            .toBe('#8Open Omnibar for google Search');
        expect(localizeAnnotation((s) => s, ['{1} and {0}', 'a', 'b'])).toBe('b and a');
    });

    test('translates the format, never the arguments', () => {
        expect(localizeAnnotation(upper, ['search with {0}', 'duckduckgo'])).toBe('SEARCH WITH duckduckgo');
    });
});
