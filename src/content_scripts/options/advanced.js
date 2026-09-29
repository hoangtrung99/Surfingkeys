// Advanced: the settings script (snippets) in an Ace editor, the switch that makes
// Surfingkeys run it (showAdvanced), and "Load settings from" (localPath). In MV3
// the script runs as a user script, which the browser allows only once the user
// turns that on for Surfingkeys: the page says when it is off and notices the
// moment it is turned on.
import { NATIVE_LOCAL_PATH } from '../../common/utils.js';
import { aceCss } from '../common/themeCss.js';
import { ask } from './ask.js';
import { h } from './dom.js';

// `<native>` names the file the native app reads rather than a location this page
// can resolve, so it must reach the background verbatim; a bare path becomes a
// file:// URL.
export function getURIPath(fn) {
    if (fn === NATIVE_LOCAL_PATH) {
        return fn;
    }
    if (fn.length && !/^\w+:\/\/\w+/i.test(fn) && fn.indexOf('file:///') === -1) {
        fn = fn.replace(/\\/g, '/');
        if (fn[0] === '/') {
            fn = fn.substr(1);
        }
        fn = "file:///" + fn;
    }
    return fn;
}

// Ace's lint results, as counts: {errors, warnings}.
export function lintCounts(annotations) {
    const out = {errors: 0, warnings: 0};
    (annotations || []).forEach((a) => {
        if (a.type === 'error') {
            out.errors++;
        } else if (a.type === 'warning') {
            out.warnings++;
        }
    });
    return out;
}

function plural(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function lintSummary({errors, warnings}) {
    const parts = [];
    errors && parts.push(plural(errors, 'error'));
    warnings && parts.push(plural(warnings, 'warning'));
    return parts.join(' · ');
}

// The settings script is stored but cannot run: MV3 runs it only as a user script.
export function scriptNotRunning(rs) {
    return !!(rs && rs.isMV3 && !rs.isUserScriptsAvailable && typeof rs.snippets === 'string' && rs.snippets.trim().length);
}

// chrome.userScripts is there only while "Allow User Scripts" is on, and getScripts
// throws once it is turned off again.
export function userScriptsAllowed() {
    try {
        return Promise.resolve(chrome.userScripts.getScripts()).then(() => true, () => false);
    } catch (e) {
        return Promise.resolve(false);
    }
}

function lineCount(text) {
    return text.replace(/\n+$/, '').split('\n').length;
}

function clock(date) {
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

export default {
    id: 'advanced',
    title: 'Advanced',
    keywords: 'advanced script snippet snippets javascript code editor api settings file url load user scripts developer lint',
    create(ctx, root) {
        const { RUNTIME, Mode } = ctx;
        const browserName = ctx.browserName;
        const sample = document.getElementById("sample").textContent;
        const pageTitle = document.title;

        const style = h('style', {id: 'sk_settings_editor'});
        style.textContent = aceCss('#mappings');
        document.head.append(style);

        const openDetails = () => {
            // a link cannot open a chrome:// page, a tab can
            chrome.tabs.create({url: `chrome://extensions/?id=${chrome.runtime.id}`});
        };

        // on top of every section: a script that silently stopped running is what
        // this page most needs to say, wherever the user is
        const notRunning = h('div', {id: 'snippetNotRunning', class: 'sk-note sk-warn sk-pagenote', role: 'status', hidden: true});
        const main = root.closest('main') || document.getElementById('settingsMain');
        main && main.prepend(notRunning);

        const userScriptsStatus = h('p', {id: 'userScriptsStatus', class: 'sk-userscripts-state'});
        const userScriptsSteps = h('ol', {id: 'userScriptsSteps', class: 'sk-steps'},
            h('li', null, 'Open the Surfingkeys details in the browser’s extensions page.'),
            h('li', null, 'Turn on ', h('b', null, 'Allow User Scripts'), ' (on older Chrome, turn on ', h('b', null, 'Developer mode'), ' at the top of the extensions page instead).'),
            h('li', null, 'Come back to this tab: it notices on its own.'));
        const extensionDetails = h('button', {type: 'button', id: 'openExtensionDetails', class: 'sk-btn'}, 'Open extension details');
        extensionDetails.addEventListener('click', openDetails);
        const userScriptsCard = h('div', {id: 'userScriptsCard', class: 'sk-card sk-row', hidden: true,
            dataset: {keywords: 'user scripts allow developer mode extension details mv3'}},
        h('h3', null, 'User scripts'),
        userScriptsStatus,
        userScriptsSteps,
        h('div', {class: 'sk-actions'}, extensionDetails));

        const advancedToggler = h('input', {id: 'advancedToggler', type: 'checkbox', role: 'switch', class: 'sk-switch'});
        const advancedTip = h('p', {id: 'advancedTip', class: 'sk-muted'},
            'Write your settings as a JavaScript script: mappings, search engines and everything else the API offers.');
        const localPathInput = h('input', {type: 'text', id: 'localPath', name: 'localPath', class: 'sk-input',
            placeholder: 'https://…, /home/me/.surfingkeys.js or <native>', spellcheck: 'false'});
        const localPathHelpForFile = h('p', {id: 'localPathHelpForFile'},
            'To load a local file, turn on ', h('b', null, 'Allow access to file URLs'),
            ' for Surfingkeys in the browser’s extension details, then enter the full path of the file, for example /home/brook/.surfingkeys.js.');
        const localPathHelpForNative = h('p', {id: 'localPathHelpForNative'},
            'Enter ', h('b', null, '<native>'), ' to read ', h('b', null, '~/.surfingkeys.js'),
            ' through the native app. Safari does this on its own; other browsers need the ',
            h('a', {href: 'https://github.com/brookhong/Surfingkeys/blob/master/src/nvim/server/Readme.md', target: '_blank', rel: 'noopener'}, 'native messaging host'),
            ' installed.');
        const localPathStatus = h('p', {id: 'localPathStatus', class: 'sk-loadstatus', hidden: true});
        const localPathReload = h('button', {type: 'button', id: 'localPathReload', class: 'sk-btn', hidden: true}, 'Reload now');
        const saveButton = h('button', {type: 'button', id: 'save_button', class: 'sk-btn sk-btn-primary'}, 'Save');
        const saveStatus = h('span', {class: 'sk-save-status', id: 'saveStatus', 'aria-live': 'polite'});
        const lintStatus = h('span', {class: 'sk-lint-status', id: 'lintStatus'});
        const editorHost = h('div', {id: 'mappings'});
        const advancedSetting = h('div', {id: 'advancedSetting', hidden: true},
            h('div', {id: 'localPathForSettings', class: 'sk-card sk-row'},
                h('label', {for: 'localPath', class: 'sk-label'}, 'Load settings from'),
                localPathInput,
                h('div', {class: 'sk-loadrow'}, localPathStatus, localPathReload),
                h('details', {id: 'localPathHelp', class: 'sk-help'},
                    h('summary', null, 'What can settings be loaded from?'),
                    h('p', null, 'A URL in http or https, for example a raw gist.'),
                    localPathHelpForFile,
                    localPathHelpForNative),
                h('p', {class: 'sk-muted'}, 'Saved with the script below. When set, the file replaces the script each time settings load.')),
            h('div', {class: 'sk-card sk-row', dataset: {keywords: 'save editor script lint errors'}},
                h('div', {class: 'sk-toolbar'},
                    h('h3', null, 'Settings script'),
                    lintStatus,
                    saveStatus,
                    saveButton),
                h('p', {class: 'sk-muted'}, 'See ',
                    h('a', {href: 'https://github.com/brookhong/Surfingkeys#edit-your-own-settings', target: '_blank', rel: 'noopener'}, 'how to write your own settings'),
                    '. ', h('kbd', null, 'Ctrl-s'), ' (', h('kbd', null, '⌘-s'), ' on a Mac) or ', h('kbd', null, ':w'), ' in the editor saves too.'),
                h('div', {id: 'mappings_container'}, editorHost)));
        root.append(
            userScriptsCard,
            h('div', {class: 'sk-card sk-row', dataset: {keywords: 'advanced mode toggle user scripts'}},
                h('div', {class: 'sk-switchrow'},
                    advancedToggler,
                    h('label', {for: 'advancedToggler', class: 'sk-switchlabel'}, 'Advanced mode: use a settings script')),
                advancedTip),
            advancedSetting);

        if (browserName.startsWith("Safari")) {
            localPathHelpForFile.remove();
            if (browserName === "Safari-iOS") {
                // <native> reads ~/.surfingkeys.js through the app, and an iOS app has no
                // accessible home directory to point that at. Advertising it here just
                // sends the user chasing a read that can never succeed.
                localPathHelpForNative.remove();
            }
        }

        let mappingsEditor = null;
        function createMappingEditor(elm) {
            // The lint worker is the one webpack ships next to this page, loaded by its
            // URL: Ace's default builds it from a blob: URL, which the extension CSP
            // (script-src 'self') refuses, and then nothing is ever linted.
            ace.config.set('loadWorkerFromBlob', false);
            ace.config.setModuleUrl('ace/mode/javascript_worker', chrome.runtime.getURL('pages/worker-javascript.js'));
            const _ace = ace.edit(elm);
            _ace.mode = "normal";

            const self = new Mode("mappingsEditor");

            self.container = _ace.container;
            self.ace = _ace;
            self.setValue = function(v, cursorPos) {
                _ace.setValue(v, cursorPos);
            };
            self.getValue = function() {
                return _ace.getValue();
            };

            self.addEventListener('keydown', function(event) {
                event.sk_suppressed = true;
                if (Mode.isSpecialKeyOf("<Esc>", event.sk_keyName)
                    && _ace.mode === 'normal' // vim in normal mode
                    && (_ace.state.cm.state.vim.status === null || _ace.state.cm.state.vim.status === "") // and no pending normal operation
                ) {
                    document.activeElement.blur();
                    self.exit();
                }
            });
            elm.querySelector('textarea').addEventListener('focus', function() {
                setTimeout(function() {
                    self.enter(0, true);
                }, 10);
            });

            // the Ace theme only brings the syntax colours for light pages: settings.css
            // recolours them on dark ones, and aceCss() everything else
            _ace.setTheme("ace/theme/chrome");
            ace.config.loadModule('ace/ext/language_tools', function (mod) {
                ace.config.loadModule('ace/autocomplete', function (mod) {
                    mod.Autocomplete.startCommand.bindKey = "Tab";
                    mod.Autocomplete.prototype.commands['Space'] = mod.Autocomplete.prototype.commands['Tab'];
                    mod.Autocomplete.prototype.commands['Tab'] = mod.Autocomplete.prototype.commands['Down'];
                    mod.Autocomplete.prototype.commands['Shift-Tab'] = mod.Autocomplete.prototype.commands['Up'];
                });
                _ace.setOptions({
                    enableBasicAutocompletion: true,
                    enableLiveAutocompletion: false,
                    enableSnippets: false
                });
            });
            _ace.setKeyboardHandler('ace/keyboard/vim', function() {
                var cm = _ace.state.cm;
                cm.on('vim-mode-change', function(data) {
                    _ace.mode = data.mode;
                });
                cm.constructor.Vim.defineEx("write", "w", function(cm, input) {
                    saveSettings();
                });
                cm.constructor.Vim.defineEx("quit", "q", function(cm, input) {
                    window.close();
                });
            });
            const session = _ace.getSession();
            session.setMode("ace/mode/javascript");
            _ace.$blockScrolling = Infinity;
            session.on('changeAnnotation', showLint);
            _ace.on('change', () => {
                lintStale = true;
                showDirty();
            });

            return self;
        }

        let localPathSaved = "";
        // the script last put in the editor from storage: a later handout with the
        // same script (a mode switch) must not wipe edits not saved yet
        let shownSnippets = null;
        // the editor text that matches storage (the sample when nothing is
        // stored): anything else in the editor is an edit Save has not stored
        let savedValue = null;
        // Ace reports a replaced text as a removal, then an insertion: the page
        // must not show the empty editor between them as an edit
        let replacing = false;
        let available = true;
        let saving = false;
        let lint = {errors: 0, warnings: 0};
        // The lint worker answers a moment after each change. `lintStale` says the
        // text changed since its last answer; `linting` that it has answered at
        // all, so a page without the worker never waits for one.
        let lintStale = false;
        let linting = false;

        function showEditor(flag) {
            advancedSetting.hidden = !flag;
            advancedToggler.checked = flag;
            if (flag && mappingsEditor) {
                mappingsEditor.ace.resize(true);
            }
        }

        function setStatus(text) {
            saveStatus.textContent = text;
        }

        function isDirty() {
            if (!mappingsEditor || savedValue === null) {
                return false;
            }
            return mappingsEditor.getValue() !== savedValue || localPathInput.value.trim() !== localPathSaved;
        }

        function showDirty() {
            if (replacing) {
                return;
            }
            const dirty = isDirty();
            const title = dirty ? `• ${pageTitle}` : pageTitle;
            if (document.title !== title) {
                document.title = title;
            }
            saveButton.classList.toggle('sk-dirty', dirty);
            if (dirty && !saving && saveStatus.textContent !== 'Unsaved changes') {
                setStatus('Unsaved changes');
            } else if (!dirty && saveStatus.textContent === 'Unsaved changes') {
                setStatus('');
            }
        }

        function showLint() {
            lintStale = false;
            linting = true;
            lint = lintCounts(mappingsEditor.ace.getSession().getAnnotations());
            lintStatus.textContent = lintSummary(lint);
            lintStatus.classList.toggle('sk-lint-errors', lint.errors > 0);
        }

        // puts text from storage in the editor, as the new saved state
        function loadEditor(text) {
            savedValue = text;
            replacing = true;
            mappingsEditor.setValue(text, -1);
            replacing = false;
            showDirty();
        }

        function lastLoad(ok, detail) {
            localPathStatus.hidden = false;
            localPathStatus.classList.toggle('sk-error', !ok);
            localPathStatus.textContent = ok
                ? `Loaded at ${clock(new Date())}.`
                : `Not loaded at ${clock(new Date())}: ${detail || 'the file could not be read'}. The copy loaded last is kept.`;
        }
        function showLocalPath() {
            localPathReload.hidden = !localPathSaved;
            if (!localPathSaved) {
                localPathStatus.hidden = true;
            }
        }

        function loadFrom(localPath, settingsCode) {
            saving = true;
            saveButton.disabled = true;
            localPathReload.disabled = true;
            setStatus('Loading…');
            RUNTIME('loadSettingsFromUrl', {
                url: localPath
            }, function(res) {
                saving = false;
                saveButton.disabled = false;
                localPathReload.disabled = false;
                const from = localPath === NATIVE_LOCAL_PATH ? "~/.surfingkeys.js" : localPath;
                const message = res.status + ' to load settings from ' + from + (res.error ? ': ' + res.error : '');
                setStatus(res.error ? 'Not loaded' : 'Loaded');
                lastLoad(!res.error, res.error);
                ctx.announce(message, 5000);
                if (res.snippets && res.snippets.length) {
                    localPathSaved = localPath;
                    shownSnippets = res.snippets;
                    loadEditor(res.snippets);
                    showLocalPath();
                } else if (settingsCode === "") {
                    loadEditor(sample);
                }
            });
        }

        function store(settingsCode, localPath) {
            saving = true;
            saveButton.disabled = true;
            setStatus('Saving…');
            // "Saved" waits for the reply: the background answers once the
            // script is stored and registered, so a page opened after it runs
            // the new code.
            RUNTIME('updateSettings', {
                settings: {
                    snippets: settingsCode,
                    // The trimmed value, so a stray space cannot turn `<native>`
                    // into a file:// path that reads nothing.
                    localPath: localPath
                }
            }, function(resp) {
                saving = false;
                saveButton.disabled = false;
                if (resp && resp.error) {
                    setStatus('Failed');
                    ctx.announce(resp.error, 5000);
                } else {
                    shownSnippets = settingsCode;
                    savedValue = settingsCode;
                    localPathSaved = localPath;
                    showLocalPath();
                    setStatus(isDirty() ? 'Unsaved changes' : 'Saved');
                    showDirty();
                    ctx.announce('Settings saved');
                }
            });
        }

        // Save asks about the errors in the text being saved, so it waits for the
        // worker to lint the latest change (briefly: a slow answer is not waited out).
        function whenLinted(cb) {
            if (!lintStale || !linting) {
                cb();
                return;
            }
            const session = mappingsEditor.ace.getSession();
            let done = false;
            const finish = () => {
                if (!done) {
                    done = true;
                    session.off('changeAnnotation', finish);
                    cb();
                }
            };
            session.on('changeAnnotation', finish);
            setTimeout(finish, 1500);
        }

        function saveSettings() {
            if (saving) {
                return;
            }
            const settingsCode = mappingsEditor.getValue();
            const localPath = getURIPath(localPathInput.value.trim());
            if (localPath.length && localPath !== localPathSaved) {
                loadFrom(localPath, settingsCode);
                return;
            }
            saving = true;
            whenLinted(() => {
                saving = false;
                if (!lint.errors) {
                    store(settingsCode, localPath);
                    return;
                }
                const errors = mappingsEditor.ace.getSession().getAnnotations().filter((a) => a.type === 'error');
                ask({
                    id: 'saveErrorsDialog',
                    title: `Save a script with ${plural(errors.length || lint.errors, 'error')}?`,
                    body: h('div', null,
                        h('p', null, 'Pages will run the script as it is, and stop at the first error.'),
                        h('ul', {class: 'sk-resetlist'}, errors.slice(0, 3).map((a) => h('li', null, `Line ${a.row + 1}: ${a.text}`)))),
                    cancelLabel: 'Keep editing',
                    choices: [{label: 'Save anyway', value: 'save', id: 'saveAnyway'}],
                }).then((answer) => {
                    if (answer === 'save') {
                        store(settingsCode, localPath);
                    } else {
                        mappingsEditor.ace.focus();
                    }
                });
            });
        }
        saveButton.addEventListener('click', saveSettings);
        localPathInput.addEventListener('input', () => {
            setStatus('');
            showDirty();
        });
        localPathReload.addEventListener('click', () => {
            if (saving || !localPathSaved) {
                return;
            }
            const reload = () => loadFrom(localPathSaved, mappingsEditor.getValue());
            if (mappingsEditor.getValue() === savedValue) {
                reload();
                return;
            }
            ask({
                id: 'reloadDialog',
                title: 'Replace your unsaved edits?',
                body: h('p', null, 'Reloading puts the file’s script in the editor, in place of the edits not saved yet.'),
                choices: [{label: 'Reload and replace', value: 'reload', danger: true}],
            }).then((answer) => answer && reload());
        });

        // Ctrl-s / ⌘-s saves while the editor is on screen, in it or not. The page
        // listens before Surfingkeys does (it is set up first), so the browser's
        // "Save page" never opens over it.
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key && e.key.toLowerCase() === 's'
                && mappingsEditor && !advancedSetting.hidden && !root.closest('.sk-section').hidden
                && !document.querySelector('dialog[open]')) {
                e.preventDefault();
                e.stopImmediatePropagation();
                saveSettings();
            }
        }, true);

        // Surfingkeys' own keys work on this page, x (close tab) among them: edits
        // not saved yet are guarded against whatever closes it.
        window.addEventListener('beforeunload', (e) => {
            if (isDirty()) {
                e.preventDefault();
                e.returnValue = '';
            }
        });

        advancedToggler.addEventListener('change', () => {
            const flag = advancedToggler.checked;
            advancedToggler.disabled = true;
            RUNTIME('updateSettings', {
                settings: {
                    showAdvanced: flag
                }
            }, (resp) => {
                advancedToggler.disabled = !available;
                if (resp.error) {
                    advancedToggler.checked = !flag;
                    ctx.announce(resp.error, 3000);
                } else {
                    ctx.patch({showAdvanced: flag});
                    ctx.announce(flag ? 'Advanced mode on' : 'Advanced mode off');
                }
            });
        });

        function showUserScripts(rs) {
            userScriptsCard.hidden = !rs.isMV3;
            userScriptsStatus.textContent = available
                ? 'Allowed: Surfingkeys can run your settings script.'
                : 'Not allowed yet: the browser runs a settings script only once you allow user scripts for Surfingkeys.';
            userScriptsStatus.classList.toggle('sk-ok', available);
            userScriptsSteps.hidden = available;
            extensionDetails.hidden = available;

            notRunning.hidden = !scriptNotRunning(rs);
            if (!notRunning.hidden) {
                const n = lineCount(rs.snippets);
                const setup = h('button', {type: 'button', class: 'sk-btn'}, 'Allow user scripts…');
                setup.addEventListener('click', () => {
                    ctx.show('advanced');
                    openDetails();
                });
                notRunning.replaceChildren(
                    h('p', null, h('b', null, `Your settings script (${plural(n, 'line')}) is not running.`),
                        ' The browser runs it only once user scripts are allowed for Surfingkeys.'),
                    setup);
            }
        }

        // The browser's "Allow User Scripts" switch is flipped on another page, and
        // tells nobody: the page asks again whenever the user comes back to it. It
        // asks the API itself, which only reads: the full settings read that says
        // the same also re-registers the user script, and one per focus would race
        // the saves around it. That read is made only once the answer has changed.
        let checking = false;
        function recheck() {
            if (checking || document.visibilityState === 'hidden' || !ctx.settings || !ctx.settings.isMV3) {
                return;
            }
            checking = true;
            userScriptsAllowed().then((allowed) => {
                if (allowed === available) {
                    checking = false;
                    return;
                }
                ctx.refresh((rs) => {
                    checking = false;
                    ctx.announce(rs.isUserScriptsAvailable ? 'User scripts are allowed' : 'User scripts are no longer allowed');
                });
            });
        }
        window.addEventListener('focus', recheck);
        document.addEventListener('visibilitychange', recheck);

        let firstLoad = true;
        return {
            onSettings(rs) {
                if (!mappingsEditor) {
                    mappingsEditor = createMappingEditor(editorHost);
                }
                if (rs.isMV3) {
                    available = !!rs.isUserScriptsAvailable;
                    advancedToggler.disabled = !available;
                    advancedTip.textContent = available
                        ? 'Write your settings as a JavaScript script: mappings, search engines and everything else the API offers.'
                        : 'Allow user scripts first (above), then switch Advanced mode on.';
                    showEditor(available && !!rs.showAdvanced);
                } else {
                    showEditor(!!rs.showAdvanced);
                }
                showUserScripts(rs);
                if ((rs.localPath || "") !== localPathSaved) {
                    localPathInput.value = rs.localPath || "";
                    localPathSaved = rs.localPath || "";
                }
                // the settings the page opened with were just read from localPath
                if (firstLoad && localPathSaved) {
                    // start.js loadSettings words a failed read this way
                    const from = localPathSaved === NATIVE_LOCAL_PATH ? "~/.surfingkeys.js" : localPathSaved;
                    const prefix = `Failed to read snippets from ${from}`;
                    const failed = typeof rs.error === 'string' && rs.error.indexOf(prefix) === 0;
                    lastLoad(!failed, failed ? rs.error.slice(prefix.length).replace(/^: /, '') : '');
                }
                firstLoad = false;
                showLocalPath();
                const snippets = rs.snippets && rs.snippets.length ? rs.snippets : "";
                if (snippets !== shownSnippets) {
                    shownSnippets = snippets;
                    if (isDirty()) {
                        // edits in progress stay; Save would now replace what changed
                        savedValue = snippets || sample;
                        setStatus('The stored script changed; Save replaces it with yours');
                    } else {
                        loadEditor(snippets || sample);
                    }
                }
            },
            onShow() {
                if (mappingsEditor && !advancedSetting.hidden) {
                    mappingsEditor.ace.resize(true);
                }
            },
        };
    },
};
