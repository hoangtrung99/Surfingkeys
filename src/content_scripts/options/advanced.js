// Advanced: the settings script (snippets) in an Ace editor, the switch that makes
// Surfingkeys run it (showAdvanced), and "Load settings from" (localPath).
import { NATIVE_LOCAL_PATH } from '../../common/utils.js';
import { aceCss } from '../common/themeCss.js';
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

export default {
    id: 'advanced',
    title: 'Advanced',
    keywords: 'advanced script snippet snippets javascript code editor api settings file url load user scripts developer',
    create(ctx, root) {
        const { RUNTIME, Mode } = ctx;
        const browserName = ctx.browserName;
        const sample = document.getElementById("sample").textContent;

        const style = h('style', {id: 'sk_settings_editor'});
        style.textContent = aceCss('#mappings');
        document.head.append(style);

        const advancedToggler = h('input', {id: 'advancedToggler', type: 'checkbox', role: 'switch', class: 'sk-switch'});
        const extensionDetails = h('button', {type: 'button', class: 'sk-btn', hidden: true}, 'Open extension details');
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
        const saveButton = h('button', {type: 'button', id: 'save_button', class: 'sk-btn sk-btn-primary'}, 'Save');
        const saveStatus = h('span', {class: 'sk-save-status', id: 'saveStatus'});
        const editorHost = h('div', {id: 'mappings'});
        const advancedSetting = h('div', {id: 'advancedSetting', hidden: true},
            h('div', {id: 'localPathForSettings', class: 'sk-card sk-row'},
                h('label', {for: 'localPath', class: 'sk-label'}, 'Load settings from'),
                localPathInput,
                h('details', {id: 'localPathHelp', class: 'sk-help'},
                    h('summary', null, 'What can settings be loaded from?'),
                    h('p', null, 'A URL in http or https, for example a raw gist.'),
                    localPathHelpForFile,
                    localPathHelpForNative),
                h('p', {class: 'sk-muted'}, 'Saved with the script below. When set, the file replaces the script each time settings load.')),
            h('div', {class: 'sk-card sk-row', dataset: {keywords: 'save editor script'}},
                h('div', {class: 'sk-toolbar'},
                    h('h3', null, 'Settings script'),
                    saveStatus,
                    saveButton),
                h('p', {class: 'sk-muted'}, 'See ',
                    h('a', {href: 'https://github.com/brookhong/Surfingkeys#edit-your-own-settings', target: '_blank', rel: 'noopener'}, 'how to write your own settings'),
                    '. In the editor, ', h('kbd', null, ':w'), ' saves too.'),
                h('div', {id: 'mappings_container'}, editorHost)));
        root.append(
            h('div', {class: 'sk-card sk-row', dataset: {keywords: 'advanced mode toggle user scripts'}},
                h('div', {class: 'sk-switchrow'},
                    advancedToggler,
                    h('label', {for: 'advancedToggler', class: 'sk-switchlabel'}, 'Advanced mode: use a settings script')),
                advancedTip,
                extensionDetails),
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
        // a link cannot open a chrome:// page, a tab can
        extensionDetails.addEventListener('click', () => {
            chrome.tabs.create({url: `chrome://extensions/?id=${chrome.runtime.id}`});
        });

        let mappingsEditor = null;
        function createMappingEditor(elm) {
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
            _ace.getSession().setMode("ace/mode/javascript");
            _ace.$blockScrolling = Infinity;

            return self;
        }

        let localPathSaved = "";
        // the script last put in the editor from storage: a later handout with the
        // same script (a mode switch) must not wipe edits not saved yet
        let shownSnippets = null;
        let available = true;
        let saving = false;

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

        function saveSettings() {
            if (saving) {
                return;
            }
            const settingsCode = mappingsEditor.getValue();
            const localPath = getURIPath(localPathInput.value.trim());
            if (localPath.length && localPath !== localPathSaved) {
                saving = true;
                saveButton.disabled = true;
                setStatus('Loading…');
                RUNTIME('loadSettingsFromUrl', {
                    url: localPath
                }, function(res) {
                    saving = false;
                    saveButton.disabled = false;
                    const from = localPath === NATIVE_LOCAL_PATH ? "~/.surfingkeys.js" : localPath;
                    const message = res.status + ' to load settings from ' + from + (res.error ? ': ' + res.error : '');
                    setStatus(res.error ? 'Not loaded' : 'Loaded');
                    ctx.announce(message, 5000);
                    if (res.snippets && res.snippets.length) {
                        localPathSaved = localPath;
                        shownSnippets = res.snippets;
                        mappingsEditor.setValue(res.snippets, -1);
                    } else if (settingsCode === "") {
                        mappingsEditor.setValue(sample, -1);
                    }
                });
            } else {
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
                        setStatus('Saved');
                        ctx.announce('Settings saved');
                    }
                });
            }
        }
        saveButton.addEventListener('click', saveSettings);
        localPathInput.addEventListener('input', () => setStatus(''));

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

        return {
            onSettings(rs) {
                if (!mappingsEditor) {
                    mappingsEditor = createMappingEditor(editorHost);
                }
                if (rs.isMV3) {
                    available = !!rs.isUserScriptsAvailable;
                    advancedToggler.disabled = !available;
                    extensionDetails.hidden = available;
                    advancedTip.textContent = available
                        ? 'Write your settings as a JavaScript script: mappings, search engines and everything else the API offers.'
                        : "To use a settings script, first turn on 'Developer mode' in the browser's extensions page, then turn on 'Allow User Scripts' in the Surfingkeys details, then come back and switch Advanced mode on.";
                    showEditor(available && !!rs.showAdvanced);
                } else {
                    showEditor(!!rs.showAdvanced);
                }
                if ((rs.localPath || "") !== localPathSaved) {
                    localPathInput.value = rs.localPath || "";
                    localPathSaved = rs.localPath || "";
                }
                const snippets = rs.snippets && rs.snippets.length ? rs.snippets : "";
                if (snippets !== shownSnippets) {
                    shownSnippets = snippets;
                    mappingsEditor.setValue(snippets || sample, -1);
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
