import {
    SPARE_KEY, SPECIAL_KEYS, conflictsFor, isPrefixOf, keystrokes, snippetLines, storedOrder,
} from '../../src/content_scripts/common/keyConflicts.js';

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
 * A model of normal-mode keys as actions: api.map copies the action the old key
 * has at that moment (and replaces the whole node, so longer keys under it go),
 * api.unmap removes a key; applyBasicMappings is content.js's, over this model.
 */
function model(words) {
    const keys = {};
    words.forEach((w) => {
        keys[w] = `act:${w}`;
    });
    const put = (k, action) => {
        Object.keys(keys).filter((w) => isPrefixOf(k, w)).forEach((w) => delete keys[w]);
        keys[k] = action;
    };
    return {
        keys,
        find: (k) => keys[k],
        map(n, o) {
            if (keys[o] !== undefined) {
                put(n, keys[o]);
            }
        },
        unmap(k) {
            delete keys[k];
        },
        add: put,
    };
}

function applyBasicMappings(m, mappings) {
    const originKeys = new Set(Object.keys(mappings));
    const originMappings = {};
    for (const originKey in mappings) {
        const newKey = mappings[originKey];
        if (originKeys.has(newKey)) {
            const target = m.find(newKey);
            if (target) {
                originMappings[newKey] = target;
            }
        }
        if (newKey === '') {
            m.unmap(originKey);
        } else if (originMappings.hasOwnProperty(originKey)) {
            m.add(newKey, originMappings[originKey]);
        } else {
            m.map(newKey, originKey);
        }
    }
    return m.keys;
}

function runLines(m, text) {
    const unq = (s) => s.slice(1, -1).replace(/\\(.)/g, '$1');
    text.split('\n').filter((l) => l).forEach((line) => {
        let r = line.match(/^api\.map\(('(?:\\.|[^'])*'), ('(?:\\.|[^'])*')\);$/);
        if (r) {
            m.map(unq(r[1]), unq(r[2]));
            return;
        }
        r = line.match(/^api\.unmap\(('(?:\\.|[^'])*')\);$/);
        expect(r).not.toBeNull();
        m.unmap(unq(r[1]));
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
    ])('does what storing %p does', (remaps) => {
        const stored = applyBasicMappings(model(WORDS), storedOrder(remaps));
        expect(runLines(model(WORDS), snippetLines(remaps))).toEqual(stored);
    });
});

describe('storedOrder', () => {
    test('puts the keys turned off first, and keeps the rest as they were', () => {
        const ordered = storedOrder({d: 'j', j: '', x: 'X'});
        expect(Object.keys(ordered)).toEqual(['j', 'd', 'x']);
        expect(ordered).toEqual({d: 'j', j: '', x: 'X'});
    });

    test('so a key turned off after another entry took it keeps the new binding', () => {
        const keys = applyBasicMappings(model(WORDS), storedOrder({d: 'j', j: ''}));
        expect(keys.j).toBe('act:d');
        // stored as the entries were made, the later "" removes it
        expect(applyBasicMappings(model(WORDS), {d: 'j', j: ''}).j).toBeUndefined();
    });
});
