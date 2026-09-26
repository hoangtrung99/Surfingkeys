// Which settings section is on screen. The hash names it (options.html#keys), so
// a section can be linked to; without one the page opens on the section visited
// last, which this viewer's browser remembers in localStorage.

export const LAST_SECTION_KEY = 'surfingkeys.settings.section';

// The section a location hash names, or null.
export function sectionFromHash(hash, ids) {
    let id = String(hash || '').replace(/^#/, '');
    try {
        id = decodeURIComponent(id);
    } catch (e) {
        return null;
    }
    return ids.indexOf(id) !== -1 ? id : null;
}

// localStorage throws in some contexts (blocked site data) and may be empty: both
// only mean "nothing remembered".
export function rememberedSection(storage, ids) {
    try {
        const id = storage && storage.getItem(LAST_SECTION_KEY);
        return ids.indexOf(id) !== -1 ? id : null;
    } catch (e) {
        return null;
    }
}

export function rememberSection(storage, id) {
    try {
        storage && storage.setItem(LAST_SECTION_KEY, id);
    } catch (e) {
        // a convenience only: the page works the same without it
    }
}

// Where the page opens: the section in the URL, else the last one visited, else the first.
export function landingSection(hash, storage, ids) {
    return sectionFromHash(hash, ids) || rememberedSection(storage, ids) || ids[0];
}
