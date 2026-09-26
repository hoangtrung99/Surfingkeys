// Reset & About. Reset clears everything Surfingkeys keeps in chrome.storage (local
// and sync, start.js resetSettings), which the dialog lists before anything goes.
import { DEFAULT_THEME, PALETTES } from '../common/themes.js';
import { closeDialog, h, openDialog } from './dom.js';

export const FORK_URL = 'https://github.com/hoangtrung99/Surfingkeys';
export const ISSUES_URL = `${FORK_URL}/issues`;
export const UPSTREAM_URL = 'https://github.com/brookhong/Surfingkeys';
const DONATION_URL = 'https://www.paypal.me/brookhong';

// what resetSettings clears, as a user would name it
export const RESET_CLEARS = [
    'The settings script and where it loads from',
    'Key changes and turned-off search engines',
    'Sites where Surfingkeys is off, and mouse-select search sites',
    'Proxy settings',
    'Marks and saved sessions',
    'Find and command history',
    `The theme (back to ${PALETTES[DEFAULT_THEME].name})`,
    'LLM provider settings saved from your script',
];

function link(href, text) {
    return h('a', {href, target: '_blank', rel: 'noopener'}, text);
}

export default {
    id: 'about',
    title: 'Reset & About',
    keywords: 'reset clear restore defaults about version help issue bug report donate upstream',
    create(ctx, root) {
        const { RUNTIME } = ctx;
        const version = chrome.runtime.getManifest().version;

        const keep = h('input', {type: 'checkbox', id: 'resetKeepData'});
        const cancel = h('button', {type: 'button', class: 'sk-btn', value: 'cancel'}, 'Cancel');
        const confirm = h('button', {type: 'button', class: 'sk-btn sk-btn-danger', id: 'resetConfirm'}, 'Reset everything');
        const dialog = h('dialog', {id: 'resetDialog', class: 'sk-dialog', 'aria-labelledby': 'resetDialogTitle'},
            h('h3', {id: 'resetDialogTitle'}, 'Reset all settings?'),
            h('p', null, 'This clears, in this browser and in your synced browsers:'),
            h('ul', {class: 'sk-resetlist'}, RESET_CLEARS.map((item) => h('li', null, item))),
            h('p', {class: 'sk-check'}, keep, h('label', {for: 'resetKeepData'}, 'Keep marks and saved sessions')),
            h('div', {class: 'sk-actions'}, cancel, confirm));
        document.body.append(dialog);

        const resetButton = h('button', {type: 'button', id: 'resetSettings', class: 'sk-btn sk-btn-danger'}, 'Reset…');
        const donation = h('p', {id: 'donationDiv'}, link(DONATION_URL, 'Donate to the upstream author on PayPal'));
        root.append(
            h('div', {class: 'sk-card sk-row', dataset: {keywords: 'reset clear defaults'}},
                h('h3', null, 'Reset'),
                h('p', {class: 'sk-muted'}, 'Go back to the defaults. Everything Surfingkeys has stored is cleared, and the list is shown before anything goes.'),
                h('div', {class: 'sk-actions'}, resetButton)),
            h('div', {class: 'sk-card sk-row', dataset: {keywords: 'about version help issue bug report donate upstream github'}},
                h('h3', null, 'About'),
                h('dl', {class: 'sk-about'},
                    h('dt', null, 'Version'), h('dd', {id: 'aboutVersion'}, version),
                    h('dt', null, 'Source'), h('dd', null, link(FORK_URL, 'hoangtrung99/Surfingkeys')),
                    h('dt', null, 'Upstream project'), h('dd', null, link(UPSTREAM_URL, 'brookhong/Surfingkeys'))),
                h('p', null, link(ISSUES_URL, 'Report an issue')),
                donation));
        if (ctx.browserName.startsWith("Safari")) {
            donation.hidden = true;
        }

        resetButton.addEventListener('click', () => {
            keep.checked = false;
            openDialog(dialog);
            cancel.focus();
        });
        cancel.addEventListener('click', () => closeDialog(dialog));

        function reset(kept) {
            RUNTIME("resetSettings", null, function() {
                const done = () => ctx.refresh(() => {
                    ctx.announce(kept ? 'Settings reset; marks and sessions kept' : 'Settings reset', 2000);
                });
                if (kept) {
                    RUNTIME('updateSettings', {settings: kept}, done);
                } else {
                    done();
                }
            });
        }
        confirm.addEventListener('click', () => {
            const keepData = keep.checked;
            confirm.disabled = true;
            closeDialog(dialog);
            const finish = (kept) => {
                confirm.disabled = false;
                reset(kept);
            };
            if (keepData) {
                // read before the reset clears them, written back after it
                RUNTIME('getSettings', {key: ['marks', 'sessions']}, (resp) => {
                    const s = resp.settings || {};
                    finish({marks: s.marks || {}, sessions: s.sessions || {}});
                });
            } else {
                finish(null);
            }
        });

        return {};
    },
};
