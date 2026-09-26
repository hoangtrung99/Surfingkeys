import { HOSTED_PATH, hostedUrl, isHostedSender, parseHostedUrl, popupBounds, surfaceOf } from '../../src/background/hostedUi.js';
import { PALETTES, THEME_IDS } from '../../src/content_scripts/common/themes.js';

const BASE = 'chrome-extension://abc/';
const FRONTEND = BASE + 'pages/frontend.html';

describe('hostedUrl / parseHostedUrl', () => {
    test('round trip', () => {
        const url = hostedUrl({ui: 'switcher', bg: '#1e1e2e', n: 'x1', surface: 'window'});
        expect(url.startsWith(HOSTED_PATH + '?')).toBe(true);
        expect(parseHostedUrl(BASE + url, BASE)).toEqual({ui: 'switcher', bg: '#1e1e2e', n: 'x1', surface: 'window'});
    });
    test('a bad colour or ui is dropped, the dropdown is the default surface', () => {
        const url = hostedUrl({ui: 'evil', bg: 'red;x', n: 'n'});
        expect(parseHostedUrl(BASE + url, BASE)).toEqual({ui: 'palette', bg: null, n: 'n', surface: 'popup'});
    });
    test('other URLs are not ours', () => {
        expect(parseHostedUrl(FRONTEND, BASE)).toBeNull();
        expect(parseHostedUrl('https://x.test/pages/palette.html', BASE)).toBeNull();
        expect(parseHostedUrl(undefined, BASE)).toBeNull();
    });
});

describe('isHostedSender', () => {
    const page = BASE + 'pages/palette.html?ui=palette&n=1';
    test.each([
        ['frontend in the dropdown (no tab)', {url: FRONTEND}, true],
        ['frontend in the fallback window', {url: FRONTEND, tab: {url: page}}, true],
        ['frontend in a web page', {url: FRONTEND, tab: {url: 'https://a.test/'}}, false],
        ['palette.html itself', {url: page, tab: {url: page}}, false],
        ['palette.html itself in the dropdown', {url: page}, false],
        ['a content script', {url: 'https://a.test/', tab: {url: 'https://a.test/'}}, false],
        ['no sender', undefined, false],
    ])('%s', (name, sender, expected) => {
        expect(isHostedSender(sender, BASE)).toBe(expected);
    });
});

describe('surfaceOf', () => {
    test.each(THEME_IDS)('%s gives a hex colour', (id) => {
        const c = surfaceOf(id);
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
        expect(c).toBe(PALETTES[id].surface || (PALETTES[id].light ? '#ffffff' : PALETTES[id].bg));
    });
    test('none is white, nothing picked is the default theme', () => {
        expect(surfaceOf('none')).toBe('#ffffff');
        expect(surfaceOf(undefined)).toBe(PALETTES.mocha.bg);
        expect(surfaceOf('no such theme')).toBe(PALETTES.mocha.bg);
    });
});

describe('popupBounds', () => {
    test('centred, a little below the top', () => {
        const b = popupBounds('palette', {left: 100, top: 50, width: 1440, height: 900});
        expect(b.width).toBe(720);
        expect(b.left).toBe(100 + (1440 - 720) / 2);
        expect(b.top).toBe(50 + 80);
    });
    test('kept inside a narrow window', () => {
        const b = popupBounds('palette', {left: 0, top: 0, width: 500, height: 400});
        expect(b.left).toBeGreaterThanOrEqual(0);
        expect(b.left + b.width).toBeLessThanOrEqual(500);
        expect(b.top + b.height).toBeLessThanOrEqual(400);
    });
    test('no position without a window to centre on', () => {
        expect(popupBounds('switcher', null)).toEqual({width: 800, height: 312});
    });
});
