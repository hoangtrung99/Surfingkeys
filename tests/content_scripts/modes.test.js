// The modes a page can be in besides Normal, and who gets a key in each:
// Insert (a text field has the focus), PassThrough (Surfingkeys steps aside on
// request), Disabled (the site is blocklisted) and Lurk (the site only answers
// its lurk hotkeys). Lurk cannot be left for good once entered, so it comes last.
import { bootContent } from '../helpers/bootContent.js';
import { BOOT_TIMEOUT } from '../helpers/jsdomEnv.js';

const PAGE = `
<input id="field">
<div id="note" contenteditable="true">hello big world</div>
<p>page</p>`;

let h;
beforeAll(async () => {
    h = await bootContent({ html: PAGE });
}, BOOT_TIMEOUT);

const requests = () => h.sent.filter((m) => m.action !== 'localData');
const mode = () => h.Mode.getCurrent().name;

function clickInto(el) {
    h.clickInto(el);
    expect(mode()).toBe('Insert');
}

// the state the background reports for this site, as a settings change makes
// the page ask for it again (content.js applyRuntimeConf)
async function siteState(state) {
    h.answers.getState = () => ({ state });
    h.settingsUpdated({});
    await h.settle();
    h.chrome.runtime.sendMessage.mockClear();
}

let pageKeys;
const onKey = (e) => pageKeys.push(e.key);
beforeEach(() => {
    pageKeys = [];
    document.addEventListener('keydown', onKey);
});
afterEach(() => {
    document.removeEventListener('keydown', onKey);
});

describe('Insert mode in a text field', () => {
    let field;
    beforeEach(() => {
        field = document.getElementById('field');
        field.value = 'hello big world';
        clickInto(field);
    });
    afterEach(() => {
        if (mode() === 'Insert') {
            h.press('<Esc>');
        }
    });

    test.each([
        ['<Ctrl-e>', 0, 'hello big world', 15],
        // <Ctrl-f> on Windows
        ['<Ctrl-a>', 15, 'hello big world', 0],
        ['<Ctrl-u>', 6, 'big world', 0],
        ['<Alt-b>', 15, 'hello big world', 9],
        ['<Alt-f>', 0, 'hello big world', 5],
        ['<Alt-w>', 15, 'hello big', 9],
        ['<Alt-d>', 0, ' big world', 0],
        ["<Ctrl-'>", 15, '"hello big world"', 17],
    ])('%s with the cursor at %i leaves %p and the cursor at %i', (keys, at, value, cursor) => {
        field.setSelectionRange(at, at);
        const [down] = h.press(keys);
        expect(field.value).toBe(value);
        expect(field.selectionStart).toBe(cursor);
        expect(down.defaultPrevented).toBe(true);
    });

    test("<Ctrl-'> takes the quotes off again", () => {
        h.press("<Ctrl-'><Ctrl-'>");
        expect(field.value).toBe('hello big world');
    });

    test('a Normal key is typed, not run', () => {
        const [down] = h.press('x');
        expect(requests()).toEqual([]);
        expect(down.defaultPrevented).toBe(false);
        expect(pageKeys).toEqual(['x']);
        expect(mode()).toBe('Insert');
    });

    test('<Esc> leaves the field and Insert mode, and Normal keys act again', () => {
        h.press('<Esc>');
        expect(document.activeElement).toBe(document.body);
        expect(mode()).toBe('Normal');
        h.press('x');
        expect(requests()).toEqual([expect.objectContaining({ action: 'closeTab' })]);
    });

    test('<Ctrl-i> opens the field in the vim editor, and saving writes it back', () => {
        h.press('<Ctrl-i>');
        expect(h.ui('showEditor')).toEqual([expect.objectContaining({ type: 'input', content: 'hello big world' })]);
        expect(document.activeElement).toBe(document.body);
        expect(mode()).toBe('Normal');

        const changes = [];
        field.addEventListener('change', () => changes.push(field.value), { once: true });
        h.message({ action: 'ace_editor_saved', data: 'hello vim' });
        expect(field.value).toBe('hello vim');
        expect(changes).toEqual(['hello vim']);
        // focusOnSaved: back in the field, typing
        expect(document.activeElement).toBe(field);
        expect(mode()).toBe('Insert');
    });

    test('<Ctrl-Alt-i> opens the field in neovim', () => {
        h.press('<Ctrl-Alt-i>');
        expect(h.ui('showEditor')).toEqual([expect.objectContaining({ type: 'input', file_name: 'localhost/input' })]);
    });

    test('a stroke that only starts an Insert mapping is typed once the next one does not continue it', () => {
        h.api.imapkey(',,', '#15test', () => {});
        try {
            field.setSelectionRange(5, 5);
            const [comma, m] = h.press(',m');
            expect(comma.defaultPrevented).toBe(true);
            expect(field.value).toBe('hello, big world');
            expect(field.selectionStart).toBe(6);
            // left for the browser to type
            expect(m.defaultPrevented).toBe(false);
        } finally {
            h.api.iunmap(',,');
        }
    });
});

describe('Insert mode in a contenteditable element', () => {
    let note, text;
    beforeEach(() => {
        note = document.getElementById('note');
        note.textContent = 'hello big world';
        text = note.firstChild;
        clickInto(note);
    });
    afterEach(() => {
        if (mode() === 'Insert') {
            h.press('<Esc>');
        }
    });
    const caret = () => [document.getSelection().focusNode, document.getSelection().focusOffset];

    // <Alt-b/f/w/d> go through Selection.modify, which jsdom lacks: browser suite
    test.each([
        ['<Ctrl-e>', 0, 'hello big world', 15],
        ['<Ctrl-a>', 9, 'hello big world', 0],
        ['<Ctrl-u>', 6, 'big world', 0],
    ])('%s with the caret at %i leaves %p and the caret at %i', (keys, at, value, offset) => {
        document.getSelection().collapse(text, at);
        const [down] = h.press(keys);
        expect(note.textContent).toBe(value);
        expect(caret()).toEqual([text, offset]);
        expect(down.defaultPrevented).toBe(true);
    });

    test('<Esc> leaves the element and Insert mode', () => {
        h.press('<Esc>');
        expect(document.activeElement).toBe(document.body);
        expect(mode()).toBe('Normal');
    });
});

describe('PassThrough', () => {
    test('<Alt-i> gives the page every key until <Esc>', () => {
        h.press('<Alt-i>');
        expect(mode()).toBe('PassThrough');
        const downs = h.press('xgxx');
        expect(requests()).toEqual([]);
        expect(pageKeys).toEqual(['x', 'g', 'x', 'x']);
        expect(downs.some((e) => e.defaultPrevented)).toBe(false);

        const [esc] = h.press('<Esc>');
        expect(esc.defaultPrevented).toBe(true);
        expect(mode()).toBe('Normal');
        h.press('x');
        expect(requests()).toEqual([expect.objectContaining({ action: 'closeTab' })]);
    });

    test('p gives the page its keys for a second, each key starting the second again', () => {
        jest.useFakeTimers();
        try {
            h.press('p');
            expect(mode()).toBe('PassThrough');
            expect(h.Mode.getCurrent().statusLine).toBe('ephemeral(1000ms) pass through');
            jest.advanceTimersByTime(900);
            h.press('x');
            jest.advanceTimersByTime(900);
            expect(mode()).toBe('PassThrough');
            jest.advanceTimersByTime(100);
            expect(mode()).toBe('Normal');
            expect(requests()).toEqual([]);
            expect(pageKeys).toEqual(['x']);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('Disabled', () => {
    afterEach(async () => {
        await siteState('enabled');
    });

    test('a disabled site gets every key and the icon says so', async () => {
        h.answers.getState = () => ({ state: 'disabled' });
        h.deliver({ subject: 'settingsUpdated', settings: {} });
        await h.settle();
        expect(requests()).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'setSurfingkeysIcon', status: 'disabled' })]));
        h.chrome.runtime.sendMessage.mockClear();

        expect(mode()).toBe('Disabled');
        const [down] = h.press('x');
        expect(requests()).toEqual([]);
        expect(pageKeys).toEqual(['x']);
        expect(down.defaultPrevented).toBe(false);
    });

    test('<Alt-s> still toggles the blocklist, and keys act again at once', async () => {
        await siteState('disabled');
        const [down] = h.press('<Alt-s>');
        expect(requests()).toEqual([expect.objectContaining({ action: 'toggleBlocklist' })]);
        expect(down.defaultPrevented).toBe(true);
        h.chrome.runtime.sendMessage.mockClear();
        h.press('x');
        expect(requests()).toEqual([expect.objectContaining({ action: 'closeTab' })]);
    });

    test('enabled again, the site gets its keys back', async () => {
        await siteState('disabled');
        await siteState('enabled');
        expect(mode()).toBe('Normal');
        h.press('x');
        expect(requests()).toEqual([expect.objectContaining({ action: 'closeTab' })]);
        expect(pageKeys).toEqual([]);
    });
});

// last: the page cannot leave Lurk for good
describe('Lurk', () => {
    beforeAll(async () => {
        // lurk keys are set before the page starts lurking
        h.runUserScript((api) => api.lmap('<Alt-j>', '<Alt-i>'));
        h.answers.getState = () => ({ state: 'lurking' });
        h.deliver({ subject: 'settingsUpdated', settings: {} });
        await h.settle();
    });

    test('a lurking site gets every key but the lurk keys', () => {
        expect(mode()).toBe('Lurk');
        const [down] = h.press('x');
        expect(requests()).toEqual([]);
        expect(pageKeys).toEqual(['x']);
        expect(down.defaultPrevented).toBe(false);
    });

    test('lmap moved the wake-up key: <Alt-i> no longer wakes it', () => {
        h.press('<Alt-i>');
        expect(mode()).toBe('Lurk');
        expect(pageKeys).toEqual(['i']);
    });

    test('the wake-up key brings Normal back until <Esc>, and the icon follows', () => {
        h.press('<Alt-j>');
        expect(mode()).toBe('Normal');
        h.press('x');
        h.press('<Esc>');
        expect(mode()).toBe('Lurk');
        expect(requests()).toEqual([
            expect.objectContaining({ action: 'setSurfingkeysIcon', status: 'enabled' }),
            expect.objectContaining({ action: 'closeTab' }),
            expect.objectContaining({ action: 'setSurfingkeysIcon', status: 'lurking' }),
        ]);
    });

    test('p brings Normal back for one second', () => {
        jest.useFakeTimers();
        try {
            h.press('p');
            expect(mode()).toBe('Normal');
            h.press('x');
            expect(requests()).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'closeTab' })]));
            jest.advanceTimersByTime(1000);
            expect(mode()).toBe('Lurk');
        } finally {
            jest.useRealTimers();
        }
    });
});
