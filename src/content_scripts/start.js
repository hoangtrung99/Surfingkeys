import { RUNTIME } from './common/runtime.js';
import {
    setSanitizedContent,
} from './common/utils.js';
import { marked } from 'marked';
import { guideForBuild, shipsNewTabPage } from './common/newTabPage.js';
import { pageTokens, watchTheme } from './common/quickControls.js';
import { renderTopSites } from './common/topSites.js';
import createWelcome from './welcome.js';

const screen1 = document.querySelector("#screen1");
const screen2 = document.querySelector("#screen2");
const welcome = createWelcome(document.getElementById('welcome'));
let guideReady = false;

// #welcome shows the welcome screen, anything else the guide: screen1, or the
// full list in screen2, which the links in the guide switch between.
function route() {
    const onWelcome = location.hash === '#welcome';
    welcome.show(onWelcome);
    if (onWelcome) {
        screen1.hide();
        screen2.hide();
    } else if (guideReady && screen1.style.display === 'none' && screen2.style.display === 'none') {
        screen1.classList.remove("fadeOut");
        screen1.show();
        screen1.classList.add("fadeIn");
    }
}
window.addEventListener('hashchange', route);
route();

// The page takes the colours of the theme in use, so a pick on the welcome
// screen previews itself. It stays hidden until they are in, rather than
// flashing Surfingkeys' white page before a dark theme.
watchTheme((id) => {
    document.getElementById('sk_page_tokens').textContent = pageTokens(id);
    welcome.showTheme(id);
    document.body.classList.add('sk_ready');
});
setTimeout(() => document.body.classList.add('sk_ready'), 300);

RUNTIME("getTopSites", null, function(response) {
    renderTopSites(document.querySelector("#topSites>ul"), response.urls);
    // a build without the new tab page leaves out the guide's link to its setup
    var source = guideForBuild(document.getElementById('quickIntroSource').innerHTML, shipsNewTabPage());
    setSanitizedContent(document.querySelector('#quickIntro'), marked.parse(source));

    guideReady = true;
    route();

    document.getElementById('back').onclick = function() {
        var cl = screen2.classList;
        cl.remove("fadeOut");
        cl.remove("fadeIn");
        cl.add("fadeOut");
        screen2.one('animationend', function() {
            screen2.hide();
            screen1.show();
            screen1.classList.add("fadeIn");
        });
    };

    // Found by its text: marked no longer gives headings ids, so the old
    // '#show-full-list-of-surfingkeys>a' matched nothing and the page threw
    // on load (the welcome page opened on install included).
    const fullList = Array.from(document.querySelectorAll('#quickIntro a'))
        .find((a) => /Show full list/.test(a.textContent));
    if (fullList) fullList.onclick = function(e) {
        e.preventDefault();
        var cl = screen1.classList;
        cl.remove("fadeOut");
        cl.remove("fadeIn");
        cl.add("fadeOut");
        screen1.one('animationend', function() {
            screen1.hide();
            screen2.show();
            screen2.classList.add("fadeIn");
        });
    };
});

document.addEventListener("surfingkeys:userSettingsLoaded", function(evt) {
    const { getUsage } = evt.detail;
    getUsage(function(usage) {
        var _usage = document.getElementById('sk_usage');
        setSanitizedContent(_usage, usage);
        var keys = Array.from(_usage.querySelectorAll('div')).filter(function(d) {
            return d.firstElementChild.matches(".kbd-span");
        });
        var randomTip = document.getElementById("randomTip");
        setInterval(function() {
            var i = Math.floor(Math.random()*100000%keys.length);
            var cl = randomTip.classList;
            cl.remove("fadeOut");
            cl.remove("fadeIn");
            cl.add("fadeOut");
            randomTip.one('animationend', function() {
                setSanitizedContent(this, keys[i].innerHTML);
                this.classList.add("fadeIn");
            });
        }, 5000);
    });
});
