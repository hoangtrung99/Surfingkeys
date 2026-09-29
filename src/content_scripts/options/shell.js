// The settings page: a header (version, "Find a setting", the mode), a sidebar of
// sections and one section on screen at a time. The sections themselves are
// modules listed in sections.js; this file builds the frame they live in, routes
// between them and hands them the settings.
//
// Opening the page must never write storage: scripts open it only to send
// messages from an extension page, and a write there would race theirs. Every
// write here follows something the user did.
import { THEME_KEY } from '../common/themes.js';
import { fold, h } from './dom.js';
import { landingSection, rememberSection, sectionFromHash } from './router.js';
import { pageScheme, pageThemeCss } from './tokens.js';
import SECTIONS from './sections.js';

function pageStorage() {
    try {
        return window.localStorage;
    } catch (e) {
        return null;
    }
}

/*
 * `deps` are what content.js hands pages/options.js. The sections get them on
 * `ctx`, with:
 *   ctx.browserName   getBrowserName()
 *   ctx.settings      the last full settings (null until the page has them),
 *                     kept in step with local storage
 *   ctx.frontCommand  a command to this page's Surfingkeys frontend, once loaded
 *   ctx.announce(msg) says msg in the live region and shows it as a banner
 *   ctx.refresh(cb)   re-reads the full settings and hands them to every section
 *   ctx.patch(diff)   merges a change just stored into ctx.settings, and hands
 *                     the result to every section
 *   ctx.show(id)      puts a section on screen
 */
export default function createSettingsPage(deps) {
    const ctx = Object.assign({}, deps, {
        browserName: deps.getBrowserName(),
        settings: null,
        frontCommand: null,
    });

    const nav = document.getElementById('settingsNav');
    const main = document.getElementById('settingsMain');
    const live = document.getElementById('settingsStatus');
    const filter = document.getElementById('settingsFilter');
    const noMatch = document.getElementById('settingsNoMatch');
    const modeChip = document.getElementById('settingsMode');
    const tokens = document.getElementById('sk_settings_tokens');

    // settings.css keeps focused controls this far below the top, clear of the
    // sticky header
    const header = document.querySelector('.sk-header');
    function headerHeight() {
        document.documentElement.style.setProperty('--sk-header-h', `${Math.ceil(header.getBoundingClientRect().height)}px`);
    }
    if (header) {
        headerHeight();
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(headerHeight).observe(header);
        }
    }

    const version = chrome.runtime.getManifest().version;
    document.getElementById('settingsVersion').textContent = version ? `v${version}` : '';

    ctx.announce = function(message, timeout) {
        // cleared first, so the same message twice is still read out twice
        live.textContent = '';
        setTimeout(() => {
            live.textContent = message;
        }, 50);
        deps.showBanner(message, timeout || 1500);
    };

    const sections = SECTIONS.filter((s) => !s.available || s.available(ctx)).map((def) => {
        const heading = h('h2', {id: `settingsHeading-${def.id}`, tabindex: '-1'}, def.title);
        const body = h('div', {class: 'sk-section-body'});
        const el = h('section', {
            id: `settings-${def.id}`,
            class: 'sk-section',
            'aria-labelledby': heading.id,
            hidden: true,
            dataset: {section: def.id},
        }, heading, body);
        main.insertBefore(el, noMatch);
        const link = h('a', {href: `#${def.id}`, id: `settingsLink-${def.id}`}, def.title);
        nav.querySelector('ul').append(h('li', null, link));
        return {def, el, link, api: {}, words: fold(`${def.title} ${def.keywords || ''}`)};
    });
    const byId = {};
    sections.forEach((s) => {
        byId[s.def.id] = s;
    });
    const ids = sections.map((s) => s.def.id);

    // one broken section must not take the others, or the page, down with it
    function each(hook, ...args) {
        sections.forEach((s) => {
            if (typeof s.api[hook] === 'function') {
                try {
                    s.api[hook](...args);
                } catch (e) {
                    console.error(`settings section ${s.def.id}: ${hook} failed`, e);
                }
            }
        });
    }

    // ------------------------------------------------------------ routing
    let current = null;
    function render() {
        const filtering = main.classList.contains('sk-filtering');
        sections.forEach((s) => {
            if (!filtering) {
                s.el.hidden = s.def.id !== current;
            }
            if (s.def.id === current) {
                s.link.setAttribute('aria-current', 'page');
            } else {
                s.link.removeAttribute('aria-current');
            }
        });
    }

    function show(id, remember) {
        if (!byId[id]) {
            return;
        }
        const changed = id !== current;
        current = id;
        if (filter.value || main.classList.contains('sk-filtering')) {
            // a section picked from the sidebar ends a search
            filter.value = '';
            applyFilter();
        }
        render();
        if (remember) {
            rememberSection(pageStorage(), id);
        }
        if (changed) {
            const api = byId[id].api;
            if (typeof api.onShow === 'function') {
                api.onShow();
            }
        }
    }
    ctx.show = function(id) {
        if (location.hash === `#${id}`) {
            show(id, true);
        } else {
            location.hash = id;
        }
    };

    window.addEventListener('hashchange', () => {
        const id = sectionFromHash(location.hash, ids);
        if (id) {
            show(id, true);
            window.scrollTo(0, 0);
        }
    });

    // ------------------------------------------------------------ Find a setting
    function applyFilter() {
        const terms = fold(filter.value).split(/\s+/).filter((t) => t.length);
        main.classList.toggle('sk-filtering', terms.length > 0);
        let found = 0;
        sections.forEach((s) => {
            const rows = Array.from(s.el.querySelectorAll('.sk-row'));
            if (!terms.length) {
                rows.forEach((r) => r.classList.remove('sk-filtered-out'));
                return;
            }
            const whole = terms.every((t) => s.words.includes(t));
            rows.forEach((r) => {
                const text = fold(r.dataset.filter !== undefined ? r.dataset.filter : `${r.textContent} ${r.dataset.keywords || ''}`);
                r.classList.toggle('sk-filtered-out', !whole && !terms.every((t) => text.includes(t)));
            });
            s.el.hidden = false;
            const shown = rows.some((r) => !r.classList.contains('sk-filtered-out') && r.getClientRects().length > 0);
            s.el.hidden = !shown && !whole;
            if (!s.el.hidden) {
                found++;
            }
        });
        noMatch.hidden = !terms.length || found > 0;
        const message = `No setting matches “${filter.value.trim()}”.`;
        if (noMatch.textContent !== message) {
            noMatch.textContent = message;
        }
        if (!terms.length) {
            render();
        }
    }
    // 'search' is the field's own clear (Esc, or its x button), which is no 'input'
    filter.addEventListener('input', applyFilter);
    filter.addEventListener('search', applyFilter);
    // Sections add rows as their data arrives. The filter's own message is left
    // out: writing it is a change here too, and reacting to it would never end.
    new MutationObserver((records) => {
        if (main.classList.contains('sk-filtering') && records.some((r) => !noMatch.contains(r.target))) {
            applyFilter();
        }
    }).observe(main, {childList: true, subtree: true});

    // ------------------------------------------------------------ colours
    let storedTheme;
    const systemDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    function applyTheme(stored) {
        storedTheme = stored;
        tokens.textContent = pageThemeCss(stored);
        document.documentElement.dataset.scheme = pageScheme(stored, !!(systemDark && systemDark.matches));
    }
    systemDark && systemDark.addEventListener && systemDark.addEventListener('change', () => applyTheme(storedTheme));
    applyTheme(undefined);
    if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.hasOwnProperty(THEME_KEY)) {
                applyTheme(changes[THEME_KEY].newValue);
                each('onTheme', changes[THEME_KEY].newValue);
            }
            // Local storage is where every write lands first, so ctx.settings
            // follows it. Sections keep their own state after a write and read
            // ctx.settings again on each hand-out (a mode switch): a copy left at
            // what the page loaded would roll them back, and their next write
            // would store that rollback.
            if (area === 'local' && ctx.settings) {
                // a copy: the object handed out may be content.js's own
                ctx.settings = Object.assign({}, ctx.settings);
                Object.keys(changes).forEach((k) => {
                    if (changes[k].hasOwnProperty('newValue')) {
                        ctx.settings[k] = changes[k].newValue;
                    } else {
                        delete ctx.settings[k];
                    }
                });
            }
            each('onStorage', changes, area);
        });
    }

    // ------------------------------------------------------------ settings
    function setMode(rs) {
        const advanced = !!rs.showAdvanced;
        modeChip.textContent = advanced ? 'Advanced mode · script' : 'Basic mode';
        modeChip.classList.toggle('sk-mode-advanced', advanced);
    }
    function handOut(rs) {
        ctx.settings = rs;
        setMode(rs);
        each('onSettings', rs);
        if (main.classList.contains('sk-filtering')) {
            applyFilter();
        }
    }
    ctx.patch = function(diff) {
        handOut(Object.assign({}, ctx.settings, diff));
    };
    ctx.refresh = function(cb) {
        deps.RUNTIME('getSettings', null, (resp) => {
            handOut(resp.settings);
            cb && cb(resp.settings);
        });
    };

    document.addEventListener('surfingkeys:defaultSettingsLoaded', (evt) => {
        // Surfingkeys blurs a field that takes focus before the first click, to
        // stop pages grabbing focus on load. Nothing on this page does that, and
        // left on, the guard keeps Tab from ever reaching a field here.
        evt.detail.normal.passFocus(true);
        each('onDefaults', evt.detail);
    });
    document.addEventListener('surfingkeys:userSettingsLoaded', (evt) => {
        const { settings, frontCommand } = evt.detail;
        ctx.frontCommand = frontCommand;
        handOut(settings);
        if ('error' in settings) {
            ctx.announce(settings.error, 5000);
        }
    });

    sections.forEach((s) => {
        s.api = s.def.create(ctx, s.el.querySelector('.sk-section-body')) || {};
    });
    deps.RUNTIME('localData', {data: THEME_KEY}, (res) => {
        const stored = res && res.data ? res.data[THEME_KEY] : undefined;
        applyTheme(stored);
        each('onTheme', stored);
    });

    const landing = landingSection(location.hash, pageStorage(), ids);
    show(landing, false);
    if (location.hash !== `#${landing}`) {
        history.replaceState(null, '', `#${landing}`);
    }
    return ctx;
}
