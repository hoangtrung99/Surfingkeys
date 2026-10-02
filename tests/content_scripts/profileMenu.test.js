// The profile menu (ui/profileMenu.js) against a stand-in omnibar: what it lists, what
// Enter and a click ask the background for, what it says when there is no list, and
// that a late answer never acts on a menu that has gone.
import createProfileMenu from '../../src/content_scripts/ui/profileMenu.js';

const mockRUNTIME = jest.fn();
let mockBrowserName = 'Chrome';

jest.mock('../../src/content_scripts/common/runtime.js', () => ({
    RUNTIME: (...args) => mockRUNTIME(...args),
    runtime: { conf: {} },
}));

jest.mock('../../src/content_scripts/common/utils.js', () => ({
    getBrowserName: () => mockBrowserName,
}));

const PROFILES = [
    { dir: 'Profile 1', name: 'Work', email: 'ann@example.com' },
    { dir: 'Default', name: 'Person 1', email: '' },
    { dir: 'Profile 3', name: 'José', email: '' },
];

describe('profile menu', () => {
    let omnibar, front, menu, commands;

    const rows = () => Array.from(omnibar.resultsDiv.querySelectorAll('li'));
    const names = () => rows().map((li) => li.querySelector('.title').textContent);
    const note = () => {
        const n = omnibar.resultsDiv.querySelector('.sk_profile_note');
        return n ? n.textContent : null;
    };
    const type = (text) => {
        omnibar.input.value = text;
        menu.onInput();
    };
    // the callback of the last RUNTIME call for `action`
    const answer = (action, response) => {
        const call = mockRUNTIME.mock.calls.filter((c) => c[0] === action).pop();
        call[2](response);
    };
    const opened = () => mockRUNTIME.mock.calls.filter((c) => c[0] === 'openProfile').map((c) => c[1]);
    const openWith = (response) => {
        menu.onOpen();
        answer('getProfiles', response);
    };

    beforeEach(() => {
        mockBrowserName = 'Chrome';
        commands = {};
        omnibar = {
            input: document.createElement('input'),
            resultsDiv: document.createElement('div'),
            // as the real one: a click on a row with no url types li.query into the input
            listResults(items, render) {
                this.resultsDiv.innerHTML = '';
                if (!items.length) {
                    return;
                }
                const ul = document.createElement('ul');
                items.forEach((item) => {
                    const li = render(item);
                    li.onclick = () => { this.input.value = li.query; };
                    ul.append(li);
                });
                this.resultsDiv.append(ul);
                ul.firstChild.classList.add('focused');
            },
            command: (name, annotation, fn) => { commands[name] = fn; },
        };
        front = { _actions: { openOmnibar: jest.fn() }, hidePopup: jest.fn() };
        menu = createProfileMenu(omnibar, front);
    });

    test('asks for the profiles and says so until they come', () => {
        menu.onOpen();
        expect(mockRUNTIME).toHaveBeenCalledWith('getProfiles', {}, expect.any(Function));
        expect(note()).toBe('Reading profiles…');
        expect(omnibar.input.placeholder).toBe('Switch to profile…');
        answer('getProfiles', { profiles: PROFILES });
        expect(names()).toEqual(['Work', 'Person 1', 'José']);
        expect(rows()[0].querySelector('.url').textContent).toBe('ann@example.com');
        expect(rows()[1].querySelector('.url')).toBeNull();
        expect(rows()[0].classList.contains('focused')).toBe(true);
    });

    test('rows carry the profile directory and nothing listResults or Ctrl-d would act on', () => {
        openWith({ profiles: PROFILES });
        expect(rows().map((li) => li.profileDir)).toEqual(['Profile 1', 'Default', 'Profile 3']);
        rows().forEach((li) => {
            expect(li.url).toBeUndefined();
            expect(li.uid).toBeUndefined();
        });
    });

    test('names are text, never markup', () => {
        openWith({ profiles: [{ dir: 'Profile 9', name: '<img src=x onerror=alert(1)>', email: '' }] });
        expect(names()).toEqual(['<img src=x onerror=alert(1)>']);
        expect(omnibar.resultsDiv.querySelector('img')).toBeNull();
    });

    test('filters by name, accents aside, by email and by directory', () => {
        openWith({ profiles: PROFILES.concat([{ dir: 'Profile 5', name: 'Ngô Thị Đào', email: '' }]) });
        type('jose');
        expect(names()).toEqual(['José']);
        // đ has no decomposition to drop an accent from
        type('dao');
        expect(names()).toEqual(['Ngô Thị Đào']);
        type('example.com');
        expect(names()).toEqual(['Work']);
        type('default');
        expect(names()).toEqual(['Person 1']);
        type('nobody');
        expect(names()).toEqual([]);
        expect(note()).toBe('No profile matches.');
    });

    test('Enter opens the focused profile, and the menu closes once the browser took it', () => {
        openWith({ profiles: PROFILES });
        type('person');
        expect(menu.onEnter()).toBe(false);
        expect(opened()).toEqual([{ profile: 'Default' }]);
        expect(note()).toBe('Opening Person 1…');
        expect(front.hidePopup).not.toHaveBeenCalled();
        answer('openProfile', { profile: 'Default' });
        expect(front.hidePopup).toHaveBeenCalled();
    });

    test('a click opens its row instead of typing into the input', () => {
        openWith({ profiles: PROFILES });
        rows()[2].onclick();
        expect(opened()).toEqual([{ profile: 'Profile 3' }]);
        expect(omnibar.input.value).toBe('');
    });

    // Listing the rows again focuses the first: Enter would then open another profile.
    test('the row clicked is the one focused, while it opens and after a refusal', () => {
        openWith({ profiles: PROFILES });
        const focusedName = () => omnibar.resultsDiv.querySelector('li.focused .title').textContent;
        rows()[2].onclick();
        expect(note()).toBe('Opening José…');
        expect(focusedName()).toBe('José');
        expect(omnibar.resultsDiv.querySelectorAll('li.focused')).toHaveLength(1);
        answer('openProfile', { error: 'the browser refused it, its profile being in use or locked (exit code 21)' });
        expect(note()).toBe('Could not open José: the browser refused it, its profile being in use or locked (exit code 21).');
        expect(omnibar.resultsDiv.querySelectorAll('.sk_profile_note')).toHaveLength(1);
        expect(focusedName()).toBe('José');
        menu.onEnter();
        expect(opened()).toEqual([{ profile: 'Profile 3' }, { profile: 'Profile 3' }]);
    });

    test('one switch at a time', () => {
        openWith({ profiles: PROFILES });
        menu.onEnter();
        menu.onEnter();
        rows()[1].onclick();
        expect(opened()).toHaveLength(1);
    });

    test('a refused switch is said, and the menu stays', () => {
        openWith({ profiles: PROFILES });
        menu.onEnter();
        answer('openProfile', { error: 'the browser has no profile "Profile 1" (any more): open the list again' });
        expect(front.hidePopup).not.toHaveBeenCalled();
        expect(note()).toBe('Could not open Work: the browser has no profile "Profile 1" (any more): open the list again.');
        expect(omnibar.resultsDiv.querySelector('.sk_profile_error')).not.toBeNull();
        // still listed, and another try is allowed
        expect(names()).toEqual(['Work', 'Person 1', 'José']);
        rows()[1].onclick();
        expect(opened()).toHaveLength(2);
    });

    // The host stopped waiting on the browser, which had the request by then and may
    // still carry it out: not a failure, and not styled as one.
    test('a switch the browser has not confirmed is said as such, not as a failure', () => {
        openWith({ profiles: PROFILES });
        rows()[2].onclick();
        answer('openProfile', {
            error: 'the browser did not confirm it within 15 seconds; it may still open the profile once it responds',
            kind: 'pending',
        });
        expect(note()).toBe('José: not confirmed yet — the browser may still open it.');
        expect(omnibar.resultsDiv.querySelector('.sk_profile_error')).toBeNull();
        expect(front.hidePopup).not.toHaveBeenCalled();
        expect(omnibar.resultsDiv.querySelector('li.focused .title').textContent).toBe('José');
    });

    test('an answer that comes after the menu closed acts on nothing', () => {
        openWith({ profiles: PROFILES });
        menu.onEnter();
        menu.onClose();
        // the omnibar shows something else by now
        omnibar.resultsDiv.innerHTML = '<p>other</p>';
        answer('openProfile', { profile: 'Profile 1' });
        expect(front.hidePopup).not.toHaveBeenCalled();
        expect(omnibar.resultsDiv.innerHTML).toBe('<p>other</p>');
    });

    test('a list that comes after the menu was reopened is dropped', () => {
        menu.onOpen();
        const first = mockRUNTIME.mock.calls[0][2];
        menu.onClose();
        menu.onOpen();
        first({ profiles: [{ dir: 'Old', name: 'Stale', email: '' }] });
        expect(note()).toBe('Reading profiles…');
        answer('getProfiles', { profiles: PROFILES });
        expect(names()).toEqual(['Work', 'Person 1', 'José']);
    });

    test.each([
        ['host', 'cannot reach Surfingkeys\' native messaging host: Specified native messaging host not found',
            'Readme.md#switching-profiles'],
        ['update', 'this server.lua cannot switch profiles yet, update it', 'server/server.lua'],
    ])('with no list (%s), it says why and links the fix', (kind, error, href) => {
        openWith({ error, kind });
        expect(note()).toContain(`Cannot list profiles: ${error}.`);
        const a = omnibar.resultsDiv.querySelector('.sk_profile_note a');
        expect(a.href).toContain(href);
        expect(a.target).toBe('_blank');
        expect(rows()).toEqual([]);
        // Enter has nothing to open and dismisses
        expect(menu.onEnter()).toBe(true);
        expect(opened()).toEqual([]);
    });

    test('a host refusal is shown as it came, with no link', () => {
        openWith({ error: 'switching profiles works on macOS and Linux only' });
        expect(note()).toBe('Cannot list profiles: switching profiles works on macOS and Linux only.');
        expect(omnibar.resultsDiv.querySelector('a')).toBeNull();
    });

    test('Enter waits while the list is still on its way', () => {
        menu.onOpen();
        expect(menu.onEnter()).toBe(false);
    });

    // once the ":" omnibar's Enter is done with its input (profileMenuFrontend.test.js)
    test(':profile opens the menu, with a name typed in, and never switches by itself', () => {
        jest.useFakeTimers();
        try {
            commands.profile([]);
            expect(front._actions.openOmnibar).not.toHaveBeenCalled();
            jest.runOnlyPendingTimers();
            expect(front._actions.openOmnibar).toHaveBeenLastCalledWith({ type: 'Profiles' });
            commands.profile(['work', 'stuff']);
            jest.runOnlyPendingTimers();
            expect(front._actions.openOmnibar).toHaveBeenLastCalledWith({ type: 'Profiles', pref: 'work stuff' });
            expect(opened()).toEqual([]);
        } finally {
            jest.useRealTimers();
        }
    });

    test(':profile exists in Chromium only', () => {
        mockBrowserName = 'Firefox';
        commands = {};
        createProfileMenu(omnibar, front);
        expect(commands.profile).toBeUndefined();
    });
});
