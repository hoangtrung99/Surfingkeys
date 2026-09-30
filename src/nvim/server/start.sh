#!/bin/sh
# The shebang is required: the browser launches a host with execvp, which refuses a
# script with no interpreter line rather than falling back to a shell.
#
# PATH is widened because a browser started from the desktop passes its children
# launchd's PATH -- /usr/bin:/bin:/usr/sbin:/sbin -- which holds none of the places
# nvim is normally installed, and neither browser reports `exec nvim` failing with 127
# as anything more than the host having exited.
PATH="/usr/local/bin:/opt/homebrew/bin:/opt/local/bin:$HOME/.local/bin:$PATH"
export PATH

# Expanded rather than passed to dirname, so locating server.lua cannot itself
# depend on PATH.
SCRIPT_PATH="${0%/*}"

# Both checks turn a silent failure into a stated one on stderr, which the browser
# logs. Missing server.lua is the worse case: nvim starts, fails to load it, then sits
# on stdin forever rather than exiting.
if ! command -v nvim >/dev/null 2>&1; then
    echo "surfingkeys: nvim not found in PATH ($PATH). Edit PATH in $0." >&2
    exit 127
fi
if [ ! -f "$SCRIPT_PATH/server.lua" ]; then
    echo "surfingkeys: $SCRIPT_PATH/server.lua not found." >&2
    exit 127
fi

# stdout is the browser's native messaging pipe, and one stray byte on it before a
# reply breaks the protocol: the browser drops the host and ;v shows no editor. The
# user's config loads before server.lua and may print there (AstroNvim and snacks.nvim
# write lazygit's terminal colours with io.write), so --cmd, which runs before the
# config, turns Lua's stdout writes into no-ops. server.lua replies through
# nvim_chan_send, which this leaves alone.
exec nvim --headless \
    --cmd "lua local null = {}; function null.write(self) return self end; null.flush = null.write; null.setvbuf = null.write; io.write = function() return null end; io.stdout = null" \
    -c "luafile $SCRIPT_PATH/server.lua"
