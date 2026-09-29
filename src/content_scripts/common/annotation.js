/*
 * A mapping's annotation in the user's language. It is a string, or an array whose
 * first item is a format string and the rest its {0}, {1}... arguments, as
 * addSearchAlias writes ['#8Open Omnibar for {0} Search', 'google'].
 *
 * This module imports nothing, so the settings page can use it without pulling in
 * utils.js and runtime.js a second time (content.js already runs them there).
 */
export function localizeAnnotation(locale, annotation) {
    if (!Array.isArray(annotation)) {
        return locale(annotation);
    }
    // what String.prototype.format in utils.js does, argument by argument
    let formatted = locale(annotation[0]);
    annotation.slice(1).forEach((arg, i) => {
        formatted = formatted.replace(new RegExp('\\{' + i + '\\}', 'gi'), arg);
    });
    return formatted;
}

// The help groups a mapping's "#N" annotation prefix names, by N, as the usage
// popup (frontend.js buildUsage) titles them.
export const FEATURE_GROUPS = [
    'Help',                  // 0
    'Mouse Click',           // 1
    'Scroll Page / Element', // 2
    'Tabs',                  // 3
    'Page Navigation',       // 4
    'Sessions',              // 5
    'Search selected with',  // 6
    'Clipboard',             // 7
    'Omnibar',               // 8
    'Visual Mode',           // 9
    'vim-like marks',        // 10
    'Settings',              // 11
    'Chrome URLs',           // 12
    'Proxy',                 // 13
    'Misc',                  // 14
    'Insert Mode',           // 15
    'Lurk Mode',             // 16
    'Regional Hints Mode',   // 17
];
