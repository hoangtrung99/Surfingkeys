#!/bin/sh
# Installs Surfingkeys' native messaging host (this folder's server.lua and
# start.sh) for every Chromium-based browser that has a profile folder here, on
# macOS or Linux. Needs neovim: brew install neovim (macOS), or your package
# manager's neovim (Linux).
set -e

here="$(cd "$(dirname "$0")" && pwd)"
dest="$HOME/.Surfingkeys_NativeMessagingHosts"

case "$(uname -s)" in
    Darwin)
        base="$HOME/Library/Application Support"
        browsers="net.imput.helium
Google/Chrome
Google/Chrome Beta
Chromium
BraveSoftware/Brave-Browser
Microsoft Edge
Vivaldi
Arc/User Data"
        ;;
    Linux)
        base="${XDG_CONFIG_HOME:-$HOME/.config}"
        browsers="net.imput.helium
google-chrome
google-chrome-beta
chromium
BraveSoftware/Brave-Browser
microsoft-edge
vivaldi"
        ;;
    *)
        echo "This script is for macOS and Linux; see Readme.md for Windows." >&2
        exit 1
        ;;
esac

# start.sh widens PATH the same way, so a neovim found here is one it finds too
PATH="/usr/local/bin:/opt/homebrew/bin:/opt/local/bin:$HOME/.local/bin:$PATH"
if ! command -v nvim >/dev/null 2>&1; then
    echo "neovim is not installed: install it first (macOS: brew install neovim)." >&2
    exit 1
fi

mkdir -p "$dest"
cp "$here/server.lua" "$here/start.sh" "$dest/"
chmod +x "$dest/start.sh"

installed=0
# one browser folder per line: several names hold spaces
old_ifs="$IFS"
IFS='
'
for b in $browsers; do
    [ -d "$base/$b" ] || continue
    mkdir -p "$base/$b/NativeMessagingHosts"
    cat > "$base/$b/NativeMessagingHosts/surfingkeys.json" <<EOF
{
    "allowed_origins": [
        "chrome-extension://aajlcoiaogpknhgninhopncaldipjdnp/",
        "chrome-extension://jmblmhjmcjjkjddhjaddkbkpgeolmebm/",
        "chrome-extension://gfbliohnnapiefjpjlpjnehglfpaknnc/"
    ],
    "description": "Surfingkeys native host: neovim, ~/.surfingkeys.js and browser profiles",
    "name": "surfingkeys",
    "type": "stdio",
    "path": "$dest/start.sh"
}
EOF
    echo "Installed for $b"
    installed=$((installed + 1))
done
IFS="$old_ifs"

if [ "$installed" -eq 0 ]; then
    echo "Found no Chromium-based browser profile folder under $base." >&2
    echo "Open your browser once, then run this script again." >&2
    exit 1
fi
echo "Done. Quit the browser completely (Cmd+Q on macOS) and open it again."
