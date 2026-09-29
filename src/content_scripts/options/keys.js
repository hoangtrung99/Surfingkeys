// Keys: every normal-mode mapping, grouped as the usage popup groups them, with
// a key of the user's own for any of them (basicMappings, {originKey: newKey | ""}).
// common/basicMappings.js ADDS the new key: the original one keeps working unless
// the action is turned off (an empty key) or another entry's new key takes it,
// and the rows say so (decision D1). keyConflicts.js tells what a
// change does to the other keys. Advanced mode ignores basicMappings
// (content.js applySettings), so the list is read-only there.
import { FEATURE_GROUPS, localizeAnnotation } from '../common/annotation.js';
import { SPECIAL_KEYS, conflictsFor, snippetLines, takenBy } from '../common/keyConflicts.js';
import { closeDialog, fold, h, openDialog } from './dom.js';
import { createShortcutsCard } from './shortcuts.js';

// the help group of a mapping without one
const MISC_GROUP = 14;
// how many keys a hint names before "and N more"
const HINT_WORDS = 6;

/*
 * The default normal-mode mappings as rows: {origin, annotation, group}, from the
 * metas of normal.mappings read before any remap applies, plus the <Alt-s> key,
 * which is a Mode special key rather than a mapping. Mappings without an
 * annotation have nothing to show and are left out.
 */
export function defaultMappings(metas, decode) {
    const rows = metas.filter((m) => m && m.annotation && m.word).map((m) => ({
        origin: decode(m.word),
        annotation: m.annotation,
        group: FEATURE_GROUPS[m.feature_group] !== undefined ? m.feature_group : MISC_GROUP,
    }));
    if (!rows.some((r) => r.origin === '<Alt-s>')) {
        rows.push({origin: '<Alt-s>', annotation: 'Toggle SurfingKeys on current site', group: 0, special: true});
    }
    return rows;
}

function listed(words, limit) {
    const shown = words.slice(0, limit).join(', ');
    return words.length > limit ? `${shown} and ${words.length - limit} more` : shown;
}

/*
 * A conflict hint in words. `labelOf(key)` names the action a default key runs;
 * a list of keys stops after `limit` of them.
 */
export function describeHint(hint, newKey, labelOf, limit = HINT_WORDS) {
    switch (hint.type) {
    case 'special':
        return `${hint.key} is a key Surfingkeys handles itself (${hint.key === '<Esc>' ? 'it leaves every mode' : 'it turns Surfingkeys on and off for a site'}), so the action may never see it.`;
    case 'overrides':
        return `${hint.word} stops running “${labelOf(hint.word)}”.`;
    case 'duplicate':
        return `${newKey} is already the new key of ${hint.origins.map((o) => `“${labelOf(o)}”`).join(', ')}: only one of them gets it.`;
    case 'shadows':
        return `${listed(hint.words, limit)} stop working: ${newKey} runs as soon as it is typed.`;
    case 'unreachable':
        return `${newKey} never runs: ${listed(hint.words, limit)} runs as soon as it is typed.`;
    case 'stillBound':
        return `${hint.word} still works too.`;
    case 'originShadowed':
        return `${hint.word} stops working too: ${hint.key}, the new key of another action, runs as soon as it is typed.`;
    }
    return '';
}

export default {
    id: 'keys',
    title: 'Keys',
    keywords: 'key keys mapping mappings remap shortcut shortcuts keyboard',
    create(ctx, root) {
        const { KeyboardUtils, Mode, RUNTIME, reportIssue } = ctx;
        let actions = [];
        let remaps = {};
        let advanced = false;
        let locale = null;

        const shortcuts = createShortcutsCard(ctx);
        const copy = h('button', {type: 'button', class: 'sk-btn', id: 'keysCopySnippet'}, 'Copy as api.map / api.unmap lines');
        const advancedNote = h('div', {class: 'sk-note', hidden: true},
            h('p', null, 'Advanced mode is on, so the keys below are not used: your settings script decides them. To keep your key changes, add these lines to it.'),
            copy);
        const filter = h('input', {type: 'search', id: 'keysFilter', class: 'sk-input', placeholder: 'Filter by action or key',
            autocomplete: 'off', spellcheck: 'false', 'aria-controls': 'basicMappings'});
        const filterCount = h('span', {class: 'sk-muted', id: 'keysFilterCount', 'aria-live': 'polite'});
        const resetAll = h('button', {type: 'button', class: 'sk-btn', id: 'keysResetAll'}, 'Reset all key changes');
        const noMatch = h('p', {class: 'sk-muted', hidden: true}, 'No action or key matches.');
        const list = h('div', {id: 'basicMappings', class: 'sk-keylist'});
        root.append(
            shortcuts.card,
            h('p', {class: 'sk-lead'}, 'Give any action a key of your own. The new key is added and the original key keeps working; Disable turns the action off. Keys set in your settings script are not listed here, and conflicts with them cannot be checked.'),
            advancedNote,
            h('div', {class: 'sk-keytools'},
                h('div', {class: 'sk-field sk-grow'}, h('label', {class: 'sk-label', for: 'keysFilter'}, 'Filter keys'), filter),
                filterCount, resetAll),
            noMatch,
            list);

        // ------------------------------------------------------------ key picker
        const inputKey = h('kbd', {id: 'inputKey', 'aria-live': 'polite'}, ' ');
        const pickerTitle = h('h3', {id: 'keyPickerTitle'}, 'Press the new key');
        const pickerLead = h('p', {class: 'sk-muted', id: 'keyPickerLead'});
        const pickerHints = h('ul', {class: 'sk-keyhints', id: 'keyPickerHints', 'aria-live': 'polite'});
        const pressed = h('div', {class: 'pressedKey', tabindex: '-1'}, inputKey);
        const pickerCancel = h('button', {type: 'button', class: 'sk-btn'}, 'Cancel');
        const pickerSave = h('button', {type: 'button', class: 'sk-btn sk-btn-primary'}, 'Save');
        const picker = h('dialog', {id: 'keyPicker', class: 'sk-dialog', 'aria-labelledby': 'keyPickerTitle', 'aria-describedby': 'keyPickerLead'},
            pickerTitle,
            pickerLead,
            h('p', {class: 'sk-muted'}, 'The first key pressed replaces the current one. ', h('kbd', null, 'Backspace'), ' deletes backward, ', h('kbd', null, 'Enter'), ' saves, ',
                h('kbd', null, 'Esc'), ' cancels. No key at all turns the action off.'),
            pressed,
            pickerHints,
            h('div', {class: 'sk-actions'}, pickerCancel, pickerSave));
        document.body.append(picker);

        const resetCancel = h('button', {type: 'button', class: 'sk-btn'}, 'Cancel');
        const resetConfirm = h('button', {type: 'button', class: 'sk-btn sk-btn-danger', id: 'keysResetAllConfirm'}, 'Reset all');
        const resetText = h('p');
        const resetDialog = h('dialog', {id: 'keysResetDialog', class: 'sk-dialog', 'aria-labelledby': 'keysResetTitle'},
            h('h3', {id: 'keysResetTitle'}, 'Reset all key changes?'),
            resetText,
            h('div', {class: 'sk-actions'}, resetCancel, resetConfirm));
        document.body.append(resetDialog);

        // ------------------------------------------------------------ rows
        // Rows are built once and updated in place, so a button that opened a
        // dialog is still there to take focus back when it closes.
        const rows = new Map();
        const labels = new Map();
        function labelOf(origin) {
            return labels.get(origin) || origin;
        }
        function words() {
            return actions.map((a) => a.origin);
        }
        function specialKeys() {
            return Mode.specialKeys ? Object.keys(Mode.specialKeys) : SPECIAL_KEYS;
        }
        function customised(origin) {
            return Object.prototype.hasOwnProperty.call(remaps, origin) && remaps[origin] !== origin;
        }

        function build() {
            if (!locale || !actions.length) {
                return;
            }
            rows.clear();
            labels.clear();
            actions.forEach((a) => {
                labels.set(a.origin, localizeAnnotation(locale, a.annotation));
            });
            const groups = FEATURE_GROUPS.map(() => []);
            actions.forEach((a) => groups[a.group].push(a));
            list.replaceChildren(...groups.map((members, g) => {
                if (!members.length) {
                    return null;
                }
                members.sort((a, b) => labelOf(a.origin).localeCompare(labelOf(b.origin)) || a.origin.localeCompare(b.origin));
                const heading = h('h3', {id: `keysGroup-${g}`}, locale(FEATURE_GROUPS[g]));
                return h('div', {class: 'sk-card sk-keygroup', role: 'group', 'aria-labelledby': heading.id},
                    heading, members.map(buildRow));
            }).filter((g) => g));
            update();
        }

        function buildRow(a) {
            const label = labelOf(a.origin);
            const button = h('button', {type: 'button', class: 'sk-kbd', dataset: {origin: a.origin}});
            button.addEventListener('click', () => KeyPicker.enter(button, a.origin));
            const off = h('button', {type: 'button', class: 'sk-btn sk-btn-small sk-keyoff', 'aria-label': `Disable “${label}”`}, 'Disable');
            off.addEventListener('click', () => {
                store(a.origin, '');
                ctx.announce(`“${label}” turned off`);
                rows.get(a.origin).reset.focus();
            });
            // <Alt-s> is the key that turns Surfingkeys back on for a site: never off
            off.hidden = !!a.special;
            const reset = h('button', {type: 'button', class: 'sk-btn sk-btn-small sk-keyreset', 'aria-label': `Reset “${label}” to ${a.origin}`}, 'Reset');
            reset.addEventListener('click', () => {
                store(a.origin, a.origin);
                ctx.announce(`“${label}” is back on ${a.origin}`);
                button.focus();
            });
            const note = h('span', {class: 'sk-keynote'});
            const hint = h('p', {class: 'sk-keyhint', hidden: true});
            const row = h('div', {class: 'sk-keyrow sk-row', dataset: {word: a.origin}},
                h('div', {class: 'sk-keyaction'}, h('span', {class: 'annotation'}, label), hint),
                h('div', {class: 'sk-keycell'}, note, button, off, reset));
            rows.set(a.origin, {row, button, note, hint, off, reset, label, special: !!a.special});
            return row;
        }

        function update() {
            const all = words();
            let changes = 0;
            rows.forEach((r, origin) => {
                const custom = customised(origin) ? remaps[origin] : origin;
                const changed = custom !== origin;
                changes += changed ? 1 : 0;
                r.button.dataset.custom = custom;
                r.button.textContent = custom || 'Off';
                r.button.disabled = advanced;
                r.button.setAttribute('aria-label', `${r.label}: ${custom ? `key ${custom}` : 'turned off'}${changed && custom && takenBy(remaps, origin) === null ? `, ${origin} still works` : ''}. Change`);
                r.off.hidden = r.special || custom === '';
                r.off.disabled = advanced;
                r.reset.hidden = !changed;
                r.reset.disabled = advanced;
                // the original key keeps its action unless another row's new key takes it
                r.note.textContent = !changed ? '' : custom === '' ? `${origin} is off`
                    : takenBy(remaps, origin) !== null ? '' : `${origin} still works`;
                const hints = changed && custom ? conflictsFor(all, remaps, origin, custom, specialKeys()).filter((x) => x.type !== 'stillBound') : [];
                r.hint.hidden = !hints.length;
                r.hint.textContent = hints.map((x) => describeHint(x, custom, labelOf)).join(' ');
                r.row.classList.toggle('sk-keychanged', changed);
                r.row.dataset.keywords = `${origin} ${custom}`;
            });
            // entries for keys this page does not list (another build, a site-only mapping) count too
            const unlisted = Object.keys(remaps).filter((o) => !rows.has(o) && remaps[o] !== o).length;
            resetAll.disabled = advanced || !(changes + unlisted);
            copy.disabled = !Object.keys(remaps).length;
            applyFilter();
        }

        function applyFilter() {
            const terms = fold(filter.value).split(/\s+/).filter((t) => t.length);
            let shown = 0;
            rows.forEach((r, origin) => {
                const text = fold(`${r.label} ${origin} ${r.button.dataset.custom}`);
                const out = terms.length > 0 && !terms.every((t) => text.includes(t));
                r.row.classList.toggle('sk-keyfiltered', out);
                shown += out ? 0 : 1;
            });
            noMatch.hidden = !terms.length || shown > 0;
            filterCount.textContent = terms.length ? `${shown} of ${rows.size} actions` : '';
        }
        filter.addEventListener('input', applyFilter);
        filter.addEventListener('search', applyFilter);

        function write() {
            RUNTIME('updateSettings', {
                settings: {
                    basicMappings: remaps
                }
            });
            update();
        }

        // `key` equal to the origin puts the action back on its own key
        function store(origin, key) {
            remaps = Object.assign({}, remaps);
            if (key === origin) {
                delete remaps[origin];
            } else {
                remaps[origin] = key;
            }
            write();
        }

        resetAll.addEventListener('click', () => {
            const n = Object.keys(remaps).filter((o) => remaps[o] !== o).length;
            resetText.textContent = `${n === 1 ? '1 action goes' : `${n} actions go`} back to ${n === 1 ? 'its' : 'their'} default key, and turned-off actions come back on.`;
            openDialog(resetDialog);
            resetCancel.focus();
        });
        resetCancel.addEventListener('click', () => closeDialog(resetDialog));
        resetConfirm.addEventListener('click', () => {
            closeDialog(resetDialog);
            remaps = {};
            write();
            ctx.announce('All keys are back to their defaults');
        });
        copy.addEventListener('click', () => {
            navigator.clipboard.writeText(snippetLines(remaps)).then(() => {
                ctx.announce('Copied');
            }, (e) => {
                ctx.announce(`Could not copy: ${e.message}`);
            });
        });

        const KeyPicker = (function() {
            const self = new Mode("KeyPicker");
            let _key = "";
            // _key is still the row's current key, as if selected: the first key
            // pressed replaces it and Backspace clears it
            let _selected = false;
            // the row being changed, null while the picker is closed
            let _origin = null;

            // <Alt-s> is the key that turns Surfingkeys back on for a site
            function mayTurnOff() {
                const r = rows.get(_origin);
                return !(r && r.special);
            }
            function showKey() {
                inputKey.textContent = _key || ' ';
                inputKey.classList.toggle('sk-keyselected', _selected && _key !== '');
                pickerSave.disabled = _key === '' && !mayTurnOff();
                const hints = conflictsFor(words(), remaps, _origin, _key, specialKeys());
                const lines = _key === '' ? [mayTurnOff() ? 'No key: the action is turned off.' : 'This action cannot be turned off: press a key for it.']
                    : _key === _origin ? ['The default key.']
                        : hints.map((x) => describeHint(x, _key, labelOf, Infinity));
                pickerHints.replaceChildren(...lines.map((text, i) => h('li', {class: hints[i] && hints[i].type !== 'stillBound' ? 'sk-keywarn' : ''}, text)));
            }
            function close() {
                _origin = null;
                self.exit();
                closeDialog(picker);
            }
            function save() {
                const origin = _origin;
                if (origin === null || (_key === '' && !mayTurnOff())) {
                    return;
                }
                close();
                const before = customised(origin) ? remaps[origin] : origin;
                if (_key !== before) {
                    store(origin, _key);
                    ctx.announce(_key === '' ? `“${labelOf(origin)}” turned off` : `“${labelOf(origin)}”: key ${_key}`);
                }
            }

            self.addEventListener('keydown', function(event) {
                if (event.keyCode === 27) {
                    close();
                } else if (event.keyCode === 8) {
                    let ek = _selected ? '' : KeyboardUtils.encodeKeystroke(_key);
                    ek = ek.substr(0, ek.length - 1);
                    _key = KeyboardUtils.decodeKeystroke(ek);
                    _selected = false;
                    showKey();
                } else if (event.keyCode === 13) {
                    save();
                } else if (event.sk_keyName.length > 1) {
                    const keyStr = JSON.stringify({
                        metaKey: event.metaKey,
                        altKey: event.altKey,
                        ctrlKey: event.ctrlKey,
                        shiftKey: event.shiftKey,
                        keyCode: event.keyCode,
                        code: event.code,
                        composed: event.composed,
                        key: event.key
                    }, null, 4);
                    reportIssue(`Unrecognized key event: ${event.sk_keyName}`, keyStr);
                } else {
                    _key = (_selected ? '' : _key) + KeyboardUtils.decodeKeystroke(event.sk_keyName);
                    _selected = false;
                    showKey();
                }
                event.sk_stopPropagation = true;
            });
            pickerCancel.addEventListener('click', close);
            pickerSave.addEventListener('click', save);

            const _enter = self.enter;
            self.enter = function(elm, origin) {
                if (advanced) {
                    return;
                }
                _enter.call(self);
                _origin = origin;
                _key = elm.dataset.custom;
                _selected = true;
                pickerTitle.textContent = `New key for “${labelOf(origin)}”`;
                pickerLead.textContent = `The new key is added, and ${origin} keeps working too.`;
                showKey();
                openDialog(picker);
                // Keys go to the picker, not to a button: none may hold focus, or
                // Space would press it as well.
                pressed.focus();
            };
            // closed some other way (the dialog's own Esc handling): leave the mode too
            picker.addEventListener('close', () => {
                _origin = null;
                if (Mode.getCurrent() === self) {
                    self.exit();
                }
            });
            return self;
        })();

        ctx.initL10n((l) => {
            locale = l;
            build();
        });

        return {
            onDefaults({ normal }) {
                // Read at once: the settings applied right after this add their keys
                // to the same Trie.
                actions = defaultMappings(normal.mappings.getMetas(() => true), (w) => KeyboardUtils.decodeKeystroke(w));
                build();
            },
            onSettings(rs) {
                remaps = Object.assign({}, rs.basicMappings);
                advanced = !!rs.showAdvanced;
                advancedNote.hidden = !advanced;
                update();
            },
            onStorage(changes, area) {
                // a change made in another tab of this page
                if (area === 'local' && changes.basicMappings) {
                    remaps = Object.assign({}, changes.basicMappings.newValue);
                    update();
                }
            },
            onShow() {
                shortcuts.refresh();
            },
        };
    },
};
