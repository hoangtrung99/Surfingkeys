// Which browser Surfingkeys runs in, by its user agent. Each build runs in its
// own browser only, so this also names the build: "Chrome" is the Chromium one.
// A module of its own, with no side effects, so the toolbar popup can ask without
// loading utils.js (which re-exports it); the popup has to be up at once.

/**
 * Get current browser name
 * @returns {string} "Chrome" | "Firefox" | "Safari" | "Safari-iOS"
 *
 */
export function getBrowserName() {
    if (window.navigator.userAgent.indexOf("Chrome") !== -1) {
        return "Chrome";
    } else if (window.navigator.vendor.indexOf("Apple Computer, Inc.") === 0) {
        let isIOS = /iPad|iPhone|iPod/.test(navigator.platform)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        return isIOS ? "Safari-iOS" : "Safari";
    } else if (window.navigator.userAgent.indexOf("Firefox") !== -1) {
        return "Firefox";
    }
    return "Chrome";
}
