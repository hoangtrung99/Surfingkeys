import KeyboardUtils from './keyboardUtils';

/*
 * Apply custom key mappings for basic users, the input is like
 * {"a": "b", "b": "a", "c": "", "<Alt-p>": "<Alt-m>"}
 * chrome.storage hands the entries back with their keys sorted, so the result
 * must not depend on their order: every action is read before any key changes,
 * then the entries turning an action off ("") run, then the moves. A move
 * replaces its new key's Trie node, so it may take a key turned off here or one
 * another entry moves away (a swap). Keys are decoded ("<Alt-p>"); the Trie is
 * keyed by encoded keystrokes.
 *
 * `onMoved(newKey, originKey)` is told of each move whose origin keeps its
 * default action, the only ones a copy of the default mappings can replay.
 */
export default function applyBasicMappings(api, normal, mappings, onMoved) {
    // sorted as chrome.storage keeps them, so a new key two entries share goes to the last
    const origins = Object.keys(mappings || {}).sort();
    const metas = {};
    origins.forEach((originKey) => {
        const node = normal.mappings.find(KeyboardUtils.encodeKeystroke(originKey));
        if (node && node.meta) {
            metas[originKey] = node.meta;
        }
    });
    origins.filter((originKey) => mappings[originKey] === "").forEach((originKey) => {
        api.unmap(originKey);
    });
    const targets = new Set(origins.map((originKey) => mappings[originKey]));
    origins.filter((originKey) => mappings[originKey] && mappings[originKey] !== originKey).forEach((originKey) => {
        const newKey = mappings[originKey];
        if (!metas.hasOwnProperty(originKey)) {
            // a Mode special key such as <Alt-s>, or a key this build does not have
            api.map(newKey, originKey);
            return;
        }
        const nks = KeyboardUtils.encodeKeystroke(newKey);
        normal.mappings.remove(nks);
        normal.mappings.add(nks, Object.assign({}, metas[originKey]));
        if (onMoved && !targets.has(originKey)) {
            onMoved(newKey, originKey);
        }
    });
}
