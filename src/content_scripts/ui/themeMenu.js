// The theme menu, opened by ;T, :theme and "Change Theme…" in the Command
// Palette: an Auto row (the system's light or dark setting picks from a pair),
// then a row per built-in theme (common/themes.js) with a swatch of its
// colours, the one picked marked. The page side (content_scripts/theme.js)
// keeps the pick and sends the stylesheet this frame shows (applyBuiltinTheme).
import { createElementWithContent, htmlEncode, setSanitizedContent } from '../common/utils.js';
import { autoEntry, themeEntries } from '../common/themes.js';

const ENTRIES = themeEntries();

// "rose" finds "Rosé Pine"
function fold(s) {
    return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export default function createThemeMenu(omnibar, front) {
    const self = {
        focusFirstCandidate: true,
        prompt: '',
    };
    // the stored pick, which is Auto rather than the theme Auto draws
    let current = null, pair = null;

    front._actions['applyBuiltinTheme'] = function(message) {
        current = message.picked || message.theme;
        pair = message.pair;
        setSanitizedContent(document.getElementById('sk_theme'), message.css);
    };

    function pick(name) {
        front.contentCommand({action: 'pickTheme', name});
    }

    function render(entry) {
        const dots = entry.dots.map((c) => `<i style="background:${c}"></i>`).join('');
        const li = createElementWithContent('li', `<div class="sk_theme_row">`
            + `<span class="sk_theme_swatch" style="background:${entry.bg}">${dots}</span>`
            + `<span class="sk_theme_name">${htmlEncode(entry.name)}</span>`
            + (entry.id === current ? '<span class="sk_theme_current">In use</span>' : '')
            + '</div>');
        li.themeId = entry.id;
        return li;
    }

    function update() {
        const terms = fold(omnibar.input.value).split(/\s+/).filter((t) => t.length);
        const entries = [autoEntry(pair)].concat(ENTRIES).filter((e) => terms.every((t) => fold(`${e.name} ${e.also}`).includes(t)));
        omnibar.listResults(entries, render);
        const lis = Array.from(omnibar.resultsDiv.querySelectorAll('li'));
        lis.forEach((li) => {
            li.onclick = () => {
                pick(li.themeId);
                front.hidePopup();
            };
        });
        // nothing typed yet: start from the theme in use, so the arrows reach its neighbours
        const inUse = !terms.length && lis.find((li) => li.themeId === current);
        if (inUse) {
            lis.forEach((li) => li.classList.remove('focused'));
            omnibar.focusItem(inUse);
        }
    }

    self.onOpen = function() {
        omnibar.input.placeholder = 'Search themes…';
        update();
    };
    self.onInput = update;
    self.onEnter = function() {
        const fi = omnibar.resultsDiv.querySelector('li.focused');
        fi && pick(fi.themeId);
        return true;
    };

    omnibar.command('theme', '#11Choose a theme, or :theme nord', function(args) {
        const name = args.join(' ').trim();
        if (name) {
            pick(name);
        } else {
            front._actions['openOmnibar']({type: 'Themes'});
        }
    });

    return self;
}
