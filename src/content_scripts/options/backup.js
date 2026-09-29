// Backup: export the settings to a versioned .json file, and import one (or what
// `yj` copied) after a preview of what it changes. The file format and what goes
// in it are common/settingsBackup.js.
import { buildExport, diffSettings, exportFileName, mentionsSecret, parseImport } from '../common/settingsBackup.js';
import { ask } from './ask.js';
import { h } from './dom.js';

// how the preview names each key
export const KEY_LABELS = {
    snippets: 'Settings script',
    localPath: 'Load settings from',
    showAdvanced: 'Advanced mode',
    basicMappings: 'Key changes',
    disabledSearchAliases: 'Turned-off search engines',
    blocklist: 'Sites where Surfingkeys is off',
    mouseSelectToQuery: 'Mouse-select search sites',
    noPdfViewer: 'PDF viewer',
    proxyMode: 'Proxy mode',
    proxy: 'Proxies',
    autoproxy_hosts: 'Proxied hosts',
    paletteTheme: 'Theme',
    marks: 'Marks',
    sessions: 'Saved sessions',
};

const MAX_FILE = 5 * 1024 * 1024;

function lineCount(text) {
    return text ? text.split('\n').length : 0;
}

/*
 * What an import stores, split the way the background takes it: `settings` for
 * updateSettings, and the theme pick, which lives apart (localData). Without the
 * script, the mode that would run it stays as it is too.
 */
export function importPlan(settings, {withScript = true, userScriptsOff = false} = {}) {
    const rest = Object.assign({}, settings);
    const plan = {settings: rest, theme: undefined, advancedHeldBack: false};
    if (rest.hasOwnProperty('paletteTheme')) {
        plan.theme = rest.paletteTheme;
        delete rest.paletteTheme;
    }
    if (!withScript) {
        delete rest.snippets;
        delete rest.localPath;
        delete rest.showAdvanced;
    }
    // the background refuses the whole write when it would switch advanced mode on
    // with user scripts off, so the switch alone is held back
    if (userScriptsOff && rest.showAdvanced === true) {
        delete rest.showAdvanced;
        plan.advancedHeldBack = true;
    }
    return plan;
}

export default {
    id: 'backup',
    title: 'Backup',
    keywords: 'backup export import file restore sync move json yj',
    create(ctx, root) {
        const { RUNTIME } = ctx;

        const includeData = h('input', {type: 'checkbox', id: 'backupIncludeData'});
        const secretNote = h('p', {id: 'backupSecretNote', class: 'sk-note sk-warn', hidden: true},
            'Your settings script looks like it holds a secret (a key, token or password). The exported file will contain it: keep the file private.');
        const exportButton = h('button', {type: 'button', id: 'backupExport', class: 'sk-btn sk-btn-primary'}, 'Export to a file');
        const fileInput = h('input', {type: 'file', id: 'backupFile', class: 'sk-vh', accept: '.json,application/json', tabindex: '-1', 'aria-hidden': 'true'});
        const importButton = h('button', {type: 'button', id: 'backupImport', class: 'sk-btn'}, 'Import from a file…');
        const importError = h('p', {id: 'backupImportError', class: 'sk-error', role: 'alert', hidden: true});

        root.append(
            h('p', {class: 'sk-lead'}, 'Move your settings to another browser, or keep a copy.'),
            h('div', {class: 'sk-card sk-row', dataset: {keywords: 'export save download file'}},
                h('h3', null, 'Export'),
                h('p', {class: 'sk-muted'}, 'Saves your settings to a .json file: the settings script, key changes, search engines, sites, proxy and theme. Find and command history and stored LLM credentials are never exported.'),
                h('p', {class: 'sk-check'}, includeData, h('label', {for: 'backupIncludeData'}, 'Include marks and saved sessions')),
                secretNote,
                h('div', {class: 'sk-actions'}, exportButton)),
            h('div', {class: 'sk-card sk-row', dataset: {keywords: 'import restore load file yj'}},
                h('h3', null, 'Import'),
                h('p', {class: 'sk-muted'}, 'Reads a file exported here, or the text ', h('kbd', null, 'yj'), ' copies saved as a file. You see what changes before anything is stored.'),
                h('div', {class: 'sk-actions'}, importButton, fileInput),
                importError));

        function showImportError(text) {
            importError.textContent = text || '';
            importError.hidden = !text;
        }

        // ------------------------------------------------------------ export
        exportButton.addEventListener('click', () => {
            exportButton.disabled = true;
            RUNTIME('getSettings', {key: 'RAW'}, (resp) => {
                exportButton.disabled = false;
                const now = new Date();
                const file = buildExport(resp && resp.settings, {
                    includeData: includeData.checked,
                    exportedAt: now.toISOString(),
                    extensionVersion: chrome.runtime.getManifest().version,
                });
                const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], {type: 'application/json'}));
                const a = h('a', {href: url, download: exportFileName(now), hidden: true});
                document.body.append(a);
                a.click();
                a.remove();
                // the download has its own copy once started
                setTimeout(() => URL.revokeObjectURL(url), 10000);
                ctx.announce(`Exported ${Object.keys(file.settings).length} settings`);
            });
        });

        // ------------------------------------------------------------ import
        importButton.addEventListener('click', () => {
            showImportError('');
            fileInput.value = '';
            fileInput.click();
        });
        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) {
                return;
            }
            if (file.size > MAX_FILE) {
                showImportError('This file is too large to be a Surfingkeys settings file.');
                return;
            }
            file.text().then((text) => {
                let parsed;
                try {
                    parsed = parseImport(text);
                } catch (e) {
                    showImportError(e.message);
                    return;
                }
                RUNTIME('getSettings', {key: 'RAW'}, (resp) => preview(file.name, parsed, (resp && resp.settings) || {}));
            }, () => showImportError('This file could not be read.'));
        });

        function keyList(title, keys, note) {
            if (!keys.length) {
                return null;
            }
            return h('div', {class: 'sk-import-group'},
                h('h4', null, title, note ? h('span', {class: 'sk-muted'}, ` · ${note}`) : null),
                h('ul', {class: 'sk-resetlist'}, keys.map((k) => h('li', {dataset: {key: k}}, KEY_LABELS[k] || k))));
        }

        function preview(name, parsed, current) {
            const diff = diffSettings(current, parsed.settings);
            const from = parsed.version === 0
                ? 'Settings copied with yj.'
                : `Exported ${parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString() : ''}${parsed.extensionVersion ? ` from Surfingkeys ${parsed.extensionVersion}` : ''}.`;
            const changes = diff.added.length + diff.changed.length;
            const body = h('div', {id: 'importPreview'},
                h('p', null, h('b', null, name), ' · ', from),
                changes ? null : h('p', null, 'Nothing in this file differs from your settings.'),
                keyList('New', diff.added),
                keyList('Replaced', diff.changed),
                keyList('Not in the file', diff.removed, 'kept as they are'),
                parsed.ignored.length ? h('p', {class: 'sk-muted'}, `Not imported: ${parsed.ignored.join(', ')}.`) : null);
            ask({
                id: 'importDialog',
                title: 'Import these settings?',
                body,
                choices: [{label: 'Import', value: 'import', primary: true, id: 'importConfirm'}],
            }).then((answer) => {
                if (answer === 'import') {
                    trust(parsed.settings);
                }
            });
        }

        function trust(settings) {
            const script = typeof settings.snippets === 'string' && settings.snippets.trim().length > 0;
            const path = typeof settings.localPath === 'string' && settings.localPath.trim().length > 0;
            if (!script && !path) {
                apply(settings, true);
                return;
            }
            const what = [];
            if (script) {
                what.push(`a settings script (${lineCount(settings.snippets)} lines)`);
            }
            if (path) {
                what.push(`an address to load settings from (${settings.localPath})`);
            }
            ask({
                id: 'importTrustDialog',
                title: 'Run the code in this file?',
                body: h('div', null,
                    h('p', null, `This file holds ${what.join(' and ')}. Its code will run on every page you visit, with the access Surfingkeys has there.`),
                    h('p', null, 'Import it only from a source you trust.')),
                choices: [
                    {label: 'Import without the script', value: 'without', id: 'importWithoutScript'},
                    {label: 'Import and run the script', value: 'with', danger: true, id: 'importWithScript'},
                ],
            }).then((answer) => {
                if (answer) {
                    apply(settings, answer === 'with');
                }
            });
        }

        function apply(settings, withScript) {
            const s = ctx.settings || {};
            const plan = importPlan(settings, {withScript, userScriptsOff: !!s.isMV3 && !s.isUserScriptsAvailable});
            const finish = (error) => {
                const setTheme = plan.theme !== undefined;
                if (setTheme) {
                    RUNTIME('localData', {data: {paletteTheme: plan.theme}});
                }
                ctx.refresh(() => {
                    let message = error || 'Settings imported';
                    if (!error && plan.advancedHeldBack) {
                        message = 'Settings imported. Advanced mode stays off until user scripts are allowed (see Advanced).';
                    }
                    ctx.announce(message, error || plan.advancedHeldBack ? 6000 : 2000);
                });
            };
            if (Object.keys(plan.settings).length) {
                RUNTIME('updateSettings', {settings: plan.settings}, (resp) => finish(resp && resp.error));
            } else {
                finish('');
            }
        }

        return {
            onSettings(rs) {
                secretNote.hidden = !mentionsSecret(rs.snippets);
            },
        };
    },
};
