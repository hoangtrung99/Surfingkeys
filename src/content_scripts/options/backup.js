// Backup: export the settings to a file and import them. A placeholder until it lands.
import { h } from './dom.js';

export default {
    id: 'backup',
    title: 'Backup',
    keywords: 'backup export import file restore sync move',
    create(ctx, root) {
        root.append(
            h('p', {class: 'sk-lead'}, 'Move your settings to another browser, or keep a copy.'),
            h('div', {class: 'sk-card sk-row'},
                h('h3', null, 'Coming next'),
                h('p', null, 'Export your settings to a file, and import them with a preview of what changes.')));
        return {};
    },
};
