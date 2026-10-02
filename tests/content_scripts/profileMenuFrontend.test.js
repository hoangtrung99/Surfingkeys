// The profile menu (ui/profileMenu.js) in the real frontend: what the omnibar around
// it does to the input and to the focused row, which a stand-in omnibar cannot show.
import { bootFrontend } from '../helpers/bootFrontend.js';
import { BOOT_TIMEOUT } from '../helpers/jsdomEnv.js';

const PROFILES = [
    { dir: 'Default', name: 'Person 1', email: '' },
    { dir: 'Profile 1', name: 'Work', email: 'ann@example.com' },
    { dir: 'Profile 3', name: 'José', email: '' },
];

let f;
const ui = () => document.getElementById('sk_omnibar');
const input = () => ui().querySelector('#sk_omnibarSearchArea input');
const rows = () => Array.from(ui().querySelectorAll('#sk_omnibarSearchResult li'));
const names = () => rows().map((li) => li.querySelector('.title').textContent);
const focused = () => {
    const li = ui().querySelector('#sk_omnibarSearchResult li.focused');
    return li && li.querySelector('.title').textContent;
};
const note = () => {
    const n = ui().querySelector('.sk_profile_note');
    return n && n.textContent;
};
const opened = () => f.sent.filter((m) => m.action === 'openProfile').map((m) => m.profile);
// the last request for `action` that is still waiting, answered
const answer = (action, reply) => f.held.filter((h) => h.message.action === action).pop().respond(reply);

beforeAll(async () => {
    f = await bootFrontend();
    jest.spyOn(window, 'postMessage').mockImplementation(() => {});
    f.post({ action: 'initFrontend', origin: 'http://localhost', winSize: [1280, 800] });
    // a focused row is scrolled into view, which jsdom does not implement
    Element.prototype.scrollIntoView = jest.fn();
}, BOOT_TIMEOUT);

beforeEach(() => {
    f.held.length = 0;
    f.answers.getSettings = () => ({ settings: { cmdHistory: [] } });
});

afterEach(async () => {
    f.Front.hidePopup();
    await f.settle();
});

async function openMenu() {
    f.post({ action: 'openOmnibar', type: 'Profiles' });
    await f.settle();
    answer('getProfiles', { profiles: PROFILES });
    await f.settle();
}

test(':profile work, run from the ":" omnibar, opens the list with work typed in', async () => {
    f.post({ action: 'openOmnibar', type: 'Commands' });
    await f.settle();
    input().value = 'profile work';
    f.press('<Enter>', { target: input() });
    await f.settle();
    expect(input().placeholder).toBe('Switch to profile…');
    expect(input().value).toBe('work');
    answer('getProfiles', { profiles: PROFILES });
    await f.settle();
    expect(names()).toEqual(['Work']);
    expect(focused()).toBe('Work');
    expect(opened()).toEqual([]);
});

test('the profile picked stays focused while it opens and after a refusal, so Enter tries it again', async () => {
    await openMenu();
    expect(focused()).toBe('Person 1');
    f.press('<Tab><Tab>', { target: input() });
    expect(focused()).toBe('José');
    f.press('<Enter>', { target: input() });
    await f.settle();
    expect(opened()).toEqual(['Profile 3']);
    expect(note()).toBe('Opening José…');
    expect(focused()).toBe('José');
    answer('openProfile', { error: 'the browser refused it, its profile being in use or locked (exit code 21)' });
    await f.settle();
    expect(note()).toBe('Could not open José: the browser refused it, its profile being in use or locked (exit code 21).');
    expect(focused()).toBe('José');
    f.press('<Enter>', { target: input() });
    await f.settle();
    expect(opened()).toEqual(['Profile 3', 'Profile 3']);
});

test('a click on a lower row focuses it, so Enter after a refusal tries that profile again', async () => {
    await openMenu();
    rows()[1].click();
    await f.settle();
    expect(opened()).toEqual(['Profile 1']);
    expect(focused()).toBe('Work');
    answer('openProfile', { error: 'no answer' });
    await f.settle();
    expect(focused()).toBe('Work');
    f.press('<Enter>', { target: input() });
    await f.settle();
    expect(opened()).toEqual(['Profile 1', 'Profile 1']);
});
