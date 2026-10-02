// The profile menu, opened by gP, :profile and "Switch Profile…" in the Command
// Palette (Chromium only): the browser's profiles as its own profile menu orders them,
// and Enter or a click opens Surfingkeys' start page in the one picked, bringing that
// profile's window forward. The list and the switch both come from the native host
// (src/nvim/server/server.lua) through the background (getProfiles, openProfile);
// when there is none, or it is too old, the menu says so and how to fix it.
import { RUNTIME } from '../common/runtime.js';
import { getBrowserName } from '../common/utils.js';

const README = 'https://github.com/hoangtrung99/Surfingkeys/blob/master/src/nvim/server/Readme.md#switching-profiles';
const SERVER_LUA = 'https://github.com/hoangtrung99/Surfingkeys/blob/master/src/nvim/server/server.lua';

// "jose" finds "José"
function fold(s) {
    return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export default function createProfileMenu(omnibar, front) {
    const self = {
        focusFirstCandidate: true,
        prompt: '',
    };
    // null while the list is on its way
    let profiles = null;
    // why there is no list: {error, kind}
    let failure = null;
    // a line above the list: the switch in progress, or why it failed
    let notice = null;
    let opening = false;
    // Bumped whenever the menu opens or closes. An answer carries the value from when
    // it was asked, so one that arrives after the menu closed (or opened again) is
    // dropped instead of drawn into, or closing, whatever the omnibar shows by then.
    let session = 0;

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function link(href, text) {
        const a = el('a', '', text);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener';
        return a;
    }

    function noteFor(message, error, kind) {
        const div = el('div', 'sk_profile_note' + (error ? ' sk_profile_error' : ''), message);
        if (kind === 'host') {
            div.append(el('br'), 'Profile switching needs it installed: see ', link(README, 'src/nvim/server/Readme.md'), '.');
        } else if (kind === 'update') {
            div.append(el('br'), 'Replace it with ', link(SERVER_LUA, 'src/nvim/server/server.lua'), ' from this version.');
        }
        return div;
    }

    function show(node) {
        omnibar.resultsDiv.textContent = '';
        omnibar.resultsDiv.append(node);
    }

    // Rows carry the profile and no url or uid: listResults' click handler would open
    // a url, and Ctrl-d would delete a uid from history.
    function renderRow(profile) {
        const li = el('li');
        const text = el('div', 'text-container');
        text.append(el('div', 'title', profile.name));
        if (profile.email) {
            text.append(el('div', 'url', profile.email));
        }
        li.append(text);
        li.profile = profile;
        li.profileDir = profile.dir;
        return li;
    }

    function render() {
        if (failure) {
            show(noteFor(`Cannot list profiles: ${failure.error}.`, true, failure.kind));
            return;
        }
        if (profiles === null) {
            show(noteFor('Reading profiles…'));
            return;
        }
        const terms = fold(omnibar.input.value).split(/\s+/).filter((t) => t.length);
        const rows = profiles.filter((p) => {
            const text = fold(`${p.name} ${p.email} ${p.dir}`);
            return terms.every((t) => text.includes(t));
        });
        omnibar.listResults(rows, renderRow);
        omnibar.resultsDiv.querySelectorAll('li').forEach((li) => {
            li.onclick = () => open(li.profile);
        });
        if (notice) {
            omnibar.resultsDiv.prepend(noteFor(notice.text, notice.error, notice.kind));
        } else if (!rows.length) {
            show(noteFor(profiles.length ? 'No profile matches.' : 'The browser lists no profiles.'));
        }
    }

    // Closes once the browser has taken the request: what the user sees next is that
    // profile's window. A refusal stays here, said.
    function open(profile) {
        if (opening || !profile) {
            return;
        }
        opening = true;
        const mine = session;
        notice = {text: `Opening ${profile.name}…`};
        render();
        RUNTIME('openProfile', {profile: profile.dir}, function(response) {
            if (mine !== session) {
                return;
            }
            opening = false;
            if (response && !response.error) {
                notice = null;
                front.hidePopup();
                return;
            }
            const error = (response && response.error) || 'no answer';
            notice = {text: `Could not open ${profile.name}: ${error}.`, error: true, kind: response && response.kind};
            render();
        });
    }

    self.onOpen = function() {
        session++;
        profiles = null;
        failure = null;
        notice = null;
        opening = false;
        omnibar.input.placeholder = 'Switch to profile…';
        render();
        const mine = session;
        RUNTIME('getProfiles', {}, function(response) {
            if (mine !== session) {
                return;
            }
            if (!response || response.error) {
                failure = {error: (response && response.error) || 'no answer', kind: response && response.kind};
            } else {
                profiles = Array.isArray(response.profiles) ? response.profiles : [];
            }
            render();
        });
    };
    self.onInput = function() {
        notice = opening ? notice : null;
        render();
    };
    self.onEnter = function() {
        const fi = omnibar.resultsDiv.querySelector('li.focused');
        if (fi && fi.profile) {
            open(fi.profile);
            return false;
        }
        // nothing to open: Enter dismisses, unless an answer is still on its way
        return profiles !== null && !opening || failure !== null;
    };
    self.onClose = function() {
        session++;
        opening = false;
    };

    // Only ever OPENS the menu, with the name typed in: picking is left to Enter or a
    // click there. A command can be run by anything that can post to this frame, the
    // page included, and a switch raises another window over the one being used.
    if (getBrowserName() === 'Chrome') {
        omnibar.command('profile', '#8Switch to another browser profile, or :profile work', function(args) {
            const name = args.join(' ').trim();
            front._actions['openOmnibar'](name ? {type: 'Profiles', pref: name} : {type: 'Profiles'});
        });
    }

    return self;
}
