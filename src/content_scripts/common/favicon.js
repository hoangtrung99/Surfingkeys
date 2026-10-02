// The icon the browser keeps for `pageUrl`, served to the extension's own pages
// by its _favicon/ endpoint: that needs Manifest V3 and the favicon permission,
// so it exists in the Chromium build only. `size` is in device pixels, not CSS
// pixels: an icon drawn at 16px has to be asked for at 32, or it is blurred on a
// high-density screen. Left out, the browser's default (16) is used.
export function faviconUrl(pageUrl, size) {
    const sized = size ? `&size=${size}` : '';
    return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}${sized}`);
}
