// Top Sites as the help page (start.js) and the new tab page (newtab/page.js)
// list them: one link per site, with the icon the browser keeps for it. Built
// node by node: a title is whatever the site called itself, and markup in it
// must stay text.
import { faviconUrl } from './favicon.js';

// One <li><a><img>title</a></li>, the icon drawn at `size` CSS pixels.
export function topSiteItem(site, size) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = site.url;
    a.title = site.url;
    const icon = document.createElement('img');
    icon.src = faviconUrl(site.url, size * 2);
    icon.width = size;
    icon.height = size;
    icon.alt = '';
    const title = document.createElement('span');
    title.textContent = site.title || site.url;
    a.append(icon, title);
    li.appendChild(a);
    return li;
}

// Replaces what `list` holds with `sites` ([{url, title}], as chrome.topSites
// gives them).
export function renderTopSites(list, sites, size = 16) {
    list.replaceChildren(...(sites || []).map((s) => topSiteItem(s, size)));
}
