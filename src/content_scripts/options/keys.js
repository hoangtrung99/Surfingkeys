// Keys: a new key for common actions (basicMappings, {originKey: newKey | ""}).
// content.js applies them with api.map, which ADDS the new key: the original one
// keeps working unless the action is disabled (an empty key), and the rows say so.
// Advanced mode ignores basicMappings (content.js applySettings).
import { localizeAnnotation } from '../common/utils.js';
import { closeDialog, h, openDialog } from './dom.js';

// the actions listed, in this order
const BASIC_MAPPINGS = ['d', 'R', 'f', 'E', 'e', 'x', 'gg', 'j', '/', 'n', 'r', 'k', 'S', 'C', 'on', 'G', 'v', 'i', ';e', 'og', 'g0', 't', '<Ctrl-6>', 'yy', 'g$', 'D', 'ob', 'X', 'sg', 'cf', 'yv', 'yt', 'N', 'l', 'cc', '$', 'yf', 'w', '0', 'yg', 'ow', 'cs', 'b', 'om', 'ya', 'h', 'gU', 'W', 'B', 'F', ';j'];

// "#3Close current tab" is shown without its help-group prefix
function stripGroup(text) {
    return text.replace(/^#\d+/, '');
}

export default {
    id: 'keys',
    title: 'Keys',
    keywords: 'key keys mapping mappings remap shortcut keyboard',
    create(ctx, root) {
        const { KeyboardUtils, Mode, RUNTIME, reportIssue } = ctx;
        let actions = [];
        let remaps = {};

        const advancedNote = h('p', {class: 'sk-note', hidden: true},
            'Advanced mode is on, so the keys set here are not used: your settings script decides them (api.map, api.unmap).');
        const list = h('div', {id: 'basicMappings', class: 'sk-keylist'});
        root.append(
            h('p', {class: 'sk-lead'}, 'Pick another key for an action. The new key is added and the original key keeps working; set no key (Backspace, then Enter) to turn an action off.'),
            advancedNote,
            list);

        const inputKey = h('kbd', {id: 'inputKey', 'aria-live': 'polite'}, ' ');
        const pickerTitle = h('h3', {id: 'keyPickerTitle'}, 'Press the new key');
        const picker = h('dialog', {id: 'keyPicker', class: 'sk-dialog', 'aria-labelledby': 'keyPickerTitle'},
            pickerTitle,
            h('p', {class: 'sk-muted'}, h('kbd', null, 'Backspace'), ' deletes backward, ', h('kbd', null, 'Enter'), ' confirms, ',
                h('kbd', null, 'Esc'), ' cancels.'),
            h('div', {class: 'pressedKey'}, inputKey));
        document.body.append(picker);

        // rows are built once and updated in place, so the button that opened the
        // key picker is still there to take focus back when it closes
        const rows = new Map();
        function build() {
            ctx.initL10n((locale) => {
                rows.clear();
                list.replaceChildren(...actions.map((a) => {
                    const label = stripGroup(localizeAnnotation(locale, a.annotation));
                    const button = h('button', {type: 'button', class: 'sk-kbd', dataset: {origin: a.origin}});
                    button.addEventListener('click', () => KeyPicker.enter(button, label));
                    const note = h('span', {class: 'sk-keynote'});
                    const row = h('div', {class: 'sk-keyrow sk-row'},
                        h('span', {class: 'annotation'}, label),
                        h('span', {class: 'sk-keycell'}, note, button));
                    rows.set(a.origin, {row, button, note, label});
                    return row;
                }));
                update();
            });
        }

        function update() {
            const targets = new Set(Object.keys(remaps).map((k) => remaps[k]));
            actions.forEach((a) => {
                const r = rows.get(a.origin);
                if (!r) {
                    return;
                }
                const custom = remaps.hasOwnProperty(a.origin) ? remaps[a.origin] : a.origin;
                r.button.dataset.custom = custom;
                r.button.textContent = custom || 'Off';
                r.button.setAttribute('aria-label', `${r.label}: ${custom ? `key ${custom}` : 'turned off'}. Change`);
                // the original key keeps its action unless another row takes it
                r.note.textContent = custom && custom !== a.origin && !targets.has(a.origin) ? `${a.origin} still works` : '';
                r.row.dataset.keywords = `${a.origin} ${custom}`;
            });
        }

        function save() {
            const realDefMap = {};
            Array.from(list.querySelectorAll('button.sk-kbd')).forEach((m) => {
                const n = m.dataset.custom;
                if (m.dataset.origin !== n) {
                    realDefMap[m.dataset.origin] = n;
                }
            });
            remaps = realDefMap;
            RUNTIME('updateSettings', {
                settings: {
                    basicMappings: realDefMap
                }
            });
            update();
        }

        const KeyPicker = (function() {
            const self = new Mode("KeyPicker");
            let _key = "";
            let _elm;

            function showKey() {
                inputKey.textContent = _key || ' ';
            }
            function close() {
                self.exit();
                closeDialog(picker);
            }

            self.addEventListener('keydown', function(event) {
                if (event.keyCode === 27) {
                    close();
                } else if (event.keyCode === 8) {
                    let ek = KeyboardUtils.encodeKeystroke(_key);
                    ek = ek.substr(0, ek.length - 1);
                    _key = KeyboardUtils.decodeKeystroke(ek);
                    showKey();
                } else if (event.keyCode === 13) {
                    _elm.dataset.custom = _key;
                    close();
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
                    _key += KeyboardUtils.decodeKeystroke(event.sk_keyName);
                    showKey();
                }
                event.sk_stopPropagation = true;
            });

            const _enter = self.enter;
            self.enter = function(elm, label) {
                _enter.call(self);
                _elm = elm;
                _key = elm.dataset.custom;
                pickerTitle.textContent = `New key for “${label}”`;
                showKey();
                openDialog(picker);
            };
            // closed some other way (the dialog's own Esc handling): leave the mode too
            picker.addEventListener('close', () => {
                if (Mode.getCurrent() === self) {
                    self.exit();
                }
            });
            return self;
        })();

        return {
            onDefaults({ normal }) {
                actions = BASIC_MAPPINGS.map((w) => {
                    const binding = normal.mappings.find(KeyboardUtils.encodeKeystroke(w));
                    return binding ? {origin: w, annotation: binding.meta.annotation} : null;
                }).filter((m) => m !== null);
            },
            onSettings(rs) {
                remaps = Object.assign({}, rs.basicMappings);
                advancedNote.hidden = !rs.showAdvanced;
                if (rows.size) {
                    update();
                } else {
                    build();
                }
            },
        };
    },
};
