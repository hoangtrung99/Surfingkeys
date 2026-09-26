// Every mapping is stored and matched as encodeKeystroke() output, one character
// per stroke; getKeyChar() turns a keydown into that notation. A stroke that
// does not survive encode -> decode can be mapped but never shown or unmapped.
import { installChromeMock, installJsdomShims } from '../helpers/jsdomEnv.js';

let KeyboardUtils;
beforeAll(() => {
    installJsdomShims();
    installChromeMock();
    // String.prototype.format, which getKeyChar uses, comes with utils.js
    require('../../src/content_scripts/common/utils.js');
    KeyboardUtils = require('../../src/content_scripts/common/keyboardUtils.js').default;
});

const roundTrip = (stroke) => KeyboardUtils.decodeKeystroke(KeyboardUtils.encodeKeystroke(stroke));
const mismatches = (strokes) => strokes.filter((s) => roundTrip(s) !== s);

describe('encodeKeystroke / decodeKeystroke', () => {
    const ALL_MODIFIERS = ['', 'Ctrl-', 'Alt-', 'Shift-', 'Meta-', 'Ctrl-Alt-', 'Ctrl-Shift-', 'Ctrl-Meta-', 'Alt-Shift-',
        'Alt-Meta-', 'Alt-Meta-Shift-', 'Meta-Shift-', 'Ctrl-Alt-Shift-', 'Ctrl-Alt-Meta-', 'Ctrl-Meta-Shift-', 'Ctrl-Alt-Meta-Shift-'];
    // Shift on a character is written as the shifted character itself
    const CHAR_MODIFIERS = ['Ctrl-', 'Alt-', 'Meta-', 'Ctrl-Alt-', 'Ctrl-Meta-', 'Alt-Meta-', 'Ctrl-Alt-Meta-'];
    const CHARS = Array.from({ length: 256 - 32 }, (_, i) => String.fromCharCode(32 + i));

    test.each(ALL_MODIFIERS)('every special key with %p round-trips', (mods) => {
        expect(mismatches(KeyboardUtils.specialKeys.map((k) => `<${mods}${k}>`))).toEqual([]);
    });

    test.each(CHAR_MODIFIERS)('every character 32-255 with %p round-trips', (mods) => {
        expect(mismatches(CHARS.map((c) => `<${mods}${c}>`))).toEqual([]);
    });

    test.each([
        '<Ctrl-Alt-Meta-m>0<Ctrl-Meta-i>',
        'ab<Ctrl-Meta-i>',
        '<Ctrl-Alt-Meta-m>334?',
        '<Ctrl->>?ee<Alt->>',
    ])('%p round-trips', (strokes) => {
        expect(roundTrip(strokes)).toBe(strokes);
    });

    test('each stroke is one character and no two strokes share it', () => {
        const strokes = [
            ...ALL_MODIFIERS.flatMap((m) => KeyboardUtils.specialKeys.map((k) => `<${m}${k}>`)),
            ...CHAR_MODIFIERS.flatMap((m) => CHARS.map((c) => `<${m}${c}>`)),
        ];
        const encoded = strokes.map((s) => KeyboardUtils.encodeKeystroke(s));
        expect(encoded.filter((e) => e.length !== 1)).toEqual([]);
        expect(new Set(encoded).size).toBe(strokes.length);
    });

    test('plain characters stay as they are', () => {
        expect(KeyboardUtils.encodeKeystroke('gxx;<>')).toBe('gxx;<>');
    });
});

describe('getKeyChar', () => {
    test.each([
        ['a letter', { key: 'a', keyCode: 65 }, 'a'],
        ['Shift on a letter', { key: 'A', keyCode: 65, shiftKey: true }, 'A'],
        ['Shift on punctuation', { key: '?', keyCode: 191, shiftKey: true }, '?'],
        ['Escape, by keyCode', { key: 'Escape', keyCode: 27 }, '<Esc>'],
        ['Space, by keyCode', { key: ' ', keyCode: 32, ctrlKey: true }, '<Ctrl-Space>'],
        ['Alt-q (the tab switcher)', { key: 'q', keyCode: 81, altKey: true }, '<Alt-q>'],
        ['Alt-Shift-q', { key: 'Q', keyCode: 81, altKey: true, shiftKey: true }, '<Alt-Q>'],
        ['Ctrl-quote', { key: "'", keyCode: 222, ctrlKey: true }, "<Ctrl-'>"],
        ['all modifiers on a named key', { key: 'Enter', keyCode: 13, ctrlKey: true, altKey: true, metaKey: true }, '<Ctrl-Alt-Meta-Enter>'],
        ['Shift on a named key', { key: 'Tab', keyCode: 9, shiftKey: true }, '<Shift-Tab>'],
        ['an arrow key', { key: 'ArrowDown', keyCode: 40 }, '<ArrowDown>'],
        ['Alt-s on a Mac (ß)', { key: 'ß', keyCode: 83, altKey: true }, '<Alt-s>'],
        ['Alt-i on a Mac (dead key)', { key: 'Dead', keyCode: 73, altKey: true }, '<Alt-i>'],
        ['Alt-/ on a Mac (÷)', { key: '÷', keyCode: 191, code: 'Slash', altKey: true }, '<Alt-/>'],
        ['a modifier alone', { key: 'Shift', keyCode: 16, shiftKey: true }, ''],
        ['an IME composition', { key: 'Process', keyCode: 229 }, ''],
        ['an unidentified key', { key: 'Unidentified', keyCode: 0 }, ''],
        ['an old Chrome keyIdentifier, corrected on Linux', { keyIdentifier: 'U+00BF', keyCode: 191, shiftKey: true }, '?'],
    ])('%s is %p', (_, event, stroke) => {
        expect(KeyboardUtils.getKeyChar(event)).toBe(KeyboardUtils.encodeKeystroke(stroke));
    });

    test('the platform comes from the user agent', () => {
        expect(KeyboardUtils.platform).toBe('Linux');
    });
});
