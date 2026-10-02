This native messaging host serves four features:

* the neovim editor, which needs it to run `nvim` for you.
* loading settings from `~/.surfingkeys.js`, by setting **Load settings from** to
  `<native>` on the settings page — the browser can not read a file in your home
  directory itself. Safari has the Surfingkeys app for this and needs none of the
  setup below.
* [switching browser profiles](#switching-profiles) with `gP` (Chromium-based
  browsers on macOS and Linux) — an extension sees only the profile it runs in.
* [the tabs of the browser's other profiles](#other-profiles-tabs-in-the-palette) in
  the command palette (the same browsers and systems), for the same reason.

## Installation under Windows

**Note: Please update the paths when creating those files, in below instructions, I'm putting those files under `C:\Users\brook\.Surfingkeys_NativeMessagingHosts\` and `nvim.exe` under `d:\tools\Neovim\bin\`.**

1. Download `server.lua` from https://raw.githubusercontent.com/brookhong/Surfingkeys/master/src/nvim/server/server.lua

1. Create a `start.bat`

        @echo off
        d:\tools\Neovim\bin\nvim.exe --headless -c "luafile C:\Users\brook\.Surfingkeys_NativeMessagingHosts\server.lua"

1. Create a `surfingkeys.json`

        {
            "allowed_origins": [
                "chrome-extension://aajlcoiaogpknhgninhopncaldipjdnp/",
                "chrome-extension://gfbliohnnapiefjpjlpjnehglfpaknnc/"
            ],
            "description": "Neovim UI client from Surfingkeys",
            "name": "surfingkeys",
            "type": "stdio",
            "path": "C:\\Users\\brook\\.Surfingkeys_NativeMessagingHosts\\start.bat"
        }

1. Create a `surfingkeys.reg` for Google Chrome

        Windows Registry Editor Version 5.00

        [HKEY_CURRENT_USER\SOFTWARE\Google\Chrome\NativeMessagingHosts\surfingkeys]
        @="C:\\Users\\brook\\.Surfingkeys_NativeMessagingHosts\\surfingkeys.json"

    or for Chromium,

        Windows Registry Editor Version 5.00

        [HKEY_CURRENT_USER\SOFTWARE\Chromium\NativeMessagingHosts\surfingkeys]
        @="C:\\Users\\brook\\.Surfingkeys_NativeMessagingHosts\\surfingkeys.json"

1. Double click the reg file to import it.

1. Restart your browser.

## Installation under Mac / Linux

1. Download `server.lua` from https://raw.githubusercontent.com/hoangtrung99/Surfingkeys/master/src/nvim/server/server.lua to a folder, such as `$HOME/.Surfingkeys_NativeMessagingHosts/`.
   (Upstream's copy serves the editor and `<native>` settings too, but not profile
   switching or the other profiles' tabs.)

1. Create a `start.sh` under the same folder, and `chmod +x` it. Two lines in it are
   easy to leave out, and both fail silently — the host never starts and the browser
   reports only *"Native host has exited."* (Chrome) or *"An unexpected error
   occurred"* (Firefox):

    * **the shebang** — without it the script is never run at all.
    * **the `PATH` line**, because a browser started from the desktop gives its
      children a minimal `PATH` with none of the usual install locations in it, so
      plain `nvim` is not found. Add wherever your own `which nvim` reports if it is
      not already listed.

            #!/bin/sh
            PATH="/usr/local/bin:/opt/homebrew/bin:/opt/local/bin:$HOME/.local/bin:$PATH"
            export PATH
            SCRIPT_PATH="${0%/*}"
            exec nvim --headless -c "luafile $SCRIPT_PATH/server.lua"

   The copy in this folder checks both before starting nvim and writes a reason to
   stderr, which the browser logs — worth copying, since a missing `server.lua`
   otherwise leaves the browser waiting with nothing to show.

1. Create a `surfingkeys.json` under `<Chromium User Data Directory>/NativeMessagingHosts/`.

        {
            "allowed_origins": [
                "chrome-extension://aajlcoiaogpknhgninhopncaldipjdnp/",
                "chrome-extension://gfbliohnnapiefjpjlpjnehglfpaknnc/"
            ],
            "description": "Neovim UI client from Surfingkeys",
            "name": "surfingkeys",
            "type": "stdio",
            "path": "<PATH_TO_YOUR_START_SH>/start.sh"
        }

    The unpacked build (from Releases or `npm run build`) always has the id
    `aajlcoiaogpknhgninhopncaldipjdnp`, the first one listed. The Chrome Web Store
    build ("Surfingkeys Palette") has its own: add the id `chrome://extensions` shows
    for it to `allowed_origins`.

    **Chromium User Data Directory**
    ### Mac OS X
    The default location is in the Application Support folder:

    * [Chrome] ~/Library/Application Support/Google/Chrome
    * [Chromium] ~/Library/Application Support/Chromium
    * [Helium] ~/Library/Application Support/net.imput.helium — so the file is
      `~/Library/Application Support/net.imput.helium/NativeMessagingHosts/surfingkeys.json`.
      Helium also looks in Chrome's folder,
      `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`, when its own
      has no `surfingkeys.json`, so a file set up for Chrome already serves it.

    ### Linux
    The default location is in ~/.config:

    * [Chrome] ~/.config/google-chrome
    * [Chromium] ~/.config/chromium

1. Restart your browser.

## Installation under Firefox

Firefox uses the same `server.lua` and `start.sh`, but identifies the extension by
id: use `allowed_extensions` in place of `allowed_origins`.

    {
        "allowed_extensions": [ "surfingkeys@github.com" ],
        "description": "Neovim UI client from Surfingkeys",
        "name": "surfingkeys",
        "type": "stdio",
        "path": "<PATH_TO_YOUR_START_SH>/start.sh"
    }

Which id to use depends on the build you run, and a mismatch is refused:

* a development build (`npm run build:dev`) is `surfingkeys@github.com`.
* the released addon from AMO is `{a8332c60-5b6d-41ee-bfc8-e9bb331d34ad}`.

`about:debugging#/runtime/this-firefox` shows the id of whatever is actually loaded.

Save it as `surfingkeys.json` under

* [Mac OS X] ~/Library/Application Support/Mozilla/NativeMessagingHosts/
* [Linux] ~/.mozilla/native-messaging-hosts/
* [Windows] a registry key
  `HKEY_CURRENT_USER\SOFTWARE\Mozilla\NativeMessagingHosts\surfingkeys` pointing
  at the file, as for Chrome above.

Then restart your browser.

## Switching profiles

`gP`, `:profile` and *Switch Profile…* in the command palette list the browser's
profiles; picking one opens Surfingkeys' start page in it. The tab goes into that
profile's last used window, which comes to the front, or into a new window when the
profile has none open. The host does it by starting the browser itself with
`--profile-directory`, which hands the request to the browser already running.

It needs:

* a Chromium-based browser (Chrome, Chromium, Helium, Brave, Edge…) on **macOS or
  Linux**. Windows is not supported: see the next point.
* `start.sh` to start nvim with **`exec`**, as both the copy here and the one above
  do. The browser must be nvim's parent: that is how the host tells which browser,
  which data directory and which executable to use. On Windows `start.bat` cannot
  `exec`, so the parent is `cmd.exe`. A wrapper that runs nvim as a child (some
  version managers do) breaks it the same way.
* the `server.lua` from this fork. An older one makes the list say so.
* Surfingkeys enabled in the profile you switch to, or the browser blocks the page it
  opens there.

The host refuses rather than guesses. It uses a data directory only when the
`SingletonLock` in it names the browser that started the host and its
`SingletonSocket` is in place, and it opens only profiles that `Local State` lists. A
wrong directory would start a second, separate browser instead of reaching the running
one, and a profile name the browser does not have would create a new, empty profile.
The menu says why when it refuses.

What else to expect:

* A profile that is not open and is set to *Continue where you left off* opens with
  its last session restored, the start page added to it. The browser gives no way to
  skip that.
* In Helium, a profile that has never finished onboarding also gets a `chrome://setup`
  tab.
* A profile created or renamed in the last ten seconds or so may be missing or show
  its old name: the browser writes `Local State` lazily.
* No profile is marked as the current one. Picking the profile you are in just opens
  the start page in a new tab.
* The menu answers once the browser has taken the request, or after 15 seconds at
  most. A browser too busy to confirm by then is left alone (started from a terminal,
  the launched browser would wait 20 seconds and then end the running one to take its
  place), and the menu says the switch is *not confirmed yet*, not that it failed: the
  request has usually reached the browser all the same, so the profile's window may
  still come forward once the browser catches up.

## Other profiles' tabs in the palette

The command palette (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>) lists this profile's
open tabs first. The tabs open in the browser's other profiles follow, a moment later,
under *Tabs in* and each profile's name. Picking one brings that profile's window to the
front with the tab selected. If the tab or the profile has closed since the list was
read, the palette stays open and says so.

How it works: the browser runs one host per open profile, since Surfingkeys in each
profile starts its own. Each host listens on a UNIX socket, and the palette's host asks
the others for their tabs and passes on a switch to the one that holds the tab. Each
host asks its own Surfingkeys, which lists the tabs or switches to one. The sockets are
in

    $XDG_RUNTIME_DIR/surfingkeys-<uid>/<hash of the browser's data directory>/<pid>.sock

with `$TMPDIR` in place of `$XDG_RUNTIME_DIR` when that is not set, and `/tmp` when
neither is (macOS has a private `$TMPDIR` for each user). The host makes both folders
with mode `0700`. If either one exists and belongs to another user, or other users can
open it, the host does not use it, and the palette lists only this profile's tabs.
Removing the folder fixes that. A host removes its socket when it exits. A host
that was killed leaves its socket behind, and the next host to find it removes it.

What is shared, and with whom:

* the title, address, favicon address and window of each open tab. Tabs in a private
  window are never listed, and a private window's palette lists no other profile's tabs.
* only between the profiles of **one** browser, the one whose data directory the host
  found (see [Switching profiles](#switching-profiles)). Another browser running
  Surfingkeys has its own folder and is never asked.
* only through those sockets and the hosts' memory. Nothing of the tabs is written to
  disk: the log described below records only how big those messages were.

Which profile a host serves is not something a host or an extension can know on its own.
So when Surfingkeys connects to its host, it writes a random token to its own
`chrome.storage.local`. The host looks for that token in each profile's
`Local Extension Settings/<extension id>/` folder, the files where the browser keeps that
storage. The profile whose folder holds it is the one the host serves, and its name comes
from `Local State`, as in the profile list. Surfingkeys then deletes the token. When it is
not found, the tabs are listed under *another profile*.

It needs everything [switching profiles](#switching-profiles) needs, and also:

* Surfingkeys running in the other profile, connected to the host. A profile with no
  window open is usually not loaded, so it has no tabs to list.
* the same `server.lua` in every profile's host. They all run the one file you installed,
  so this holds unless you replaced it while the browser was running.

Each other profile has 1.5 seconds to answer. One that does not is left out of that
palette, and the palette is never held up waiting for it: this profile's tabs are shown
at once.

## Note on `<native>` settings

When the file can not be read — no host installed, or no answer from it — the page
keeps the settings from the last successful read, and the settings page says what went
wrong.

To see why, `touch ~/.surfingkeys.log.on` and reload the extension: each host process
then writes `~/.surfingkeys.<pid>.log`, holding every message in both directions —
the names and email addresses of your browser profiles included, once the profile list
has been opened. Messages that carry tab titles and addresses are logged by their size
only. Delete the marker to stop it.
