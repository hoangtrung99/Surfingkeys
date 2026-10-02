# Chrome Web Store listing: Surfingkeys Palette

Paste these into the developer dashboard. Screenshots, promo tile and icon are in this folder.

## Store listing

**Name** (from the manifest): Surfingkeys Palette

**Summary** (132 chars max):
Vim-style keys for the web, plus a command palette, a visual tab switcher and 10 colour themes. A fork of Surfingkeys.

**Category**: Workflow & Planning (or Tools) · **Language**: English

**Description**:

Surfingkeys Palette is a fork of Surfingkeys, the keyboard-driven browser extension by brook hong, with a command palette, a visual tab switcher, built-in themes and a redesigned settings page. Everything Surfingkeys does is still here.

COMMAND PALETTE (Cmd+Shift+P on macOS, Ctrl+Shift+K on Windows and Linux)
One box for open tabs, history, bookmarks, URLs and web search. Press Tab for actions on the current tab: copy the URL, pin, mute, move to another window, change the theme, open a settings section, turn the extension off for a site, show every key. With the optional native helper (macOS, Linux), the tabs open in your browser's other profiles are listed too, under each profile's name.

VISUAL TAB SWITCHER (Alt+Q)
Hold Alt and press Q to step through your tabs in most-recently-used order, release Alt to switch. A quick tap keeps it open so you can pick with the arrow keys or the mouse.

THEMES (;T)
Catppuccin Mocha and Latte, Tokyo Night, Rosé Pine and Dawn, Nord, Dracula, Gruvbox, Everforest and GitHub Light for every panel, hint and editor. Auto follows your system's light or dark mode.

VIM-STYLE KEYS (from Surfingkeys)
Link hints (f), scrolling (j/k, d/u), tab keys, the omnibar (t, b, o), visual mode for selecting text, marks, sessions, a Vim or Emacs editor for any text box, a Markdown preview, a PDF viewer, page capture and more. Press ? on any page for the full list.

SETTINGS, WELCOME PAGE AND POPUP
A settings page with sections for appearance, keys (change, turn off or reset any key), search engines, sites, a settings script editor, proxy and backup (export and import). A welcome page on install. A toolbar popup to turn it off for a site and switch themes.

Open source, MIT licensed: https://github.com/hoangtrung99/Surfingkeys
Guide (English and Vietnamese): https://claude.ai/artifact/FGCfEYQyHM6m4ywGB8xV2j
Not affiliated with the original Surfingkeys listing.

**Official URL / Homepage**: https://github.com/hoangtrung99/Surfingkeys
**Support URL**: https://github.com/hoangtrung99/Surfingkeys/issues

## Privacy practices tab

**Single purpose**:
Control the browser from the keyboard: navigate pages, links and tabs with Vim-style keys and a command palette, with themes for its own panels.

**Permission justifications**:

| Permission | Why |
|:--|:--|
| Host permission `<all_urls>` | The keys work on every page, so the content script and its panels (hints, omnibar, palette) must run on every site the user visits. |
| `tabs` | Switch, close, move, pin and mute tabs; list tabs in the omnibar, the palette and the tab switcher. |
| `tabGroups` | Commands that act on tab groups (group, ungroup, move tabs into a group). |
| `history` | Search browsing history from the omnibar and the command palette. |
| `bookmarks` | Search, open and add bookmarks from the omnibar, and show the bookmarks bar on the extension's start page. |
| `sessions` | Reopen recently closed tabs. |
| `topSites` | Show most-visited sites on the start page and in the omnibar. |
| `favicon` | Show each site's icon next to results in the omnibar, the palette and the tab switcher, and next to bookmarks and top sites on the start page. |
| `storage` | Keep the user's settings, key mappings and theme. |
| `scripting` | Inject the content script into tabs that were open before install and into frames. |
| `userScripts` | Run the user's own settings script (custom key mappings) in pages, as the user writes it on the settings page; nothing runs unless the user turns on Allow User Scripts. |
| `clipboardRead`, `clipboardWrite` | Copy (for example the page URL or a link) and paste into the omnibar, only on the user's key press. |
| `downloads`, `downloads.shelf` | Download a link or image on the user's key press, and show or hide the downloads bar. |
| `tts` | Read the selected text aloud when the user asks. |
| `proxy` | Optional proxy settings the user configures on the settings page. |
| `nativeMessaging` | Talk to an optional helper the user installs on their own computer, which runs Neovim as the text editor, reads `~/.surfingkeys.js`, and switches browser profiles: when the user presses gP it lists the browser's profiles (their names and the email addresses of signed-in accounts, read from the browser's own Local State file) and opens the one picked by starting the browser. It also shows the tabs open in the browser's other profiles in the command palette: the helpers of the same browser's profiles pass the titles and addresses of those tabs (never a private window's) to each other over a local socket that only the user's own account can open, and keep nothing on disk. Nothing of it leaves the computer. |

**Remote code**: No. All code is in the package; the user's own settings script runs through the `chrome.userScripts` API only after the user allows it.

**Data usage**: tick nothing under "collects". Certify: not sold, not used for unrelated purposes, not used for creditworthiness.

**Privacy policy URL**: https://github.com/hoangtrung99/Surfingkeys/blob/master/store/PRIVACY.md

## Distribution

Visibility: Public. Regions: all.
