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
