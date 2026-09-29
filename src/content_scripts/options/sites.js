// Sites: where Surfingkeys is turned off (blocklist) and where selecting text with
// the mouse searches it (mouseSelectToQuery).
//
// Both are stored whole, and Alt-s in any tab rewrites the blocklist, so every
// change here reads the stored value right before writing it back: a change made
// from a copy the page loaded earlier would undo what was done in other tabs since.
// The lists redraw from chrome.storage.onChanged, so Alt-s elsewhere shows up here
// at once. updateSettings tells every open tab, which turns Surfingkeys on or off
// there without a reload.
import { h } from './dom.js';

// blocklist['.*'] turns Surfingkeys off everywhere (the popup's switch)
export const ALL_SITES = '.*';

/*
 * The origin a blocklist entry is matched by (start.js _getState compares
 * url.origin), from what a user types: a URL, or a host with or without a port.
 * A missing scheme means https. null when it names no http(s) site, or holds a
 * wildcard, which an origin cannot match.
 */
export function normalizeOrigin(input) {
    const text = String(input === undefined || input === null ? '' : input).trim();
    if (!text || /\s/.test(text)) {
        return null;
    }
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
    let url;
    try {
        url = new URL(withScheme);
    } catch (e) {
        return null;
    }
    if (!/^https?:$/.test(url.protocol) || !url.hostname) {
        return null;
    }
    if (!/^[a-z0-9.-]+$/.test(url.hostname) && !/^\[[0-9a-f:.]+\]$/.test(url.hostname)) {
        return null;
    }
    return url.origin;
}

// The sites a stored blocklist turns Surfingkeys off on, sorted by host.
export function blockedOrigins(blocklist) {
    return Object.keys(blocklist || {}).filter((k) => k !== ALL_SITES && blocklist[k])
        .sort((a, b) => a.replace(/^\w+:\/\//, '').localeCompare(b.replace(/^\w+:\/\//, '')) || a.localeCompare(b));
}

// A settings script can turn sites off (or to lurking) by pattern, which this page cannot list.
export function patternSettings(rs) {
    if (!rs || !rs.showAdvanced || typeof rs.snippets !== 'string') {
        return [];
    }
    return ['blocklistPattern', 'lurkingPattern'].filter((name) => new RegExp(`\\b${name}\\b`).test(rs.snippets));
}

function host(origin) {
    return origin.replace(/^https:\/\//, '');
}

export default {
    id: 'sites',
    title: 'Sites',
    keywords: 'site sites blocklist disable disabled turn off exclude domain origin mouse select query',
    create(ctx, root) {
        const { RUNTIME } = ctx;

        const allOn = h('input', {id: 'sitesAllOn', type: 'checkbox', role: 'switch', class: 'sk-switch'});
        const patternNote = h('div', {id: 'sitesPatternNote', class: 'sk-note sk-warn', hidden: true});

        function siteList(opts) {
            const list = h('ul', {id: opts.listId, class: 'sk-sitelist'});
            const empty = h('p', {class: 'sk-muted', id: `${opts.listId}Empty`}, opts.empty);
            const input = h('input', {type: 'text', id: opts.inputId, class: 'sk-input', spellcheck: 'false',
                autocomplete: 'off', placeholder: 'example.com or https://example.com:8080', 'aria-describedby': `${opts.inputId}Error`});
            const error = h('p', {id: `${opts.inputId}Error`, class: 'sk-error', hidden: true});
            const form = h('form', {class: 'sk-fields sk-siteadd'},
                h('div', {class: 'sk-field sk-grow'}, h('label', {for: opts.inputId, class: 'sk-label'}, opts.addLabel), input),
                h('button', {type: 'submit', class: 'sk-btn sk-field-end'}, 'Add'));
            const card = h('div', {class: 'sk-card sk-row', dataset: {keywords: opts.keywords}},
                h('h3', null, opts.title), h('p', {class: 'sk-muted'}, opts.help), list, empty, form, error);
            function showError(text) {
                error.textContent = text || '';
                error.hidden = !text;
                if (text) {
                    input.setAttribute('aria-invalid', 'true');
                } else {
                    input.removeAttribute('aria-invalid');
                }
            }
            input.addEventListener('input', () => showError(''));
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const origin = normalizeOrigin(input.value);
                if (!origin) {
                    showError(input.value.trim()
                        ? 'Enter a site as a host (example.com) or a web address (https://example.com).'
                        : 'Enter a site first.');
                    input.focus();
                    return;
                }
                showError('');
                opts.add(origin, () => {
                    input.value = '';
                });
            });
            function render(origins) {
                const focused = list.contains(document.activeElement) ? document.activeElement.dataset.origin : null;
                const index = focused ? Array.from(list.querySelectorAll('button')).findIndex((b) => b.dataset.origin === focused) : -1;
                list.replaceChildren(...origins.map((origin) => h('li', {class: 'sk-siterow'},
                    h('span', {class: 'sk-sitename', title: origin}, host(origin)),
                    h('button', {type: 'button', class: 'sk-btn', dataset: {origin},
                        'aria-label': `${opts.removeLabel} ${host(origin)}`, onclick: () => opts.remove(origin)}, 'Remove'))));
                empty.hidden = origins.length > 0;
                list.hidden = !origins.length;
                // a removed row takes focus with it: hand it to the row now in its
                // place, or to the field when the list is empty
                if (focused && !origins.includes(focused)) {
                    const buttons = list.querySelectorAll('button');
                    (buttons[Math.min(index, buttons.length - 1)] || input).focus();
                }
            }
            return {card, render};
        }

        // Changes to one key run one after the other: two begun inside one round
        // trip would both read the value from before either, and the second
        // write would put back what the first removed.
        const queues = {};
        // reads the stored value, hands a copy to `change`, stores what it returns
        function rewrite(key, fallback, change, done) {
            const queue = queues[key] || (queues[key] = []);
            queue.push(() => {
                const finish = (value, wrote) => {
                    done && done(value, wrote);
                    queue.shift();
                    queue.length && queue[0]();
                };
                RUNTIME('getSettings', {key}, (resp) => {
                    const stored = resp && resp.settings ? resp.settings[key] : undefined;
                    const next = change(JSON.parse(JSON.stringify(stored || fallback)));
                    if (next === null) {
                        finish(stored || fallback, false);
                        return;
                    }
                    RUNTIME('updateSettings', {settings: {[key]: next}}, (r) => {
                        if (r && r.error) {
                            ctx.announce(r.error, 3000);
                            finish(stored || fallback, false);
                        } else {
                            finish(next, true);
                        }
                    });
                });
            });
            queue.length === 1 && queue[0]();
        }

        const blocked = siteList({
            listId: 'blocklistSites',
            inputId: 'blocklistAdd',
            title: 'Sites where Surfingkeys is off',
            keywords: 'blocklist disabled off exclude alt-s',
            help: [ 'Press ', h('kbd', null, 'Alt-s'), ' on a site to turn Surfingkeys off or on there. Removing a site here turns it back on in its open tabs.' ],
            empty: 'None: Surfingkeys is on everywhere it can run.',
            addLabel: 'Turn Surfingkeys off on a site',
            removeLabel: 'Turn Surfingkeys back on for',
            add(origin, cleared) {
                rewrite('blocklist', {}, (bl) => {
                    if (bl[origin]) {
                        ctx.announce(`Surfingkeys is already off on ${host(origin)}`);
                        cleared();
                        return null;
                    }
                    bl[origin] = 1;
                    return bl;
                }, (bl, wrote) => {
                    renderBlocklist(bl);
                    if (wrote) {
                        cleared();
                        ctx.announce(`Surfingkeys is off on ${host(origin)}`);
                    }
                });
            },
            remove(origin) {
                rewrite('blocklist', {}, (bl) => {
                    if (!bl[origin]) {
                        return null;
                    }
                    delete bl[origin];
                    return bl;
                }, (bl, wrote) => {
                    renderBlocklist(bl);
                    wrote && ctx.announce(`Surfingkeys is back on for ${host(origin)}`);
                });
            },
        });

        const mouse = siteList({
            listId: 'mouseQuerySites',
            inputId: 'mouseQueryAdd',
            title: 'Search the text selected with the mouse',
            keywords: 'mouse select selection query search mouseSelectToQuery',
            help: 'On these sites, selecting text with the mouse offers a search for it.',
            empty: 'None.',
            addLabel: 'Add a site',
            removeLabel: 'Stop searching the mouse selection on',
            add(origin, cleared) {
                rewrite('mouseSelectToQuery', [], (list) => {
                    if (list.includes(origin)) {
                        cleared();
                        return null;
                    }
                    list.push(origin);
                    return list;
                }, (list, wrote) => {
                    renderMouse(list);
                    if (wrote) {
                        cleared();
                        ctx.announce(`Added ${host(origin)}`);
                    }
                });
            },
            remove(origin) {
                rewrite('mouseSelectToQuery', [], (list) => {
                    const i = list.indexOf(origin);
                    if (i === -1) {
                        return null;
                    }
                    list.splice(i, 1);
                    return list;
                }, (list, wrote) => {
                    renderMouse(list);
                    wrote && ctx.announce(`Removed ${host(origin)}`);
                });
            },
        });

        root.append(
            h('p', {class: 'sk-lead'}, 'Where Surfingkeys is turned off, and where it searches what you select.'),
            h('div', {class: 'sk-card sk-row', dataset: {keywords: 'all sites global on off everywhere'}},
                h('div', {class: 'sk-switchrow'},
                    allOn,
                    h('label', {for: 'sitesAllOn', class: 'sk-switchlabel'}, 'Surfingkeys on all sites')),
                h('p', {class: 'sk-muted'}, 'Off turns Surfingkeys off everywhere, as the switch in its toolbar popup does. The list below still applies once it is back on.')),
            patternNote,
            blocked.card,
            mouse.card);

        function renderBlocklist(bl) {
            allOn.checked = !(bl && bl[ALL_SITES]);
            blocked.render(blockedOrigins(bl));
        }
        function renderMouse(list) {
            mouse.render(Array.isArray(list) ? list.slice().sort() : []);
        }
        function renderPatterns(rs) {
            const names = patternSettings(rs);
            patternNote.hidden = !names.length;
            patternNote.replaceChildren(...(names.length ? [h('p', null, 'Your settings script also sets ',
                names.map((n, i) => [i ? ' and ' : '', h('code', null, n)]),
                ': sites it matches are handled by the script, whatever these lists say.')] : []));
        }

        allOn.addEventListener('change', () => {
            const on = allOn.checked;
            allOn.disabled = true;
            rewrite('blocklist', {}, (bl) => {
                if (on) {
                    delete bl[ALL_SITES];
                } else {
                    bl[ALL_SITES] = 1;
                }
                return bl;
            }, (bl, wrote) => {
                allOn.disabled = false;
                renderBlocklist(bl);
                wrote && ctx.announce(on ? 'Surfingkeys is on' : 'Surfingkeys is off on all sites');
            });
        });

        renderBlocklist({});
        renderMouse([]);
        return {
            onSettings(rs) {
                renderBlocklist(rs.blocklist);
                renderMouse(rs.mouseSelectToQuery);
                renderPatterns(rs);
            },
            onStorage(changes, area) {
                if (area !== 'local') {
                    return;
                }
                if (changes.hasOwnProperty('blocklist')) {
                    renderBlocklist(changes.blocklist.newValue);
                }
                if (changes.hasOwnProperty('mouseSelectToQuery')) {
                    renderMouse(changes.mouseSelectToQuery.newValue);
                }
            },
        };
    },
};
