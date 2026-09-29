// pages/options.js, the settings page. content.js imports it on options.html and
// calls it with these arguments, in this order, before Surfingkeys starts on the
// page; the page itself is built in options/shell.js from the sections listed in
// options/sections.js.
import createSettingsPage from './options/shell.js';

export default function(
    RUNTIME,
    KeyboardUtils,
    Mode,
    createElementWithContent,
    getBrowserName,
    htmlEncode,
    initL10n,
    reportIssue,
    setSanitizedContent,
    showBanner,
) {
    createSettingsPage({
        RUNTIME,
        KeyboardUtils,
        Mode,
        createElementWithContent,
        getBrowserName,
        htmlEncode,
        initL10n,
        reportIssue,
        setSanitizedContent,
        showBanner,
    });
}
