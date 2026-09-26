// True in the frontend frame of pages/palette.html, which hosts the Command
// Palette and the Visual Tab Switcher for a tab Surfingkeys cannot run in
// (background/hostedUi.js). There this frame is the whole toolbar dropdown or
// window, not an overlay on a page: frontend.css lays the panels out for that
// under html.sk_hosted.
export const HOSTED = (() => {
    try {
        return window !== top && top.location.pathname === '/pages/palette.html';
    } catch (e) {
        return false;  // on a web page, top is another origin
    }
})();

if (HOSTED) {
    document.documentElement.classList.add('sk_hosted');
}
