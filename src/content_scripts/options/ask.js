// A question in a modal <dialog>, answered by one of its buttons.
import { closeDialog, h, openDialog } from './dom.js';

let asked = 0;

/*
 * ask({id, title, body, choices}) resolves with the `value` of the choice clicked,
 * or null when the dialog is closed any other way (Esc, Cancel). Choices are
 * [{label, value, danger, id}], drawn after a Cancel button that has focus first:
 * Enter on an open question must never pick the choice that does something.
 * The dialog is removed once answered.
 */
export function ask({id, title, body, choices, cancelLabel = 'Cancel'}) {
    const titleId = `skAskTitle${++asked}`;
    const cancel = h('button', {type: 'button', class: 'sk-btn'}, cancelLabel);
    const buttons = choices.map((c) => h('button', {
        type: 'button',
        id: c.id,
        class: c.danger ? 'sk-btn sk-btn-danger' : (c.primary ? 'sk-btn sk-btn-primary' : 'sk-btn'),
        dataset: {value: c.value},
    }, c.label));
    const dialog = h('dialog', {id, class: 'sk-dialog', 'aria-labelledby': titleId},
        h('h3', {id: titleId}, title),
        body,
        h('div', {class: 'sk-actions'}, cancel, buttons));
    document.body.append(dialog);
    return new Promise((resolve) => {
        let answer = null;
        dialog.addEventListener('close', () => {
            dialog.remove();
            resolve(answer);
        }, {once: true});
        cancel.addEventListener('click', () => closeDialog(dialog));
        buttons.forEach((b, i) => b.addEventListener('click', () => {
            answer = choices[i].value;
            closeDialog(dialog);
        }));
        openDialog(dialog);
        cancel.focus();
    });
}
