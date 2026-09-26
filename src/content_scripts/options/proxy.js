// Proxy (Chrome only): the mode, and proxy servers each with the hosts that use
// (byhost) or skip (bypass) it. Every change goes through updateProxy, whose reply
// is the stored proxy settings this section redraws from.
import { h } from './dom.js';

const MODES = {
    always: 'Connect to every site through the proxy.',
    byhost: 'Connect to the listed hosts through their proxy, and to every other site directly.',
    bypass: 'Connect to every site through the proxy, except the listed hosts.',
    clear: 'Surfingkeys leaves the proxy settings alone (the default).',
    direct: 'Connect to every site directly.',
    system: 'Use the proxy settings of the operating system.',
};
const TYPES = ['PROXY', 'SOCKS5', 'HTTPS', 'SOCKS4'];
const NEW_PAIR = 'SOCKS5 127.0.0.1:1080';

/*
 * "host:port" as typed, tidied, or null when it is not one. "localhost 8080" is
 * taken as localhost:8080, as the page always has; an IPv6 host goes in brackets.
 */
export function normalizeProxyServer(text) {
    const v = String(text || '').trim().replace(/[^\w\]]+([0-9]+)$/, ':$1');
    return /^(\[[0-9a-fA-F:.]+\]|[\w.-]+):\d{1,5}$/.test(v) ? v : null;
}

export default {
    id: 'proxy',
    title: 'Proxy',
    keywords: 'proxy socks http https pac network host hosts',
    available(ctx) {
        return ctx.browserName !== "Firefox" && !ctx.browserName.startsWith("Safari");
    },
    create(ctx, root) {
        const modeSelect = h('select', {id: 'proxyModeSelect', class: 'sk-input', 'aria-describedby': 'proxyModeHelp'},
            Object.keys(MODES).map((m) => h('option', {value: m}, m)));
        const modeHelp = h('p', {id: 'proxyModeHelp', class: 'sk-muted'});
        const pairs = h('div', {class: 'sk-proxypairs'});
        const addProxyPair = h('button', {type: 'button', id: 'addProxyPair', class: 'sk-btn'}, 'Add a proxy server');
        // the old page kept each server's markup in this template; kept for anyone who looks it up
        const template = h('template', {id: 'templateProxyPair'});
        root.append(
            h('p', {class: 'sk-lead'}, 'Let Surfingkeys set the browser’s proxy, for every site or per host.'),
            h('div', {id: 'proxySettings'},
                h('div', {id: 'proxyMode', class: 'sk-card sk-row', dataset: {keywords: Object.keys(MODES).join(' ')}},
                    h('label', {for: 'proxyModeSelect', class: 'sk-label'}, 'Mode'),
                    modeSelect,
                    modeHelp),
                pairs,
                h('div', {class: 'sk-actions'}, addProxyPair)),
            template);

        let conf = {proxyMode: 'clear', proxy: [], autoproxy_hosts: []};

        function update(data, done) {
            ctx.RUNTIME('updateProxy', data, function(res) {
                render(Object.assign(conf, res));
                done && done();
            });
        }

        modeSelect.addEventListener('change', () => {
            update({mode: modeSelect.value});
        });
        addProxyPair.addEventListener('click', () => {
            update({
                number: pairs.querySelectorAll('.proxyPair').length,
                proxy: NEW_PAIR
            }, () => {
                const inputs = pairs.querySelectorAll('.proxyPair input.proxyServer');
                inputs.length && inputs[inputs.length - 1].focus();
            });
        });

        function pairCard(proxy, number, mode) {
            // nothing stored yet (always, before a server is entered): an empty field
            const [type, server] = proxy ? proxy.split(/\s+/) : ['PROXY', ''];
            const id = `proxyServer${number}`;
            const typeSelect = h('select', {id: `proxyType${number}`, class: 'sk-input'},
                TYPES.map((t) => h('option', {value: t}, t)));
            typeSelect.value = TYPES.indexOf(type) !== -1 ? type : 'PROXY';
            const serverInput = h('input', {type: 'text', id, class: 'sk-input proxyServer', value: server || '',
                placeholder: '192.168.1.100:8080', spellcheck: 'false', 'aria-describedby': `${id}Error`});
            const error = h('p', {id: `${id}Error`, class: 'sk-error', hidden: true}, 'Enter a host and a port, like 127.0.0.1:1080.');
            function saveServer() {
                const v = normalizeProxyServer(serverInput.value);
                error.hidden = !!v;
                serverInput.setAttribute('aria-invalid', v ? 'false' : 'true');
                if (v) {
                    update({number, proxy: `${typeSelect.value} ${v}`});
                }
            }
            typeSelect.addEventListener('change', saveServer);
            serverInput.addEventListener('change', saveServer);
            serverInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    saveServer();
                }
            });

            const card = h('div', {class: 'proxyPair sk-card sk-row', number: String(number)},
                h('div', {class: 'sk-fields proxy'},
                    h('div', {class: 'sk-field sk-grow'}, h('label', {for: id, class: 'sk-label'}, 'Proxy server'), serverInput),
                    h('div', {class: 'sk-field'}, h('label', {for: typeSelect.id, class: 'sk-label'}, 'Type'), typeSelect)),
                error);
            if (mode !== 'always' && conf.proxy.length > 1) {
                const remove = h('button', {type: 'button', id: `proxyRemove${number}`, class: 'sk-btn deleteProxyPair'}, 'Remove this server');
                remove.addEventListener('click', () => update({number, operation: 'deleteProxyPair'}));
                card.append(h('div', {class: 'sk-actions'}, remove));
            }
            if (mode !== 'always') {
                card.append(hostList(number, mode));
            }
            return card;
        }

        function hostList(number, mode) {
            const hosts = (conf.autoproxy_hosts[number] || []).slice().sort();
            const id = `proxyHosts${number}`;
            const input = h('input', {type: 'text', id, class: 'sk-input', placeholder: 'google.*, youtube.com', spellcheck: 'false'});
            const add = h('button', {type: 'button', id: `${id}Add`, class: 'sk-btn'}, 'Add');
            function addHosts() {
                const host = input.value.trim();
                if (host) {
                    update({number, host, operation: 'add'}, () => {
                        const again = document.getElementById(id);
                        again && again.focus();
                    });
                }
            }
            add.addEventListener('click', addHosts);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    addHosts();
                }
            });
            const chips = hosts.map((host, i) => {
                const chip = h('button', {type: 'button', class: 'sk-chip', 'aria-label': `Remove ${host}`},
                    host, h('span', {'aria-hidden': 'true'}, ' ×'));
                chip.addEventListener('click', () => update({number, host, operation: 'remove'}, () => {
                    // focus the chip that took this one's place, or the input when none is left
                    const left = document.querySelectorAll(`.proxyPair[number="${number}"] .sk-chip`);
                    (left[Math.min(i, left.length - 1)] || document.getElementById(id)).focus();
                }));
                return h('li', null, chip);
            });
            return h('div', {class: 'autoproxy_hosts'},
                h('h3', null, mode === 'bypass' ? 'Hosts that skip this proxy' : 'Hosts that use this proxy'),
                chips.length ? h('ul', {class: 'sk-chips'}, chips) : h('p', {class: 'sk-muted'}, 'No hosts yet.'),
                h('div', {class: 'sk-fields'},
                    h('div', {class: 'sk-field sk-grow'}, h('label', {for: id, class: 'sk-label'}, 'Add hosts, separated by commas'), input),
                    h('div', {class: 'sk-field sk-field-end'}, add)));
        }

        function render(rs) {
            conf = {
                proxyMode: rs.proxyMode || 'clear',
                proxy: rs.proxy || [],
                autoproxy_hosts: rs.autoproxy_hosts || [],
            };
            const mode = conf.proxyMode;
            modeSelect.value = mode;
            modeHelp.textContent = MODES[mode] || '';
            let servers = [];
            if (mode === 'always') {
                servers = [conf.proxy[0]];
            } else if (mode === 'byhost' || mode === 'bypass') {
                servers = conf.proxy;
            }
            // every redraw follows a change the user made here, often by leaving a
            // field for the next one: that one keeps focus in the new cards
            const focused = pairs.contains(document.activeElement) ? document.activeElement.id : '';
            pairs.replaceChildren(...servers.map((p, i) => pairCard(p, i, mode)));
            const again = focused && document.getElementById(focused);
            again && again.focus();
            addProxyPair.hidden = !(mode === 'byhost' || mode === 'bypass');
        }

        return {
            onSettings(rs) {
                render(rs);
            },
        };
    },
};
