// The Trie every mode keeps its mappings in: a node per stroke, the mapping on
// the node of its last stroke (meta), prefixes as bare nodes.
import Trie from '../../src/content_scripts/common/trie.js';

function build(words) {
    const t = new Trie();
    words.forEach((w) => t.add(w, { annotation: `do ${w}` }));
    return t;
}

describe('Trie', () => {
    test('find reaches a word, a prefix node, or nothing', () => {
        const t = build(['gg', 'gxx', 'x']);
        expect(t.find('gg').meta).toEqual({ annotation: 'do gg', word: 'gg' });
        expect(t.find('gx').meta).toBeUndefined();
        // a node spells its words from its own stroke on
        expect(t.find('gx').getWords('g')).toEqual(['gxx']);
        expect(t.find('q')).toBeUndefined();
        expect(t.find('gxxx')).toBeUndefined();
    });

    test('add stamps the word on its meta and replaces an earlier one', () => {
        const t = build(['x']);
        const meta = { annotation: 'close' };
        t.add('x', meta);
        expect(t.find('x').meta).toBe(meta);
        expect(meta.word).toBe('x');
    });

    test('getWords lists every mapped word, a word and its extensions alike', () => {
        const t = build(['g', 'gg', 'gxx', 'x']);
        expect(t.getWords().sort()).toEqual(['g', 'gg', 'gxx', 'x']);
    });

    test('getMetas keeps what the criterion accepts', () => {
        const t = build(['gg', 'gxx', 'x']);
        expect(t.getMetas((m) => m.word.startsWith('g')).map((m) => m.word).sort()).toEqual(['gg', 'gxx']);
    });

    test.each([
        ['a word', 'gxx', ['g', 'gg', 'x']],
        // what makes mapping 'g' anew override gg and gxx too (api.js _mapkey)
        ['a word that is also a prefix, with the words under it', 'g', ['x']],
        ['a prefix, with the words under it', 'gx', ['g', 'gg', 'x']],
        ['nothing for a word that is not there', 'q', ['g', 'gg', 'gxx', 'x']],
    ])('remove takes out %s', (_, word, left) => {
        const t = build(['g', 'gg', 'gxx', 'x']);
        const removed = t.remove(word);
        expect(t.getWords().sort()).toEqual(left);
        expect(removed === undefined).toBe(word === 'q');
    });

    test('remove prunes the prefix nodes left empty', () => {
        const t = build(['gxx', 'x']);
        t.remove('gxx');
        expect(t.find('g')).toBeUndefined();
        expect(Object.keys(t)).toEqual(['x']);
    });

    test.each([
        // a stroke after a prefix that matches nothing: what was typed before it
        [['<<', ',,'], ',', ','],
        [['abc'], 'ab', 'ab'],
        [['abc', 'abd'], 'a', 'a'],
    ])('getPrefixWord of %p at %p is %p', (words, prefix, typed) => {
        expect(build(words).find(prefix).getPrefixWord()).toBe(typed);
    });

    test('getPrefixWord of an emptied Trie is empty', () => {
        expect(new Trie().getPrefixWord()).toBe('');
    });
});
