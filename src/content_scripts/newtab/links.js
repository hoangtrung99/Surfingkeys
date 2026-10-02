// How a link on the new tab page opens. An extension page follows http(s)
// links, and the extension's own pages, as any page does, but the browser
// refuses it chrome://, file:// and the like ("Not allowed to load local
// resource") -- which a bookmark often is. Those go through chrome.tabs, which
// may open them. A javascript: bookmarklet cannot run from here at all: it runs
// in the page it is clicked on, and this page runs no script but its own.

// 'web' (the browser follows it), 'tabs' (chrome.tabs opens it) or 'script'.
export function linkKind(url) {
    if (/^\s*javascript:/i.test(url)) {
        return 'script';
    }
    if (/^https?:/i.test(url) || url.startsWith(chrome.runtime.getURL('/'))) {
        return 'web';
    }
    return 'tabs';
}

// What a click asks for, as the browser reads a click on a link: Ctrl/Cmd or
// the middle button a new tab (in front with Shift), Shift alone a new window.
export function howToOpen(e) {
    const newTab = !!(e.ctrlKey || e.metaKey || e.button === 1);
    return {newTab, active: newTab && !!e.shiftKey, newWindow: !newTab && !!e.shiftKey};
}

// Opens `url` through chrome.tabs: in this page's own tab, or a new one next to
// it. `say(text)` is told when the browser refuses (a file:// URL without
// "Allow access to file URLs", for one), since nothing else would show it.
export function openThroughTabs(url, how, say) {
    const done = () => {
        const error = chrome.runtime.lastError;
        error && say(`Could not open ${url}: ${error.message}`);
    };
    if (how.newWindow) {
        chrome.windows.create({url}, done);
        return;
    }
    chrome.tabs.getCurrent((tab) => {
        if (how.newTab) {
            chrome.tabs.create(tab ? {url, active: how.active, index: tab.index + 1, openerTabId: tab.id}
                : {url, active: how.active}, done);
        } else if (tab) {
            chrome.tabs.update(tab.id, {url}, done);
        } else {
            chrome.tabs.update({url}, done);
        }
    });
}

// Every link under `root`, whenever it was added: web links are left to the
// browser, the others opened through chrome.tabs, a disabled one (a bookmarklet)
// does nothing.
export function installLinks(root, say) {
    function follow(e, a) {
        if (a.getAttribute('aria-disabled') === 'true') {
            e.preventDefault();
            return;
        }
        if (!a.hasAttribute('href')) {
            return;
        }
        const kind = linkKind(a.href);
        if (kind !== 'web') {
            e.preventDefault();
            kind === 'tabs' && openThroughTabs(a.href, howToOpen(e), say);
        }
    }
    const linkOf = (e) => e.target && e.target.closest ? e.target.closest('a') : null;
    root.addEventListener('click', (e) => {
        const a = linkOf(e);
        a && !e.defaultPrevented && follow(e, a);
    });
    root.addEventListener('auxclick', (e) => {
        const a = linkOf(e);
        a && e.button === 1 && !e.defaultPrevented && follow(e, a);
    });
}
