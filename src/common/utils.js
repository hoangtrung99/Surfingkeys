function LOG(level, msg) {
    // To turn on all levels: chrome.storage.local.set({"logLevels": ["log", "warn", "error"]})
    chrome.storage.local.get(["logLevels"], (r) => {
        const logLevels = r && r.logLevels || ["error"];
        if (["log", "warn", "error"].indexOf(level) !== -1 && logLevels.indexOf(level) !== -1) {
            console[level](msg);
        }
    });
}

function regexFromString(str, caseSensitive, highlight) {
    var rxp = null;
    const flags = caseSensitive ? "" : "i";
    str = str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
    if (highlight) {
        rxp = new RegExp(str.replace(/\s+/, "\|"), flags);
    } else {
        var words = str.split(/\s+/).map(function(w) {
            return `(?=.*${w})`;
        }).join('');
        rxp = new RegExp(`^${words}.*$`, flags);
    }
    return rxp;
}

function filterByTitleOrUrl(urls, query, caseSensitive) {
    if (query && query.length) {
        var rxp = regexFromString(query, caseSensitive, false);
        urls = urls.filter(function(b) {
            return rxp.test(b.title) || rxp.test(b.url);
        });
    }
    return urls;
}

// `settings.localPath` set to this reads the snippets from ~/.surfingkeys.js through
// the native app instead of fetching a URL. Shared because the options page must
// pass it to the background untouched, while it rewrites every other value into a
// URL.
const NATIVE_LOCAL_PATH = "<native>";

// The name every native message is addressed to. On Chrome and Firefox it must equal
// the "name" in the host manifest (src/nvim/server/Readme.md); Safari ignores it and
// routes to its containing app, so a wrong name is only noticed off Safari.
const NATIVE_HOST_NAME = "surfingkeys";

// A fingerprint of the settings snippet (FNV-1a and the length). A page reports an
// error in the snippet with it, and the background shows that error only while the
// saved snippet has the same one: a tab still running an older snippet must not
// report an error the user has already fixed.
function snippetsRevision(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    }
    return (h >>> 0).toString(36) + "." + text.length;
}

export {
    LOG,
    NATIVE_HOST_NAME,
    NATIVE_LOCAL_PATH,
    filterByTitleOrUrl,
    regexFromString,
    snippetsRevision,
}
