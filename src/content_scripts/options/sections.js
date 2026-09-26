// The sections of the settings page, in sidebar order.
//
// A section is a module whose default export is
//   {id, title, keywords, available(ctx), create(ctx, root)}
//   id        its #hash (options.html#keys) and the key it is remembered by
//   title     its sidebar label and heading
//   keywords  optional: more words "Find a setting" matches the whole section by
//   available optional: false leaves the section out (Proxy outside Chrome)
//   create    builds the section's content into `root`, under its heading, and
//             returns its hooks, each optional:
//               onDefaults({normal, api})  the default mappings, before any remap
//               onSettings(rs)             the full settings: at load, after a
//                                          reset (ctx.refresh), after ctx.patch
//               onTheme(stored)            the stored theme pick, at load and on change
//               onStorage(changes, area)   chrome.storage.onChanged
//               onShow()                   the section came on screen
// Rows "Find a setting" filters carry the class sk-row. A row matches by its text
// plus data-keywords, or by data-filter alone when it has one (a row whose text
// is mostly a preview). shell.js documents ctx.
import appearance from './appearance.js';
import keys from './keys.js';
import search from './search.js';
import sites from './sites.js';
import advanced from './advanced.js';
import proxy from './proxy.js';
import backup from './backup.js';
import about from './about.js';

export default [appearance, keys, search, sites, advanced, proxy, backup, about];
