// Search engines: the search aliases (o<letter> opens the omnibar for one,
// s<letter> searches the selection with it) and a switch for each, kept in
// disabledSearchAliases as {alias: prompt}. Advanced mode ignores that key
// (content.js applySettings): the script removes engines itself.
import { h } from './dom.js';

// This page's frontend registers the aliases a moment after it loads; an empty
// list after this many tries means the settings removed them all.
export const ALIAS_TRIES = 10;
const ALIAS_RETRY_MS = 300;

/*
 * The engine's name from its omnibar prompt: plain text followed by a separator
 * span, or an <img> of its favicon whose alt is the name. The markup is parsed in
 * an inert <template>, so nothing in it loads or runs.
 */
export function aliasName(prompt) {
    const t = document.createElement('template');
    t.innerHTML = String(prompt || '');
    const img = t.content.querySelector('img');
    if (img && img.getAttribute('alt')) {
        return img.getAttribute('alt');
    }
    t.content.querySelectorAll('.separator').forEach((e) => e.remove());
    return t.content.textContent.trim();
}

// What disabledSearchAliases keeps for an alias: its prompt without the
// separator, as this page has always stored it.
function storedPrompt(prompt) {
    return prompt.startsWith('<img src=') ? prompt : prompt.replace(/<span class='separator'>.*/, '');
}

export function removeSearchAliasLines(disabled) {
    return Object.keys(disabled || {}).sort().map((a) => `api.removeSearchAlias('${a.replace(/[\\']/g, '\\$&')}');`).join('\n');
}

export default {
    id: 'search',
    title: 'Search engines',
    keywords: 'search engine engines alias aliases omnibar google bing duckduckgo',
    create(ctx, root) {
        // every alias this page has seen, so one switched off stays listed after a
        // reset brings it back (the frontend here only learns of it on a reload)
        const known = {};
        let disabled = {};
        let advanced = false;
        let loading = false;
        let loaded = false;

        const status = h('p', {class: 'sk-muted', id: 'searchAliasesStatus'}, 'Loading search engines…');
        const list = h('div', {id: 'searchAliases', class: 'sk-list'});
        const copy = h('button', {type: 'button', class: 'sk-btn'}, 'Copy as api.removeSearchAlias lines');
        const advancedNote = h('div', {class: 'sk-note', hidden: true},
            h('p', null, 'Advanced mode is on, so these switches are not used: remove engines in your settings script instead.'),
            copy);
        const enableAll = h('button', {type: 'button', class: 'sk-btn'}, 'Turn all on');
        root.append(
            h('p', {class: 'sk-lead'}, 'Each engine has a letter: ', h('kbd', null, 'o'), ' and the letter opens the omnibar for it, ',
                h('kbd', null, 's'), ' and the letter searches the selected text with it.'),
            advancedNote,
            h('div', {class: 'sk-card'}, status, list, h('div', {class: 'sk-actions'}, enableAll)));

        function write() {
            ctx.RUNTIME('updateSettings', {
                settings: {
                    disabledSearchAliases: disabled
                }
            });
        }

        function render() {
            const aliases = Object.keys(known).sort((a, b) => aliasName(known[a]).localeCompare(aliasName(known[b])));
            list.replaceChildren(...aliases.map((alias) => {
                const name = aliasName(known[alias]);
                const input = h('input', {
                    type: 'checkbox',
                    role: 'switch',
                    class: 'sk-switch',
                    id: `searchAlias-${alias}`,
                    'aria-describedby': `searchAliasKeys-${alias}`,
                });
                input.checked = !disabled.hasOwnProperty(alias);
                input.disabled = advanced;
                input.addEventListener('change', () => {
                    if (input.checked) {
                        delete disabled[alias];
                    } else {
                        disabled[alias] = storedPrompt(known[alias]);
                    }
                    write();
                });
                return h('div', {class: 'sk-switchrow sk-row', dataset: {keywords: alias}},
                    input,
                    h('label', {for: input.id, class: 'sk-switchlabel'}, name),
                    h('span', {class: 'sk-aliaskeys', id: `searchAliasKeys-${alias}`},
                        h('span', {class: 'sk-vh'}, 'keys '), h('kbd', null, `o${alias}`), ' · ', h('kbd', null, `s${alias}`)));
            }));
            enableAll.disabled = advanced || !Object.keys(disabled).length;
            copy.disabled = !Object.keys(disabled).length;
        }

        enableAll.addEventListener('click', () => {
            disabled = {};
            write();
            render();
            ctx.announce('All search engines on');
        });
        copy.addEventListener('click', () => {
            navigator.clipboard.writeText(removeSearchAliasLines(disabled)).then(() => {
                ctx.announce('Copied');
            }, (e) => {
                ctx.announce(`Could not copy: ${e.message}`);
            });
        });

        function load(tries) {
            ctx.frontCommand({
                action: 'getSearchAliases'
            }, function(response) {
                const aliases = (response && response.aliases) || {};
                if (!Object.keys(aliases).length && tries < ALIAS_TRIES) {
                    setTimeout(() => load(tries + 1), ALIAS_RETRY_MS);
                    return;
                }
                Object.keys(aliases).forEach((a) => {
                    known[a] = storedPrompt(aliases[a].prompt);
                });
                loaded = true;
                settle();
            });
        }

        function settle() {
            Object.keys(disabled).forEach((a) => {
                known[a] = known[a] || disabled[a];
            });
            const any = Object.keys(known).length > 0;
            status.hidden = any;
            status.textContent = loaded ? 'No search engines found.' : 'Loading search engines…';
            render();
        }

        return {
            onSettings(rs) {
                disabled = Object.assign({}, rs.disabledSearchAliases);
                advanced = !!rs.showAdvanced;
                advancedNote.hidden = !advanced;
                if (!loading && ctx.frontCommand) {
                    loading = true;
                    load(1);
                }
                settle();
            },
        };
    },
};
