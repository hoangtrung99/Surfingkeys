import { LOG } from '../common/utils.js';
import Mode from './common/mode.js';
import { runtime } from './common/runtime.js';
import {
    getBrowserName,
    getDocumentOrigin
} from './common/utils.js';

function createUiHost(browser, onload) {
    var uiHost = document.createElement("div");
    uiHost.style.display = "block";
    uiHost.style.opacity = 1;
    uiHost.style.colorScheme = "auto";
    var frontEndURL = chrome.runtime.getURL('pages/frontend.html');
    var ifr = document.createElement("iframe");
    ifr.setAttribute('allowtransparency', true);
    ifr.setAttribute('frameborder', 0);
    ifr.setAttribute('scrolling', "no");
    ifr.setAttribute('class', "sk_ui");
    ifr.setAttribute('src', frontEndURL);
    ifr.setAttribute('title', "Surfingkeys");
    ifr.style.position = "fixed";
    ifr.style.left = 0;
    ifr.style.bottom = 0;
    ifr.style.width = "100%";
    ifr.style.height = 0;
    ifr.style.zIndex = 2147483647;
    uiHost.attachShadow({ mode: 'open' });
    uiHost.shadowRoot.appendChild(ifr);

    function _onWindowMessage(event) {
        var _message = event.data && event.data.surfingkeys_uihost_data;
        if (_message === undefined) {
            return;
        }
        if (_message.toFrontend) {
            // forward message to frontend
            ifr.contentWindow.postMessage({surfingkeys_frontend_data: _message}, frontEndURL);
            if (_message.toFrontend && event.source
                && ['showStatus', 'showEditor', 'openOmnibar', 'openFinder', 'chooseTab', 'openSwitcher', 'togglePalette'].indexOf(_message.action) !== -1) {
                if (!activeContent || activeContent.window !== event.source) {
                    // reset active Content

                    if (activeContent) {
                        activeContent.window.postMessage({surfingkeys_content_data: {
                            action: 'deactivated',
                            reason: `${_message.action}@${event.timeStamp}`
                        }}, activeContent.origin);
                    }

                    activeContent = {
                        window: event.source,
                        origin: _message.origin
                    };

                    activeContent.window.postMessage({surfingkeys_content_data: {
                        action: 'activated',
                        reason: `${_message.action}@${event.timeStamp}`
                    }}, activeContent.origin);
                }
            }
        } else if (_message.action && _actions.hasOwnProperty(_message.action)) {
            _actions[_message.action](_message);
        } else if (_message.toContent) {
            // forward message to content
            if (activeContent) {
                activeContent.window.postMessage({surfingkeys_content_data: _message}, activeContent.origin);
            }
        }
        event.stopImmediatePropagation();
    }

    // top -> frontend: origin
    // frontend -> top:
    // top -> top: apply user settings
    ifr.addEventListener("load", function() {
        this.contentWindow.postMessage({surfingkeys_frontend_data: {
            action: 'initFrontend',
            ack: true,
            winSize: [window.innerWidth, window.innerHeight],
            origin: getDocumentOrigin()
        }}, frontEndURL);

        window.addEventListener('message', _onWindowMessage, true);

    }, {once: true});

    var lastStateOfPointerEvents = "none", _origOverflowY;
    var _actions = {}, activeContent = null;

    // An element in fullscreen (a video player) is drawn in the top layer, above this
    // host: a panel opened under it takes the keys while nobody can see it, and the
    // switcher would switch to a tab the user never saw. So while the frame is
    // interactive it goes where it shows, and the page stays in fullscreen: into the
    // fullscreen element when that draws it (moveBefore keeps the frame loaded,
    // where a plain move would reload it), else into the top layer as a popover,
    // which Chrome draws above the fullscreen element but does not hit-test, so keys
    // reach the frame and a click reaches the page.
    // document.fullscreenElement is retargeted: when the element really in fullscreen
    // sits in a shadow root it names the shadow host, whose slotted children are laid
    // out yet drawn outside the top layer. So the move aims at the innermost element
    // an open shadow root names, and it stands only if a hit test at the frame lands
    // on the frame, which a frame drawn under the top layer never gets.
    var raisedAs = null, hostStyle = "";
    function innermostFullscreenElement() {
        var fs = document.fullscreenElement;
        while (fs && fs.shadowRoot && fs.shadowRoot.fullscreenElement) {
            fs = fs.shadowRoot.fullscreenElement;
        }
        return fs;
    }
    function hitsFrame() {
        var r = ifr.getBoundingClientRect();
        var x = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1),
            y = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
        var root = uiHost.getRootNode();
        return r.width > 0 && r.height > 0 && !!root.elementFromPoint && root.elementFromPoint(x, y) === uiHost;
    }
    function raise() {
        var fs = innermostFullscreenElement();
        if (raisedAs || !fs || fs.contains(uiHost)) {
            return;
        }
        // children of a replaced element are never drawn, nor those of a shadow host
        // that does not slot them
        if (fs.moveBefore && !/^(VIDEO|AUDIO|IFRAME|FRAME|IMG|CANVAS|EMBED|OBJECT)$/.test(fs.tagName)) {
            try {
                fs.moveBefore(uiHost, null);
                raisedAs = "moved";
            } catch (e) {
                // not a place it can go: the popover below
            }
            if (raisedAs && hitsFrame()) {
                return;
            }
            lower();
        }
        if (uiHost.showPopover) {
            hostStyle = uiHost.style.cssText;
            uiHost.popover = "manual";
            // undo the UA's popover box, a bordered and padded square in mid screen
            Object.assign(uiHost.style, {position: "fixed", inset: "auto", width: "0", height: "0", margin: "0",
                border: "0", padding: "0", overflow: "visible", background: "transparent"});
            uiHost.showPopover();
            raisedAs = "popover";
        }
    }
    function lower() {
        if (raisedAs === "moved" && uiHost.isConnected && uiHost.parentNode !== document.documentElement) {
            document.documentElement.moveBefore(uiHost, null);
        } else if (raisedAs === "popover") {
            uiHost.matches(":popover-open") && uiHost.hidePopover();
            uiHost.removeAttribute("popover");
            uiHost.style.cssText = hostStyle;
        }
        raisedAs = null;
    }
    // entering fullscreen also hides every popover
    function onFullscreenChange() {
        lower();
        if (lastStateOfPointerEvents !== "none") {
            raise();
        }
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);

    // Reloading or updating the extension kills the frontend but leaves this page as
    // it was: a panel open then stays a dead frame over the whole page that takes
    // every click until the page is reloaded (Mode.isOrphaned gives the keys back,
    // not the mouse). Watched only while a panel is open.
    var orphanWatch = null;
    function watchOrphan(on) {
        clearInterval(orphanWatch);
        orphanWatch = on ? setInterval(function() {
            if (Mode.isOrphaned()) {
                clearInterval(orphanWatch);
                window.removeEventListener('message', _onWindowMessage, true);
                document.removeEventListener("fullscreenchange", onFullscreenChange);
                uiHost.remove();
                if (document.body) {
                    document.body.style.animationFillMode = "";
                    document.body.style.overflowY = _origOverflowY;
                }
            }
        }, 500) : null;
    }

    _actions['initFrontendAck'] = function(response) {
        onload(uiHost);
    };
    _actions['setFrontFrame'] = function(response) {
        ifr.style.height = response.frameHeight;
        if (response.pointerEvents) {
            ifr.style.pointerEvents = response.pointerEvents;
        }
        if (response.pointerEvents === "none") {
            lower();
            watchOrphan(false);
            uiHost.blur();
            ifr.blur();
            // test with https://docs.google.com/ and https://web.whatsapp.com/
            if (lastStateOfPointerEvents !== response.pointerEvents && activeContent) {
                if (browser.getBackFocusFromFrontend) {
                    browser.getBackFocusFromFrontend();
                } else {
                    activeContent.window.postMessage({surfingkeys_content_data: {
                        action: 'getBackFocus'
                    }}, activeContent.origin);
                }
            }
            if (document.body) {
                document.body.style.animationFillMode = "";
                document.body.style.overflowY = _origOverflowY;
            }
        } else {
            raise();
            watchOrphan(true);
            if (browser.focusFrontend) {
                browser.focusFrontend(ifr);
            }
            if (document.body) {
                document.body.style.animationFillMode = "none";
                if (_origOverflowY === undefined) {
                    _origOverflowY = document.body.style.overflowY;
                }
                document.body.style.overflowY = 'visible';
            }
        }
        lastStateOfPointerEvents = response.pointerEvents;
    };

    uiHost.tryDetach = function() {
        ifr.contentWindow.postMessage({surfingkeys_frontend_data: {
            action: 'destroyFrontend',
            ack: true,
            origin: getDocumentOrigin()
        }}, frontEndURL);
    };
    _actions['destroyFrontendAck'] = function(response) {
        if (response.data === true) {
            runtime.postTopMessage({surfingkeys_content_data: {
                action: 'frontendDestroyed',
            }});
            window.removeEventListener('message', _onWindowMessage, true);
            document.removeEventListener("fullscreenchange", onFullscreenChange);
            watchOrphan(false);
            uiHost.remove();
        } else {
            LOG("warn", "frontend in use");
        }
    };
    document.documentElement.appendChild(uiHost);
}

export default createUiHost;
