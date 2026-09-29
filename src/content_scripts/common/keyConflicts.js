/*
 * What a key change in basicMappings ({originKey: newKey | ""}) does to the other
 * normal-mode keys, the way common/basicMappings.js applies it. The stored order
 * of the entries does not matter: every action is read first, the entries
 * turning an action off ("") run next, then the moves.
 *   - a new key is ADDED; the original key keeps its action unless another entry
 *     moves onto it (a swap) or onto a key it starts with, or the entry is ""
 *     (turned off);
 *   - a move replaces the new key's Trie node, so its own action, and every
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
 *   {type: 'originShadowed', word, key}  another entry's new key `key` starts the
 *                                   original key, which stops working
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

    const taker = takenBy(others, origin);
    if (taker === null) {
        hints.push({type: 'stillBound', word: origin});
    } else if (taker !== origin) {
        hints.push({type: 'originShadowed', word: origin, key: taker});
    }
    return hints;
}

/*
 * The new key of another entry that takes `origin` away: origin itself (a swap)
 * or a key origin starts with, whose move removes origin's Trie node. null
 * while origin keeps working.
 */
export function takenBy(remaps, origin) {
    const keys = Object.keys(remaps || {}).filter((o) => o !== origin && remaps[o]).map((o) => remaps[o]);
    if (keys.includes(origin)) {
        return origin;
    }
    const shorter = keys.filter((k) => isPrefixOf(k, origin)).sort(shortFirst);
    return shorter.length ? shorter[0] : null;
}

// a key no default mapping uses, to hold an action while a swap moves it
export const SPARE_KEY = '<Ctrl-Alt-Shift-F12>';

function quote(key) {
    return `'${String(key).replace(/[\\']/g, '\\$&')}'`;
}

/*
 * basicMappings as settings-script lines with the same effect. api.map copies
 * the action the old key has at that moment and replaces the new key's node, so
 * an entry is written before any entry whose new key is its original key or
 * starts it; a cycle (d and j swapped) parks one action on a spare key
 * (SPARE_KEY first) until nothing waits for its key, and so does an action a
 * key turned off would take along (g0 under g). Entries whose new keys are
 * equal or start one another are written in the order basicMappings.js applies
 * them, so the same one wins.
 */
export function snippetLines(remaps) {
    remaps = remaps || {};
    const lines = [];
    const offs = Object.keys(remaps).filter((o) => remaps[o] === '').sort();
    const moves = {};
    Object.keys(remaps).filter((o) => remaps[o] && remaps[o] !== o).sort().forEach((o) => {
        moves[o] = remaps[o];
    });
    const origins = Object.keys(moves);
    const done = new Set();
    // origin -> the spare key holding its action
    const parked = new Map();
    function park(o) {
        let n = 12, spare = SPARE_KEY;
        while ([...parked.values()].includes(spare)) {
            spare = SPARE_KEY.replace(/\d+>$/, `${--n}>`);
        }
        parked.set(o, spare);
        lines.push(`api.map(${quote(spare)}, ${quote(o)});`);
    }
    // a key turned off takes the longer keys under it along
    origins.filter((o) => offs.some((k) => isPrefixOf(k, o))).forEach(park);
    offs.forEach((o) => lines.push(`api.unmap(${quote(o)});`));
    const related = (a, b) => a === b || isPrefixOf(a, b) || isPrefixOf(b, a);
    // o waits for p: writing o would destroy p's original key before it is read,
    // or p comes first where both write the same keys
    const waits = (o, p) => p !== o && !done.has(p) && (
        (!parked.has(p) && (moves[o] === p || isPrefixOf(moves[o], p)))
        || (p < o && related(moves[o], moves[p])));
    while (done.size < origins.length) {
        const ready = origins.find((o) => !done.has(o) && !origins.some((p) => waits(o, p)));
        if (ready === undefined) {
            park(origins.find((o) => !done.has(o) && !parked.has(o)));
            continue;
        }
        lines.push(`api.map(${quote(moves[ready])}, ${quote(parked.get(ready) || ready)});`);
        done.add(ready);
        if (parked.has(ready)) {
            lines.push(`api.unmap(${quote(parked.get(ready))});`);
            parked.delete(ready);
        }
    }
    return lines.join('\n');
}
