import { localizeAnnotation } from '../../../src/content_scripts/common/annotation.js';

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
        expect(localizeAnnotation((s) => s, ['{0}, again {0}', 'x'])).toBe('x, again x');
    });

    test('translates the format, never the arguments', () => {
        expect(localizeAnnotation(upper, ['search with {0}', 'duckduckgo'])).toBe('SEARCH WITH duckduckgo');
    });

    test('matches String.prototype.format, which the rest of the content scripts use', () => {
        jest.isolateModules(() => {
            jest.doMock('../../../src/content_scripts/common/runtime.js', () => ({
                RUNTIME: jest.fn(), dispatchSKEvent: jest.fn(), runtime: { conf: {} },
            }));
            require('../../../src/content_scripts/common/utils.js');
        });
        [['#8Open Omnibar for {0} Search', 'google'], ['{1} and {0}', 'a', 'b'], ['{0}{0}', '$&']].forEach((a) => {
            expect(localizeAnnotation((s) => s, a)).toBe(a[0].format(...a.slice(1)));
        });
    });
});
