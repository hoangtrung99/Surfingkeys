// Sites: where Surfingkeys is turned off (blocklist) and where selecting text with
// the mouse searches it (mouseSelectToQuery). A placeholder until the list lands.
import { h } from './dom.js';

export default {
    id: 'sites',
    title: 'Sites',
    keywords: 'site sites blocklist disable disabled turn off exclude domain',
    create(ctx, root) {
        root.append(
            h('p', {class: 'sk-lead'}, 'Where Surfingkeys is turned off.'),
            h('div', {class: 'sk-card sk-row'},
                h('h3', null, 'Coming next'),
                h('p', null, 'A list of the sites where Surfingkeys is off, to turn it back on from here. For now, press ',
                    h('kbd', null, 'Alt-s'), ' on a site to turn Surfingkeys off or on there.')));
        return {};
    },
};
