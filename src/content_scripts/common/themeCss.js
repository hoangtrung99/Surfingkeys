// The built-in themes (themes.js) as styles: one stylesheet for the frontend
// frame, and the styles of link hints and Visual mode, which live in the page.
//
// The stylesheet goes through DOMPurify (setSanitizedContent), which rewrites the
// whole sheet, and breaks every child selector, as soon as it holds the "less
// than" character. SVG icons are URL-encoded for that reason.

const TRANSLUCENT = true;   // frosted-glass panels (blurs the page behind them)
const DIM_PAGE = true;      // dim the page while a panel is open
const SHOW_FOOTER = true;   // key hints under the omnibar results
const MOTION = false;       // open animations; off because panels open from the keyboard many times a day
const PALETTE_WIDTH = 720;  // max omnibar width (px)
const SWITCHER_OPACITY = {dark: 50, light: 60};  // Alt-q strip: thinner glass than the panels (%)
const FOOTER_TEXT = 'Ctrl-↵ open in background  ·  Ctrl-. / Ctrl-, next / previous page';
const CURRENT_LABEL = 'Current';
// System font first: it ships optical sizing and tracking tables for UI sizes.
const FONT_UI = `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", Inter, "Noto Sans", sans-serif`;
const FONT_MONO = `ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace`;

const mix = (v, pct) => `color-mix(in srgb, var(${v}) ${pct}%, transparent)`;
// Text placed in a CSS string: escape quotes and backslashes, never let the forbidden character through.
const cssString = (text) => `"${text.replace(/[\\"]/g, '\\$&').replace(/</g, '\\3c ')}"`;

// Lucide-style stroke icons, URL-encoded so the CSS stays free of the forbidden character.
const svgIcon = (body, color) => `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${color}' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>`
)}")`;

// The custom properties every built-in theme style is written against. `scope` is
// the selector they are declared on: a settings-page preview card declares one
// theme's set on itself, so the card is drawn in that theme inside a page in another.
export function themeTokens(P, scope = ':root') {
    return `${scope} {
  --bg: ${P.bg}; --mantle: ${P.mantle}; --crust: ${P.crust};
  --s0: ${P.s0}; --s1: ${P.s1}; --s2: ${P.s2};
  --overlay: ${P.overlay}; --sub: ${P.sub}; --text: ${P.text};
  --accent: ${P.accent}; --on-accent: ${P.onAccent};
  --yellow: ${P.yellow}; --green: ${P.green}; --blue: ${P.blue};
  --mauve: ${P.mauve}; --peach: ${P.peach}; --red: ${P.red};
  --shadow: ${P.shadow}; --dim: ${P.dim};
  --font: ${FONT_UI}; --mono: ${FONT_MONO};
  --accent-text: ${P.accentText || P.accent};
  --muted: var(--sub);
  --faint: color-mix(in srgb, var(--overlay) 55%, var(--sub));
  --focus-muted: color-mix(in srgb, var(--sub) 55%, var(--text));
  /* light glass separates by being the brightest layer, not a page grey */
  --surface: ${P.surface || (P.light ? "#ffffff" : "var(--bg)")};
  --panel: ${TRANSLUCENT ? `color-mix(in srgb, var(--surface) ${P.glass}%, transparent)` : "var(--surface)"};
  --glass: ${TRANSLUCENT ? "blur(28px) saturate(1.8)" : "none"};
  /* the switcher is a HUD over the page: thinner glass, heavier blur keeps it frosted */
  --hud: ${TRANSLUCENT ? `color-mix(in srgb, var(--surface) ${P.hud || (P.light ? SWITCHER_OPACITY.light : SWITCHER_OPACITY.dark)}%, transparent)` : "var(--surface)"};
  --hud-glass: ${TRANSLUCENT ? "blur(40px) saturate(1.9)" : "none"};
  /* thin dark glass reads over a white page only with a slightly deeper scrim behind it */
  --hud-dim: ${P.light ? "var(--dim)" : "color-mix(in srgb, var(--dim) 85%, black)"};
  --edge: ${P.light ? "rgba(0, 0, 0, .1)" : mix("--text", 13)};
  --rule: ${P.light ? "rgba(0, 0, 0, .07)" : mix("--text", 8)};
  --fill: ${P.light ? "rgba(0, 0, 0, .055)" : mix("--text", 8)};
  --hover: ${P.light ? "rgba(0, 0, 0, .04)" : mix("--text", 5)};
  --sel: ${mix("--accent", P.sel || (P.light ? 16 : 18))};
  --sheen: inset 0 1px 0 ${P.light ? "rgba(255, 255, 255, .85)" : "rgba(255, 255, 255, .06)"};
  --lift: 0 24px 60px -16px var(--shadow), 0 8px 20px -10px var(--shadow);
}`;
}

// Ace ships a light theme; this re-tints an editor mounted at `scope` (and Ace's
// autocomplete popup) with the tokens above.
export function aceCss(scope) {
    return `/* vim editor (ACE ships a light theme; everything below re-tints it) */
${scope} {
  padding: 0; overflow: hidden; border-radius: 14px; min-height: 44px;
  background: var(--bg) !important; color: var(--text);
  border: 1px solid var(--edge); box-shadow: var(--sheen), var(--lift);
  font-family: var(--mono) !important;
}
${scope} .ace_gutter { background: var(--mantle); color: var(--faint); }
${scope} .ace_gutter-active-line { background: var(--fill); color: var(--text); }
${scope} .ace_print-margin { background: transparent; }
${scope} .ace_marker-layer .ace_active-line { background: var(--hover); }
${scope} .ace_marker-layer .ace_selection { background: ${mix("--accent", 32)}; }
${scope} .ace_marker-layer .ace_selected-word { background: transparent; border: 1px solid ${mix("--accent", 50)}; }
${scope} .ace_marker-layer .ace_bracket { border-color: var(--s2); }
${scope} .ace_cursor { color: var(--accent); }
${scope}.normal-mode .ace_cursor { background-color: ${mix("--accent", 55)}; border: 0; }
${scope}.normal-mode .ace_hidden-cursors .ace_cursor { background: transparent; border: 1px solid var(--accent); }
${scope} .ace_dialog { background: var(--mantle); color: var(--text); border-top: 1px solid var(--rule); padding: 4px 10px; }
${scope} .ace_dialog input { color: var(--text); font-family: var(--mono); }
/* red on the dialog fails 4.5:1 in Nord, Dawn and Latte */
${scope} .cm-vim-message { color: var(--text) !important; }
${scope} .ace_scrollbar { scrollbar-color: var(--fill) transparent; }
.ace_editor.ace_autocomplete { background: var(--bg); color: var(--text); border: 1px solid var(--edge); border-radius: 10px; box-shadow: var(--lift); }
.ace_editor.ace_autocomplete .ace_marker-layer .ace_active-line { background: var(--sel); }
.ace_editor.ace_autocomplete .ace_line-hover { background: var(--hover); border-color: transparent; }
/* weight, not colour: accent on a selected row fails 4.5:1 in the light themes */
.ace_editor.ace_autocomplete .ace_completion-highlight { color: inherit; font-weight: 700; }`;
}

// The stylesheet of every surface inside the Surfingkeys frontend frame.
export function themeCss(P) {
    const ICON = {
        search: svgIcon("<circle cx='11' cy='11' r='7'/><path d='m20 20-3.5-3.5'/>", P.overlay),
        // one neutral stroke colour for every glyph: the type is in the shape, not in a hue
        clock: svgIcon("<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>", P.overlay),
        star: svgIcon("<path d='M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'/>", P.overlay),
        globe: svgIcon("<circle cx='12' cy='12' r='9'/><path d='M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18'/>", P.overlay),
        folder: svgIcon("<path d='M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/>", P.overlay),
        bolt: svgIcon("<path d='M13 3 5 13.5h6L10 21l8-10.5h-6z'/>", P.overlay),
    };
    const PANELS = '#sk_omnibar, #sk_tabs.vertical, #sk_tabs.inline, #sk_tabs.horizontal, #sk_tabs:has(div.sk_tab_group),' +
        ' #sk_usage, #sk_popup, #sk_keystroke, #sk_status, #sk_banner, #sk_bubble, #sk_switcher .sk_switcher_hud';

    const css = `
${themeTokens(P)}
body { font-family: var(--font); -webkit-font-smoothing: antialiased; }
${DIM_PAGE ? `
body:has(> #sk_omnibar:not([style*="none"])),
body:has(> #sk_tabs:not([style*="none"])),
body:has(> #sk_usage:not([style*="none"])),
body:has(> #sk_popup:not([style*="none"])),
body:has(> #sk_editor:not([style*="none"])),
body:has(> #sk_nvim:not([style*="none"])) { background-color: var(--dim); }
/* the switcher layer covers the window itself, so its dim waits for its reveal delay */
#sk_switcher { background: var(--hud-dim); }` : ""}

/* ---------- glass material shared by every floating panel ---------- */
${PANELS} {
  background: var(--panel); color: var(--text); font-family: var(--font);
  -webkit-backdrop-filter: var(--glass); backdrop-filter: var(--glass);
  border: 1px solid var(--edge); box-shadow: var(--sheen), var(--lift);
}
@supports not (backdrop-filter: blur(1px)) { :root { --panel: var(--surface); --hud: var(--surface); } }
@media (prefers-reduced-transparency: reduce) { :root { --panel: var(--surface); --glass: none; --hud: var(--surface); --hud-glass: none; } }
@media (prefers-contrast: more) { :root { --panel: var(--surface); --glass: none; --hud: var(--surface); --hud-glass: none; --edge: var(--overlay); } }

.sk_theme { color: var(--text); font-family: var(--font); }
.sk_theme input { color: var(--text); }
.sk_theme .url { color: var(--muted); }
.sk_theme .annotation { color: var(--muted); }
.sk_theme .omnibar_highlight { color: var(--accent-text); }
.sk_theme .prompt, .sk_theme .resultPage { color: var(--muted); }
.sk_theme .feature_name { color: var(--accent-text); }
.sk_theme .separator { color: var(--faint); }
.sk_theme .frame { background: ${mix("--accent", 30)}; }
.sk_theme kbd, #sk_keystroke kbd, #sk_switcher kbd {
  font: 600 11px/1 var(--mono); padding: 4px 6px; border-radius: 6px;
  background: var(--fill); color: var(--text); border: 0; box-shadow: none;
}
.sk_theme ::-webkit-scrollbar { width: 10px; height: 10px; }
.sk_theme ::-webkit-scrollbar-thumb { background: var(--fill); border: 3px solid transparent; border-radius: 99px; background-clip: padding-box; }

/* =====================================================================
   OMNIBAR (t, b, og, :, W ...)
   ===================================================================== */
#sk_omnibar {
  left: 0; right: 0; margin: 0 auto; display: flex; flex-direction: column;
  width: min(${PALETTE_WIDTH}px, calc(100vw - 32px));
  border-radius: 14px; overflow: hidden;
}
#sk_omnibar.sk_theme { opacity: 1; }
#sk_omnibar.sk_omnibar_middle { top: 14vh; }
#sk_omnibar.sk_omnibar_bottom { bottom: 20px; }

/* search field */
#sk_omnibar #sk_omnibarSearchArea {
  margin: 0; padding: 12px 16px; gap: 10px; min-height: 30px;
  border-bottom: 1px solid var(--rule);
}
#sk_omnibar.sk_omnibar_bottom #sk_omnibarSearchArea { border-bottom: 0; border-top: 1px solid var(--rule); }
#sk_omnibar:has(#sk_omnibarSearchResult:empty) #sk_omnibarSearchArea { border-color: transparent; }
#sk_omnibar #sk_omnibarSearchArea::before {
  content: ""; flex: none; width: 18px; height: 18px;
  background: ${ICON.search} center / 18px no-repeat;
}
/* The prompt is "text + span.separator" or just the separator (t). Flattening it
   lets an empty prompt take no space and no flex gap. */
#sk_omnibar #sk_omnibarSearchArea .prompt {
  display: contents;
  font: 500 14px/1 var(--font); white-space: nowrap; color: var(--muted);
}
#sk_omnibar #sk_omnibarSearchArea .prompt .separator { display: none; }
#sk_omnibar #sk_omnibarSearchArea .prompt img { width: 18px !important; height: 18px; border-radius: 4px; }
#sk_omnibar #sk_omnibarSearchArea .prompt img[src=""] { display: none; }
#sk_omnibar #sk_omnibarSearchArea input {
  flex: 1; min-width: 0; margin: 0; padding: 0;
  font: 400 18px/26px var(--font); letter-spacing: -.01em;
  color: var(--text); caret-color: var(--accent);
  background: transparent; border: 0; outline: 0;
}
#sk_omnibar #sk_omnibarSearchArea input::placeholder { color: var(--faint); }
#sk_omnibar #sk_omnibarSearchArea input::selection { background: ${mix("--accent", 35)}; }
#sk_omnibar #sk_omnibarSearchArea .resultPage {
  flex: none; font: 500 11px/1 var(--font); font-variant-numeric: tabular-nums; letter-spacing: .01em;
  color: var(--faint);
}
#sk_omnibar #sk_omnibarSearchArea .resultPage:empty { display: none; }

/* result list */
#sk_omnibar #sk_omnibarSearchResult {
  margin: 0; padding: 6px; max-height: min(560px, calc(86vh - 125px)); overflow-y: auto;
  scrollbar-width: thin; scrollbar-color: var(--fill) transparent;
}
#sk_omnibar #sk_omnibarSearchResult > ul { margin: 0; padding: 0; list-style: none; }
.sk_theme #sk_omnibarSearchResult > ul > li {
  position: relative; box-sizing: border-box; align-items: center; gap: 12px; margin: 0; padding: 7px 10px;
  min-height: 36px; max-height: none; overflow: hidden;
  border-radius: 8px; font-size: 14px; color: var(--text); cursor: default;
}
.sk_theme #sk_omnibarSearchResult > ul > li:nth-child(odd) { background: transparent; }
@media (hover: hover) and (pointer: fine) {
  .sk_theme #sk_omnibarSearchResult > ul > li:hover { background: var(--hover); }
}
.sk_theme #sk_omnibarSearchResult > ul > li.focused { background: var(--sel); }

/* row icon per result type: bare 16px glyphs, so titles line up with the typed text */
#sk_omnibar #sk_omnibarSearchResult li .icon { margin: 0; flex: none; }
#sk_omnibar #sk_omnibarSearchResult li div.icon {
  width: 16px; height: 16px; font-size: 0;
  background: ${ICON.globe} center / 16px no-repeat;
}
#sk_omnibar #sk_omnibarSearchResult li:has(.omnibar_visitcount) div.icon { background-image: ${ICON.clock}; }
#sk_omnibar #sk_omnibarSearchResult li:has(.omnibar_folder) div.icon { background-image: ${ICON.star}; }
#sk_omnibar #sk_omnibarSearchResult li img.icon { width: 16px; height: 16px; border-radius: 3px; object-fit: contain; }

/* title + url */
#sk_omnibar #sk_omnibarSearchResult li .text-container {
  flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px;
}
#sk_omnibar #sk_omnibarSearchResult li div.title {
  font-size: 14px; line-height: 20px; font-weight: 500; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#sk_omnibar #sk_omnibarSearchResult li div.url {
  font-size: 12px; line-height: 16px; font-weight: 400; color: var(--muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#sk_omnibar #sk_omnibarSearchResult li.focused div.url,
#sk_omnibar #sk_omnibarSearchResult li.focused span.annotation { color: var(--focus-muted); }
#sk_omnibar #sk_omnibarSearchResult span.omnibar_highlight {
  color: var(--accent-text); font-weight: 600; text-shadow: none;
}
/* the URL line is secondary, and the selection fill already tints the focused row:
   bold alone shows why a row matched there */
#sk_omnibar #sk_omnibarSearchResult div.url span.omnibar_highlight,
#sk_omnibar #sk_omnibarSearchResult li.focused span.omnibar_highlight { color: inherit; }

/* folder and visit count: quiet text after the title, one colour, no pill */
#sk_omnibar #sk_omnibarSearchResult .omnibar_folder,
#sk_omnibar #sk_omnibarSearchResult .omnibar_visitcount {
  margin-left: 6px; font-size: 12px; font-weight: 400; color: var(--muted);
}
#sk_omnibar #sk_omnibarSearchResult .omnibar_timestamp { display: none; }

/* bookmark folders (b) */
#sk_omnibar #sk_omnibarSearchResult > ul > li > div.title:only-child {
  display: flex; align-items: center; gap: 12px; color: var(--text); font-weight: 500;
}
#sk_omnibar #sk_omnibarSearchResult > ul > li > div.title:only-child::before {
  content: ""; flex: none; width: 16px; height: 16px;
  background: ${ICON.folder} center / 16px no-repeat;
}

/* commands (:) and search suggestions */
.sk_theme #sk_omnibarSearchResult.commands > ul > li { font: 500 13px/20px var(--mono); }
.sk_theme #sk_omnibarSearchResult li span.annotation {
  font: 400 12px var(--font); color: var(--muted); margin-left: auto; padding-left: 16px; text-align: right;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* LLM chat (A): Surfingkeys gives it 90vh and its own keys */
#sk_omnibar #sk_omnibarSearchResult.llmChat { max-height: calc(86vh - 120px); }
#sk_omnibar:has(#sk_omnibarSearchResult.llmChat)::after { content: none; display: none; }

/* windows (W) */
/* one row like the others: the --sel fill marks the focused window.
   border: 0 on both states, or frontend.css brings back its 2px borders */
.sk_theme #sk_omnibarSearchResult > ul > li.window,
.sk_theme #sk_omnibarSearchResult > ul > li.window.focused {
  flex-wrap: wrap; gap: 6px; margin: 4px 0; padding: 8px;
  border: 0; border-radius: 8px;
}
#sk_omnibar #sk_omnibarSearchResult .tab_in_window {
  margin: 0; padding: 6px 10px; max-width: 220px; box-shadow: none;
  background: var(--fill); border: 0; border-radius: 8px;
}

/* key hints under the results; hidden while the list is empty */
${SHOW_FOOTER ? `
#sk_omnibar::after {
  content: ${cssString(FOOTER_TEXT)};
  display: block; padding: 8px 16px; white-space: pre; overflow: hidden; text-overflow: ellipsis;
  font: 500 11px/16px var(--font); color: var(--faint); border-top: 1px solid var(--rule);
}
/* the two hints mean nothing in : and W */
#sk_omnibar:has(#sk_omnibarSearchResult:empty)::after,
#sk_omnibar:has(#sk_omnibarSearchResult.commands)::after,
#sk_omnibar:has(li.window)::after { display: none; }` : ""}

/* Command Palette (fork), after Arc's Command Bar: one flat list of one-line rows.
   Title column at 44px, level with the typed text (6 + 10 + 16 + 12 = 16 + 18 + 10). */
#sk_omnibar.sk_palette::after { display: none; }
#sk_omnibar.sk_palette #sk_omnibarSearchArea { padding: 14px 16px; }
#sk_omnibar.sk_palette #sk_omnibarSearchResult > ul > li { min-height: 40px; padding: 8px 10px; }
#sk_omnibar.sk_palette .sk_palette_row { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px; }
#sk_omnibar.sk_palette .sk_palette_title { flex: 0 1 auto; min-width: 0; font-size: 14px; line-height: 20px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#sk_omnibar.sk_palette .sk_palette_sub { flex: 0 10000 auto; min-width: 0; font: 400 12px/16px var(--font); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#sk_omnibar.sk_palette .sk_palette_meta { flex: none; margin-left: auto; font: 400 12px/1 var(--font); color: var(--faint); }
/* what Enter does, named on the selected row only: the selection fill already says "this one" */
#sk_omnibar.sk_palette .sk_palette_label { display: none; flex: none; margin-left: auto; font: 600 12px/1 var(--font); color: var(--text); }
#sk_omnibar.sk_palette li.focused .sk_palette_label { display: inline; }
#sk_omnibar.sk_palette .sk_palette_meta + .sk_palette_label { margin-left: 10px; }
/* the web-search row always says so: without it, it reads as one more suggestion */
#sk_omnibar.sk_palette li.sk_palette_kind_search .sk_palette_label { display: inline; font-weight: 400; color: var(--muted); }
#sk_omnibar.sk_palette li.sk_palette_kind_search.focused .sk_palette_label { font-weight: 600; color: var(--text); }
/* matches are bold, not coloured (as in Arc): accent on every row was noise */
#sk_omnibar.sk_palette #sk_omnibarSearchResult span.omnibar_highlight { color: inherit; }
#sk_omnibar.sk_palette li.focused .sk_palette_sub,
#sk_omnibar.sk_palette li.focused .sk_palette_meta { color: var(--focus-muted); }
#sk_omnibar.sk_palette .sk_palette_keys { flex: none; margin-left: auto; }
#sk_omnibar.sk_palette .sk_palette_keys kbd { padding: 3px 6px; }
/* one neutral glyph per kind, like the other omnibar rows (two ids: the generic row icon rule has two) */
#sk_omnibar.sk_palette #sk_omnibarSearchResult li.sk_palette_kind_search div.icon,
#sk_omnibar.sk_palette #sk_omnibarSearchResult li.sk_palette_kind_suggestion div.icon { background-image: ${ICON.search}; }
#sk_omnibar.sk_palette #sk_omnibarSearchResult li.sk_palette_kind_url div.icon { background-image: ${ICON.globe}; }
#sk_omnibar.sk_palette #sk_omnibarSearchResult li.sk_palette_kind_action div.icon { background-image: ${ICON.bolt}; }
/* Actions mode: the prompt becomes a chip before the input */
#sk_omnibar #sk_omnibarSearchArea .prompt.sk_palette_chip {
  display: inline-flex; align-items: center; height: 22px; padding: 0 8px; border-radius: 6px;
  background: var(--fill); font: 500 12px/1 var(--font); color: var(--text);
}
#sk_omnibar.sk_palette #sk_omnibarSearchArea .resultPage kbd { margin-left: 4px; padding: 3px 5px; }

/* theme menu (;T): a swatch of each palette */
#sk_omnibar:has(.sk_theme_row) #sk_omnibarSearchArea .prompt,
#sk_omnibar:has(.sk_theme_row) #sk_omnibarSearchArea .resultPage,
#sk_omnibar:has(.sk_theme_row)::after { display: none; }
#sk_omnibar .sk_theme_row { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; }
#sk_omnibar .sk_theme_swatch {
  flex: none; display: inline-flex; gap: 3px; padding: 4px 5px; border-radius: 6px;
  box-shadow: inset 0 0 0 1px var(--edge);
}
#sk_omnibar .sk_theme_swatch i { width: 8px; height: 8px; border-radius: 50%; }
#sk_omnibar .sk_theme_name { font-size: 14px; font-weight: 500; }
#sk_omnibar .sk_theme_current { margin-left: auto; font-size: 12px; color: var(--faint); }
#sk_omnibar li.focused .sk_theme_current { color: var(--focus-muted); }

/* =====================================================================
   STATUS BAR + FIND IN PAGE (/)
   ===================================================================== */
#sk_status {
  left: 0; right: 0; bottom: 18px; margin: 0 auto;
  width: max-content; max-width: calc(100vw - 32px);
  padding: 5px; font-size: 12px; border-radius: 999px;
}
#sk_status > span {
  display: inline-block; vertical-align: middle; line-height: 20px;
  padding: 2px 10px !important; border-right: 0 !important; border-radius: 999px;
}
#sk_status > span:empty { display: none; }
#sk_status > span:first-child:not(:empty) {
  background: var(--accent); color: var(--on-accent); font: 600 12px/20px var(--mono);
}
#sk_find {
  width: 300px; background: transparent; border: 0; outline: 0;
  font: 14px var(--font); color: var(--text); caret-color: var(--accent);
}

/* =====================================================================
   RICH KEY HINTS WHILE TYPING A SEQUENCE
   ===================================================================== */
#sk_keystroke {
  right: 16px; bottom: 16px; padding: 8px 12px; border-radius: 14px;
  font: 600 14px var(--mono);
}
#sk_keystroke.expandRichHints {
  padding: 8px 14px; max-height: 70vh; overflow: auto; font: 13px var(--font);
  scrollbar-width: thin; scrollbar-color: var(--fill) transparent;
}
.expandRichHints > div { display: flex; align-items: center; gap: 10px; min-height: 26px; }
.expandRichHints .kbd-span { min-width: 44px; text-align: right; }
.expandRichHints span.annotation { color: var(--muted); padding-left: 0; }
.expandRichHints kbd > .candidates { color: var(--accent-text); }

/* =====================================================================
   HELP (?), POPUP, EDITOR
   ===================================================================== */
#sk_usage, #sk_popup, #sk_editor {
  left: 0; right: 0; top: 8vh; margin: 0 auto; box-sizing: border-box;
  width: min(1100px, calc(100vw - 48px)); max-height: 84vh; padding: 22px 26px;
  border-radius: 14px;
  scrollbar-width: thin; scrollbar-color: var(--fill) transparent;
}
#sk_popup { width: min(680px, calc(100vw - 48px)); top: 16vh; font-size: 14px; line-height: 1.6; text-align: left !important; }
#sk_popup:has(div.sk_tab_hint) { text-align: center !important; }
#sk_popup .sk_tab_group_title { margin-right: 18px; }
#sk_usage {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 22px 34px; align-items: start;
}
#sk_usage > div { display: block; }
#sk_usage .feature_name {
  text-align: left; padding: 0 0 8px; margin-bottom: 6px; border-bottom: 1px solid var(--rule);
}
#sk_usage .feature_name > span {
  border-bottom: 0; color: var(--text); font-size: 13px; font-weight: 600;
}
/* pin each key to the first line of its description */
#sk_usage > div > div:not(.feature_name) {
  display: flex; align-items: baseline; gap: 12px; padding: 4px 0;
}
#sk_usage .kbd-span { flex: none; width: 84px; text-align: right; }
#sk_usage span.annotation { flex: 1; min-width: 0; padding-left: 0; line-height: 1.45; color: var(--muted); }
#sk_usage > p { grid-column: 1 / -1; margin: 0; }
#sk_usage a { color: var(--accent-text) !important; }

${aceCss('#sk_editor')}

/* =====================================================================
   TAB CHOOSER (T): always a centred panel. Long lists become columns so
   every hint stays on screen; the max-height keeps the panel inside the
   window, so Surfingkeys never falls back to its full-width "inline"
   strip in the top-left corner.
   ===================================================================== */
#sk_tabs { background: transparent; }
#sk_tabs.vertical, #sk_tabs.inline, #sk_tabs.horizontal, #sk_tabs:has(div.sk_tab_group) {
  top: 14vh; left: 0; right: 0; margin: 0 auto; box-sizing: border-box;
  max-height: 72vh; overflow: auto; padding: 6px; border-radius: 14px;
  scrollbar-width: thin; scrollbar-color: var(--fill) transparent;
}
#sk_tabs.vertical { width: min(560px, calc(100vw - 32px)); }
#sk_tabs.inline, #sk_tabs.horizontal, #sk_tabs.vertical:has(div.sk_tab:nth-child(15)) {
  width: min(980px, calc(100vw - 32px));
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 2px;
}
#sk_tabs.vertical:has(div.sk_tab:nth-child(46)) { width: min(1180px, calc(100vw - 32px)); grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
/* frontend.css makes these inline-grid / inline-block at the same specificity */
#sk_tabs.horizontal div.sk_tab, #sk_tabs.inline div.sk_tab { display: flex; }
#sk_tabs div.sk_tab {
  display: flex; align-items: center; gap: 10px; box-sizing: border-box;
  width: auto !important; min-height: 36px; margin: 0; padding: 6px 10px;
  border: 0; border-radius: 8px; background: transparent; box-shadow: none;
}
/* --sel means "what Enter acts on" elsewhere; the current tab only gets a badge */
#sk_tabs div.sk_tab.active { background: transparent; }
/* the current tab has no hint: keep the column, show a badge instead */
#sk_tabs div.sk_tab.active::before { content: ""; flex: none; width: 26px; }
#sk_tabs div.sk_tab_group div.sk_tab.active::before { content: none; }
#sk_tabs div.sk_tab.active::after {
  content: ${cssString(CURRENT_LABEL)}; flex: none; margin-left: auto;
  font: 400 12px/1 var(--font); color: var(--faint);
}
#sk_tabs div.sk_tab_wrap { display: flex; flex: 1; align-items: center; gap: 10px; min-width: 0; }
#sk_tabs div.sk_tab_icon { flex: none; padding: 0; line-height: 0; }
#sk_tabs div.sk_tab_icon img { width: 16px; height: 16px; border-radius: 3px; }
#sk_tabs div.sk_tab_title {
  flex: 1; min-width: 0; max-width: none; width: auto !important; padding-left: 0;
  font-size: 14px; font-weight: 500; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
#sk_tabs div.sk_tab_url { color: var(--muted); }
#sk_tabs div.tab_rocket { display: none; }
/* beats frontend.css "#sk_tabs.vertical div.sk_tab_hint { position: fixed }" */
#sk_tabs div.sk_tab div.sk_tab_hint, #sk_tabs div.sk_tab_group div.sk_tab_hint, #sk_popup div.sk_tab_hint {
  position: static; flex: none; box-sizing: border-box; min-width: 22px; margin: 0; padding: 0 5px; text-align: center;
  /* inside a panel the hint does not fight the page: accent = the key to type, as in rich hints */
  font: 700 11.5px/22px var(--mono); color: var(--accent-text); background: var(--fill);
  border: 0; border-radius: 6px; box-shadow: none;
}
/* one fixed hint column, so two-letter hints do not shift the titles */
#sk_tabs div.sk_tab div.sk_tab_hint { width: 26px; min-width: 0; padding: 0; }
#sk_popup div.sk_tab_hint { display: inline-block; margin: 14px 8px 0 0; }
/* tab groups (;G) */
#sk_tabs:has(div.sk_tab_group) { width: min(720px, calc(100vw - 32px)); padding: 8px; }
div.sk_tab_group {
  margin: 4px; padding: 8px; font-size: 13.5px; color: var(--text); vertical-align: top;
  background: var(--fill); border: 0; border-radius: 8px;
}
div.sk_tab_group_header > div { align-items: center; gap: 8px; }

/* =====================================================================
   BANNER + BUBBLE
   ===================================================================== */
#sk_banner {
  left: 0; right: 0; top: 12px !important; margin: 0 auto; width: max-content; max-width: 80vw;
  padding: 8px 16px; font: 500 13px var(--font); color: var(--text);
  border-radius: 999px;
}
/* a small popover: solid, so the tail below matches its body */
#sk_bubble { padding: 12px 14px; font: 14px/1.55 var(--font); border-radius: 14px; background: var(--surface); -webkit-backdrop-filter: none; backdrop-filter: none; }
#sk_bubble.sk_theme * { color: var(--text) !important; }
div.sk_arrow[dir=down] > div:nth-of-type(1) { border-top-color: var(--edge); }
div.sk_arrow[dir=up] > div:nth-of-type(1) { border-bottom-color: var(--edge); }
div.sk_arrow[dir=down] > div:nth-of-type(2) { border-top-color: var(--surface); }
div.sk_arrow[dir=up] > div:nth-of-type(2) { border-bottom-color: var(--surface); }
.sk_scroller_indicator_top { background-image: linear-gradient(var(--s2), transparent); }
.sk_scroller_indicator_middle { background-image: linear-gradient(transparent, var(--s2), transparent); }
.sk_scroller_indicator_bottom { background-image: linear-gradient(transparent, var(--s2)); }

/* =====================================================================
   VISUAL SWITCHER (fork, Alt-q): a strip of tab previews
   ===================================================================== */
#sk_switcher .sk_switcher_hud {
  border-radius: 14px; padding: 14px;
  background: var(--hud); -webkit-backdrop-filter: var(--hud-glass); backdrop-filter: var(--hud-glass);
}
/* fade the strip where it scrolls under the panel edge instead of cutting a card */
#sk_switcher .sk_switcher_track {
  margin: 0 -14px; padding: 0 14px; scroll-padding: 0 14px;
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 14px, #000 calc(100% - 14px), transparent);
  mask-image: linear-gradient(90deg, transparent, #000 14px, #000 calc(100% - 14px), transparent);
}
#sk_switcher .sk_switcher_card { border-radius: 10px; padding: 6px 6px 8px; background: transparent; }
/* ring only: a tinted fill would lighten the glass under the title below 4.5:1 */
#sk_switcher .sk_switcher_card.selected { background: transparent; box-shadow: inset 0 0 0 2px var(--accent); }
#sk_switcher .sk_switcher_thumb { border-radius: 6px; background-color: var(--fill); box-shadow: 0 0 0 1px var(--rule); }
/* on thin glass only the strongest text colour stays readable over any page;
   the selection ring and weight carry the hierarchy instead */
#sk_switcher .sk_switcher_title { font: 500 12.5px/18px var(--font); color: var(--text); }
#sk_switcher .sk_switcher_card.selected .sk_switcher_title { font-weight: 600; }
#sk_switcher .sk_switcher_host { color: var(--text); opacity: 1; }

/* banner is feedback (like a toast), so it may move a little */
@keyframes sk-drop { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
@keyframes sk-in { from { opacity: 0; transform: scale(.98); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: no-preference) {
  #sk_banner { animation: sk-drop .18s cubic-bezier(.23, 1, .32, 1); }
  ${MOTION ? `#sk_omnibar, #sk_tabs, #sk_usage, #sk_popup, #sk_switcher .sk_switcher_hud { animation: sk-in .14s cubic-bezier(.23, 1, .32, 1); }` : ""}
}
`;

    // Fail closed: one stray "less than" makes DOMPurify rewrite the whole sheet.
    // It is invalid CSS outside a string anyway, so escaping it breaks nothing.
    return css.split(String.fromCharCode(60)).join('\\3c ');
}

// Link hints (f), text hints (v) and Visual mode: these live in the page. Each
// theme has its own chip: on dark themes its panel colour with accent letters
// (the border keeps it apart from a dark page), on light themes a solid accent
// chip (a pale chip would vanish on a white page). Text hints swap in a second hue.
export function pageStyles(P) {
    const edge = (c) => P.light ? 'rgba(0, 0, 0, .16)' : `color-mix(in srgb, ${c} 45%, transparent)`;
    const hintBase = `font: 700 11.5px/1.35 ${FONT_MONO}; letter-spacing: .03em; padding: 1px 5px;` +
        `border-radius: 5px; box-shadow: none;`;
    return {
        hints: `div { ${hintBase} color: ${P.hintFg}; background: ${P.hintBg}; border: 1px solid ${edge(P.hintFg)}; }` +
            ` div.hint-scrollable { background: ${P.mauve}; color: ${P.onAccent}; border-color: transparent; }`,
        // begin = a hint at the start of a text node: marked in the chip's own colour, not a third hue
        textHints: `div { ${hintBase} color: ${P.textHintFg}; background: ${P.textHintBg}; border: 1px solid ${edge(P.textHintFg)}; }` +
            ` div.begin { color: ${P.textHintFg}; text-decoration: underline 2px; text-underline-offset: 2px; }`,
        marks: `background-color: ${P.accent}55;`,
        cursor: `background-color: ${P.accent}; color: ${P.onAccent};`,
    };
}
