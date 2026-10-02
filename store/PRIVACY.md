# Privacy policy: Surfingkeys Palette

Surfingkeys Palette (a fork of [Surfingkeys](https://github.com/brookhong/Surfingkeys)) has no server and collects nothing. There are no analytics, no tracking and no accounts.

## What stays in your browser

- **Settings**: key mappings, theme, search engines, site list, proxy rules and your settings script are kept in `chrome.storage`. With Chrome sync on, Chrome syncs them to your own Google account.
- **Page content, history, bookmarks and tabs** are read only to show them to you (the omnibar, the command palette, the tab switcher, the start page's bookmarks bar and top sites) and are never sent anywhere.
- **Clipboard** is read only when you press a key that pastes, and written only when you press a key that copies.

## When something leaves your computer, and only because you set it up or asked for it

- **Search suggestions**: when you type in the omnibar with a search engine selected, what you type is sent to that engine's suggestion URL, as the engine's own site would.
- **LLM chat**: only if you configure a provider (Ollama, Amazon Bedrock or a custom service URL you enter) and use the chat; your question, and any page text you choose to include, go to that provider under its own privacy policy. Your API keys stay in `chrome.storage.local`.
- **Settings from a URL**: only if you set *Load settings from* to a web address, the extension downloads that file.
- **Proxy**: only if you turn it on, Chrome sends the sites you choose through the proxy you enter.
- **Neovim, `~/.surfingkeys.js`, profile switching and other profiles' tabs**: only if you install the native messaging host, the extension talks to it on your own computer. When you press `gP`, the host reads the browser's profiles (their names, and the email addresses of the accounts signed in to them) from the browser's own `Local State` file to list them for you, and opens the profile you pick by starting the browser. When you open the command palette, it lists the tabs open in the browser's other profiles: the host of each profile hands the titles and addresses of its open tabs (never those of a private window) to the host of the profile asking, over a local socket in a folder only your own account can open. To name each profile, the extension writes a random token to its own storage, the host finds which profile's folder holds it, and the token is deleted again. Tab titles and addresses are kept in memory only, never written to disk. None of it leaves your computer.

## Contact

Questions: open an issue at https://github.com/hoangtrung99/Surfingkeys/issues.

Last updated: 2026-10-02.
