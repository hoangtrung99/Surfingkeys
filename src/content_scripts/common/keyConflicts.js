/*
 * What a key change in basicMappings ({originKey: newKey | ""}) does to the other
 * normal-mode keys, the way content.js applyBasicMappings applies it:
 *   - a new key is ADDED with api.map; the original key keeps its action unless
 *     another entry maps onto it (a swap), or the entry is "" (turned off);
 *   - api.map replaces the new key's Trie node, so its own action, and every
 *     longer mapping under it (g under gg, g0, g$...), is gone;
 *   - a Trie node with an action runs as soon as it is reached (mode.js), so a
 *     new key that starts with a bound key never runs.
 * Keys are written as the settings page shows them ('gg', '<Ctrl-6>'), and are
 * compared keystroke by keystroke, never character by character.
 *
 * This module imports nothing: the settings page and jest use it as it is.
 */

// what Mode.specialKeys starts with: <Esc> leaves modes, <Alt-s> toggles Surfingkeys
export const SPECIAL_KEYS = ['<Esc>', '<Alt-s>'];

// the keystrokes of a key sequence, split the way KeyboardUtils.encodeKeystroke reads it
const KEYSTROKE = /<(?:Ctrl-)?(?:Alt-)?(?:Meta-)?(?:Shift-)?(?:[^>]+|.)>|[\s\S]/g;
export function keystrokes(keys) {
    return String(keys || '').match(KEYSTROKE) || [];
}

// true when `a` is a strict prefix of `b`, keystroke by keystroke
export function isPrefixOf(a, b) {
    const ka = keystrokes(a), kb = keystrokes(b);
    return ka.length > 0 && ka.length < kb.length && ka.every((k, i) => k === kb[i]);
}

// fewer keystrokes first, then by code point
function shortFirst(a, b) {
    return keystrokes(a).length - keystrokes(b).length || (a < b ? -1 : a > b ? 1 : 0);
}

function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
}

/*
 * The hints for giving `origin` the key `newKey`, with the other entries of
 * `remaps` as they are. `words` are the default normal-mode keys, before any
 * remap. Each hint is one of
 *   {type: 'special', key}          newKey is a key Surfingkeys handles itself
 *   {type: 'overrides', word}       newKey already runs another action, which loses it
 *   {type: 'duplicate', origins}    other entries give their actions the same key
 *   {type: 'shadows', words}        newKey runs at once, so these longer keys stop working
 *   {type: 'unreachable', words}    these bound keys run first, so newKey never does
 *                                   (words: the shortest keys first)
 *   {type: 'stillBound', word}      the original key keeps working too (decision D1)
 * in that order. Turning an action off ("") or keeping its key says nothing.
 */
export function conflictsFor(words, remaps, origin, newKey, specialKeys = SPECIAL_KEYS) {
    if (!newKey || newKey === origin) {
        return [];
    }
    const others = {};
    Object.keys(remaps || {}).forEach((o) => {
        if (o !== origin) {
            others[o] = remaps[o];
        }
    });
    const hints = [];
    const first = keystrokes(newKey)[0];
    if (specialKeys.includes(newKey) || specialKeys.includes(first)) {
        hints.push({type: 'special', key: specialKeys.includes(newKey) ? newKey : first});
    }
    // an entry of its own moves the key's action elsewhere, or has turned it off
    if (words.includes(newKey) && !has(others, newKey)) {
        hints.push({type: 'overrides', word: newKey});
    }
    const duplicates = Object.keys(others).filter((o) => others[o] === newKey).sort();
    if (duplicates.length) {
        hints.push({type: 'duplicate', origins: duplicates});
    }

    // what is bound once the other entries are applied: every default key not
    // turned off (an original key stays bound, D1), plus their new keys
    const bound = new Set(words.filter((w) => others[w] !== ''));
    bound.add(origin);
    Object.keys(others).forEach((o) => {
        if (others[o]) {
            bound.add(others[o]);
        }
    });
    bound.delete(newKey);
    const longer = [...bound].filter((w) => isPrefixOf(newKey, w)).sort(shortFirst);
    if (longer.length) {
        hints.push({type: 'shadows', words: longer});
    }
    const shorter = [...bound].filter((w) => isPrefixOf(w, newKey)).sort(shortFirst);
    if (shorter.length) {
        hints.push({type: 'unreachable', words: shorter});
    }

    if (!Object.keys(others).some((o) => others[o] === origin)) {
        hints.push({type: 'stillBound', word: origin});
    }
    return hints;
}

/*
 * basicMappings in the order to store them: the entries that turn an action off
 * first. applyBasicMappings runs the entries in stored order, and one that turns
 * off a key after another entry has mapped onto it removes that new binding too.
 */
export function storedOrder(remaps) {
    const ordered = {};
    const keys = Object.keys(remaps || {});
    keys.filter((o) => remaps[o] === '').forEach((o) => {
        ordered[o] = '';
    });
    keys.filter((o) => remaps[o] !== '').forEach((o) => {
        ordered[o] = remaps[o];
    });
    return ordered;
}

// a key no default mapping uses, to hold an action while a swap moves it
export const SPARE_KEY = '<Ctrl-Alt-Shift-F12>';

function quote(key) {
    return `'${String(key).replace(/[\\']/g, '\\$&')}'`;
}

/*
 * basicMappings as settings-script lines with the same effect. api.map copies
 * the action the old key has at that moment, so an entry is written before any
 * entry that maps onto its original key; a cycle (d and j swapped) parks one
 * action on SPARE_KEY until its key is free.
 */
export function snippetLines(remaps) {
    remaps = remaps || {};
    const lines = Object.keys(remaps).filter((o) => remaps[o] === '').sort()
        .map((o) => `api.unmap(${quote(o)});`);
    const moves = {};
    Object.keys(remaps).filter((o) => remaps[o] && remaps[o] !== o).sort().forEach((o) => {
        moves[o] = remaps[o];
    });
    const origins = Object.keys(moves);
    const done = new Set();
    let parked = null;
    while (done.size < origins.length) {
        const ready = origins.find((o) => !done.has(o) && (!has(moves, moves[o]) || done.has(moves[o]) || parked === moves[o]));
        if (ready === undefined) {
            parked = origins.find((o) => !done.has(o));
            lines.push(`api.map(${quote(SPARE_KEY)}, ${quote(parked)});`);
            continue;
        }
        lines.push(`api.map(${quote(moves[ready])}, ${quote(parked === ready ? SPARE_KEY : ready)});`);
        done.add(ready);
        if (parked === ready) {
            lines.push(`api.unmap(${quote(SPARE_KEY)});`);
            parked = null;
        }
    }
    return lines.join('\n');
}
