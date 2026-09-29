import {
    SPARE_KEY, SPECIAL_KEYS, conflictsFor, isPrefixOf, keystrokes, snippetLines, takenBy,
} from '../../src/content_scripts/common/keyConflicts.js';
import applyBasicMappings from '../../src/content_scripts/common/basicMappings.js';
import KeyboardUtils from '../../src/content_scripts/common/keyboardUtils';
import Trie from '../../src/content_scripts/common/trie.js';

// default normal-mode keys around the cases measured in a real page (remap_check.py)
const WORDS = ['d', 'e', 'j', 'k', 'q', 'x', 'X', 'u', 'gg', 'g0', 'g$', 'gU', 'gi', 'gf', 'gxx', 'gx0',
    '<Ctrl-6>', '<Ctrl-d>', 'yy', 'yv', ';e', ';j', 'G', '<<', '>>'];

function types(hints) {
    return hints.map((h) => h.type);
}
function hint(hints, type) {
    return hints.find((h) => h.type === type);
}

describe('keystrokes', () => {
    test.each([
        ['gg', ['g', 'g']],
        ['<Ctrl-6>', ['<Ctrl-6>']],
        ['<Ctrl-Alt-Shift-F12>x', ['<Ctrl-Alt-Shift-F12>', 'x']],
        [';<Esc>', [';', '<Esc>']],
        ['<<', ['<', '<']],
        ['', []],
    ])('%p is %p', (keys, want) => {
        expect(keystrokes(keys)).toEqual(want);
    });

    test('prefixes are whole keystrokes', () => {
        expect(isPrefixOf('g', 'gg')).toBe(true);
        expect(isPrefixOf('<', '<<')).toBe(true);
        expect(isPrefixOf('<', '<Ctrl-6>')).toBe(false);
        expect(isPrefixOf('<Ctrl-6>', '<Ctrl-6>')).toBe(false);
        expect(isPrefixOf('', 'g')).toBe(false);
    });
});

describe('conflictsFor', () => {
    test('e to g shadows gg, g0, g$, gU and the rest of g…, and e still works', () => {
        const hints = conflictsFor(WORDS, {}, 'e', 'g');
        expect(types(hints)).toEqual(['shadows', 'stillBound']);
        expect(hint(hints, 'shadows').words).toEqual(expect.arrayContaining(['gg', 'g0', 'g$', 'gU']));
        expect(hint(hints, 'shadows').words).toEqual(['g$', 'g0', 'gU', 'gf', 'gg', 'gi', 'gx0', 'gxx']);
        expect(hint(hints, 'stillBound').word).toBe('e');
    });

    test('d to q takes q from its action, and d still works', () => {
        const hints = conflictsFor(WORDS, {}, 'd', 'q');
        expect(types(hints)).toEqual(['overrides', 'stillBound']);
        expect(hint(hints, 'overrides').word).toBe('q');
        expect(hint(hints, 'stillBound').word).toBe('d');
    });

    test('a swap of d and j is clean', () => {
        expect(conflictsFor(WORDS, {j: 'd'}, 'd', 'j')).toEqual([]);
        expect(conflictsFor(WORDS, {d: 'j'}, 'j', 'd')).toEqual([]);
    });

    test('a key whose own action moved elsewhere, or was turned off, loses nothing', () => {
        expect(types(conflictsFor(WORDS, {q: 'Q'}, 'd', 'q'))).toEqual(['stillBound']);
        expect(types(conflictsFor(WORDS, {q: ''}, 'd', 'q'))).toEqual(['stillBound']);
    });

    test('a key that starts with a bound key never runs', () => {
        const hints = conflictsFor(WORDS, {}, 'x', 'dd');
        expect(types(hints)).toEqual(['unreachable', 'stillBound']);
        expect(hint(hints, 'unreachable').words).toEqual(['d']);
        // its own original key counts too: it stays bound
        expect(hint(conflictsFor(WORDS, {}, 'd', 'dx'), 'unreachable').words).toEqual(['d']);
    });

    test('a bound key turned off frees the keys that start with it', () => {
        expect(types(conflictsFor(WORDS, {d: ''}, 'x', 'dd'))).toEqual(['stillBound']);
    });

    test('two actions given the same key', () => {
        const hints = conflictsFor(WORDS, {x: 'Z', k: 'Z'}, 'd', 'Z');
        expect(hint(hints, 'duplicate').origins).toEqual(['k', 'x']);
        expect(hint(hints, 'overrides')).toBeUndefined();
    });

    test('new keys of other entries are bound keys too', () => {
        expect(hint(conflictsFor(WORDS, {x: 'zz'}, 'd', 'z'), 'shadows').words).toEqual(['zz']);
        expect(hint(conflictsFor(WORDS, {x: 'z'}, 'd', 'zz'), 'unreachable').words).toEqual(['z']);
    });

    test('keys Surfingkeys handles itself', () => {
        expect(hint(conflictsFor(WORDS, {}, 'd', '<Esc>'), 'special').key).toBe('<Esc>');
        expect(hint(conflictsFor(WORDS, {}, 'd', '<Alt-s>'), 'special').key).toBe('<Alt-s>');
        expect(hint(conflictsFor(WORDS, {}, 'd', '<Esc>x'), 'special').key).toBe('<Esc>');
        expect(hint(conflictsFor(WORDS, {}, 'd', '<Alt-z>', [...SPECIAL_KEYS, '<Alt-z>']), 'special').key).toBe('<Alt-z>');
        expect(hint(conflictsFor(WORDS, {}, 'd', 'z'), 'special')).toBeUndefined();
    });

    test('multi-keystroke keys are compared keystroke by keystroke', () => {
        expect(types(conflictsFor(WORDS, {}, 'x', '<'))).toEqual(['shadows', 'stillBound']);
        expect(hint(conflictsFor(WORDS, {}, 'x', '<'), 'shadows').words).toEqual(['<<']);
        expect(types(conflictsFor(WORDS, {}, 'x', '<Ctrl-6>'))).toEqual(['overrides', 'stillBound']);
        expect(types(conflictsFor(WORDS, {}, 'x', '<Ctrl-7>'))).toEqual(['stillBound']);
    });

    test('turning off, or keeping the key, says nothing', () => {
        expect(conflictsFor(WORDS, {}, 'd', '')).toEqual([]);
        expect(conflictsFor(WORDS, {}, 'd', 'd')).toEqual([]);
    });

    test('the entry being changed is not one of the others', () => {
        expect(types(conflictsFor(WORDS, {d: 'q'}, 'd', 'z'))).toEqual(['stillBound']);
    });
});

/*
 * Normal-mode keys in a real Trie, keyed by encoded keystrokes, with api.map and
 * api.unmap as api.js has them: map copies the action the old key has at that
 * moment and replaces the new key's whole node (longer keys under it go), unmap
 * removes the node found.
 */
const enc = (k) => KeyboardUtils.encodeKeystroke(k);
function model(words) {
    const mappings = new Trie();
    words.forEach((w) => mappings.add(enc(w), {action: `act:${w}`}));
    const normal = {mappings};
    const api = {
        map(n, o) {
            const node = mappings.find(enc(o));
            if (node && node.meta) {
                mappings.remove(enc(n));
                mappings.add(enc(n), Object.assign({}, node.meta));
            }
        },
        unmap(k) {
            if (mappings.find(enc(k))) {
                mappings.remove(enc(k));
            }
        },
    };
    return {
        api,
        normal,
        get keys() {
            const keys = {};
            mappings.getWords().forEach((w) => {
                keys[KeyboardUtils.decodeKeystroke(w)] = mappings.find(w).meta.action;
            });
            return keys;
        },
    };
}

function apply(words, remaps, onMoved) {
    const m = model(words);
    applyBasicMappings(m.api, m.normal, remaps, onMoved);
    return m.keys;
}

function runLines(m, text) {
    const unq = (s) => s.slice(1, -1).replace(/\\(.)/g, '$1');
    text.split('\n').filter((l) => l).forEach((line) => {
        let r = line.match(/^api\.map\(('(?:\\.|[^'])*'), ('(?:\\.|[^'])*')\);$/);
        if (r) {
            m.api.map(unq(r[1]), unq(r[2]));
            return;
        }
        r = line.match(/^api\.unmap\(('(?:\\.|[^'])*')\);$/);
        expect(r).not.toBeNull();
        m.api.unmap(unq(r[1]));
    });
    return m.keys;
}

describe('snippetLines', () => {
    test('plain changes', () => {
        expect(snippetLines({d: 'q', x: ''})).toBe("api.unmap('x');\napi.map('q', 'd');");
        expect(snippetLines({})).toBe('');
        expect(snippetLines(undefined)).toBe('');
    });

    test('quotes keys', () => {
        expect(snippetLines({"'": '\\'})).toBe("api.map('\\\\', '\\'');");
    });

    test('a swap parks one action on a spare key', () => {
        const text = snippetLines({d: 'j', j: 'd'});
        expect(text).toContain(SPARE_KEY);
        expect(text.split('\n').pop()).toBe(`api.unmap('${SPARE_KEY}');`);
    });

    test.each([
        [{d: 'q'}],
        [{d: 'j', j: 'd'}],
        [{d: 'j', j: 'k'}],
        [{j: 'k', d: 'j'}],
        [{d: 'j', j: 'k', k: 'd'}],
        [{d: 'j', j: 'd', x: 'X', X: 'x'}],
        [{j: '', d: 'j'}],
        [{x: '', e: 'g', '<Ctrl-6>': 'u', u: '<Ctrl-6>'}],
        [{e: 'g', gg: '<Alt-y>'}],
        [{e: 'g', gg: 'e'}],
        [{e: 'g', gg: 'q', g0: 'e'}],
    ])('does what storing %p does', (remaps) => {
        expect(runLines(model(WORDS), snippetLines(remaps))).toEqual(apply(WORDS, remaps));
    });

    test('a second action waiting parks on another spare key', () => {
        const text = snippetLines({b: 'g', gg: 'g'});
        expect(text).toContain(SPARE_KEY);
        expect(text).toContain('<Ctrl-Alt-Shift-F11>');
        expect(runLines(model(WORDS), text)).toEqual(apply(WORDS, {b: 'g', gg: 'g'}));
    });

    test('an action a key turned off would take along is parked first', () => {
        const words = ['g', 'gg', 'g0', 'a', 'ab'];
        const remaps = {g: '', g0: 'g', a: '', ab: 'z'};
        expect(runLines(model(words), snippetLines(remaps))).toEqual(apply(words, remaps));
    });

    test('does what storing does, over many generated cases', () => {
        const words = ['e', 'g', 'gg', 'g0', 'a', 'ab', 'b', '<Alt-p>', '<Alt-m>'];
        const keys = ['', ...words, 'z'];
        let seed = 7;
        const next = (n) => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % n;
        };
        for (let i = 0; i < 3000; i++) {
            const remaps = {};
            for (let j = 1 + next(5); j > 0; j--) {
                remaps[words[next(words.length)]] = keys[next(keys.length)];
            }
            expect([remaps, runLines(model(words), snippetLines(remaps))]).toEqual([remaps, apply(words, remaps)]);
        }
    });
});

// chrome.storage hands basicMappings back with the keys sorted, whatever order they were written in
function orders(remaps) {
    const keys = Object.keys(remaps);
    const all = [[]];
    keys.forEach(() => {
        all.splice(0, all.length, ...all.flatMap((p) => keys.filter((k) => !p.includes(k)).map((k) => p.concat(k))));
    });
    return all.map((p) => Object.fromEntries(p.map((k) => [k, remaps[k]])));
}

describe('applyBasicMappings', () => {
    test.each([
        [{j: '', d: 'j'}, {j: 'act:d', d: 'act:d'}],
        [{d: 'j', j: 'd'}, {j: 'act:d', d: 'act:j'}],
        [{e: 'g', gg: '<Alt-y>'}, {g: 'act:e', '<Alt-y>': 'act:gg', gg: undefined}],
    ])('%p gives the same keys in any stored order', (remaps, expected) => {
        const results = orders(remaps).map((r) => apply(WORDS, r));
        results.forEach((keys) => expect(keys).toEqual(results[0]));
        Object.keys(expected).forEach((k) => expect(results[0][k]).toBe(expected[k]));
    });

    test('works on bracketed keys: turned off, swapped, moved', () => {
        const words = ['<Alt-p>', '<Alt-m>', '<Ctrl-6>', 'x'];
        const off = apply(words, {'<Alt-p>': ''});
        expect(off['<Alt-p>']).toBeUndefined();
        expect(off['<Alt-m>']).toBe('act:<Alt-m>');
        const swapped = apply(words, {'<Alt-p>': '<Alt-m>', '<Alt-m>': '<Alt-p>'});
        expect(swapped['<Alt-p>']).toBe('act:<Alt-m>');
        expect(swapped['<Alt-m>']).toBe('act:<Alt-p>');
        const moved = apply(words, {x: '<Ctrl-6>', '<Ctrl-6>': ''});
        expect(moved['<Ctrl-6>']).toBe('act:x');
    });

    test('a key no mapping has goes to api.map, for the Mode special keys', () => {
        const m = model(WORDS);
        m.api.map = jest.fn();
        applyBasicMappings(m.api, m.normal, {'<Alt-s>': '<Alt-z>'});
        expect(m.api.map).toHaveBeenCalledWith('<Alt-z>', '<Alt-s>');
    });

    test('tells only the moves whose origin keeps its default action', () => {
        const onMoved = jest.fn();
        apply(WORDS, {d: 'j', j: 'd', x: 'X', q: ''}, onMoved);
        expect(onMoved.mock.calls).toEqual([['X', 'x']]);
    });
});

describe('takenBy', () => {
    test('a swap, a shadowing new key, or nothing', () => {
        expect(takenBy({d: 'j', j: 'd'}, 'j')).toBe('j');
        expect(takenBy({e: 'g', gg: 'Z'}, 'gg')).toBe('g');
        expect(takenBy({e: 'g', gg: 'Z'}, 'e')).toBeNull();
        expect(takenBy({e: '', gg: 'Z'}, 'e')).toBeNull();
        expect(takenBy(undefined, 'e')).toBeNull();
    });

    test('conflictsFor says the original key stops working', () => {
        const hints = conflictsFor(WORDS, {e: 'g'}, 'gg', '<Alt-y>');
        expect(types(hints)).toEqual(['originShadowed']);
        expect(hint(hints, 'originShadowed')).toEqual({type: 'originShadowed', word: 'gg', key: 'g'});
    });
});
