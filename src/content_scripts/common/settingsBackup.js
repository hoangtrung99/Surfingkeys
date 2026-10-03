// The settings backup file: what an export holds, how an import is read, and what
// an import would change. Pure: the Backup section of the settings page does the
// reading, writing and asking.
//
// A file is
//   {format: 'surfingkeys-settings', version: 1, exportedAt, extensionVersion, settings}
// and an import also takes what `yj` copies (the raw stored settings), as version 0.

export const BACKUP_FORMAT = 'surfingkeys-settings';
export const BACKUP_VERSION = 1;

// The stored keys a backup carries, and what each must hold. Only these are ever
// written back by an import: a file names what it holds, so a key outside this
// list would be any storage entry the file's author chose, including the ones kept
// out of exports below.
const SETTINGS_TYPES = {
    snippets: 'string',
    localPath: 'string',
    showAdvanced: 'boolean',
    basicMappings: 'mappings',
    disabledSearchAliases: 'object',
    blocklist: 'object',
    mouseSelectToQuery: 'strings',
    noPdfViewer: 'boolean',
    proxyMode: 'proxyMode',
    proxy: 'stringOrStrings',
    autoproxy_hosts: 'hostLists',
    paletteTheme: 'stringOrNull',
};
// only with "Include marks and saved sessions" (owner decision D3)
const DATA_TYPES = {
    marks: 'object',
    sessions: 'object',
};
export const SETTINGS_KEYS = Object.keys(SETTINGS_TYPES);
export const DATA_KEYS = Object.keys(DATA_TYPES);
// the modes the background sets the browser's proxy by (background/chrome.js
// _applyProxySettings, which writes the mode into the PAC script it builds)
export const PROXY_MODES = ['always', 'byhost', 'bypass', 'clear', 'direct', 'system'];
// Never exported and never imported: the credentials earlier versions stored for
// their AI chat (_llmProviderConfig can hold Bedrock keys, and is still in storage
// wherever it was written), the find and command histories (D3), and bookkeeping.
export const NEVER_KEYS = ['_llmProviderConfig', 'findHistory', 'cmdHistory', 'lastKeys', 'savedAt', 'logLevels'];

const TYPE_NAMES = {
    string: 'text',
    boolean: 'true or false',
    object: 'an object',
    mappings: 'an object of keys',
    strings: 'a list of text',
    stringOrStrings: 'text or a list of text',
    stringOrNull: 'text',
    hostLists: 'a list of host lists',
    proxyMode: `one of ${PROXY_MODES.join(', ')}`,
};

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function hasType(value, type) {
    switch (type) {
    case 'string':
        return typeof value === 'string';
    case 'boolean':
        return typeof value === 'boolean';
    case 'object':
        return isPlainObject(value);
    case 'mappings':
        return isPlainObject(value) && Object.keys(value).every((k) => typeof value[k] === 'string');
    case 'strings':
        return Array.isArray(value) && value.every((v) => typeof v === 'string');
    case 'stringOrStrings':
        return typeof value === 'string' || (Array.isArray(value) && value.every((v) => typeof v === 'string'));
    case 'hostLists':
        // one list of hosts per proxy; older builds stored one list, or one host
        // (proxyPair() checks which, against `proxy`)
        return typeof value === 'string' || (Array.isArray(value)
            && value.every((v) => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'))));
    case 'proxyMode':
        return PROXY_MODES.indexOf(value) !== -1;
    case 'stringOrNull':
        return value === null || typeof value === 'string';
    }
    return false;
}

function pick(raw, keys) {
    const out = {};
    keys.forEach((k) => {
        if (raw && Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== undefined) {
            out[k] = raw[k];
        }
    });
    return out;
}

/*
 * `proxy` and `autoproxy_hosts` in the shape this build stores: a list of proxies,
 * with a list of hosts for each. The background maps over every host list as a
 * list, when it applies the proxy at its start, so a shape that does not match
 * would throw there. Older builds stored one proxy with one list (or one host).
 */
function proxyPair(settings) {
    const hasProxy = settings.hasOwnProperty('proxy'), hasHosts = settings.hasOwnProperty('autoproxy_hosts');
    if (!hasProxy && !hasHosts) {
        return;
    }
    if (!hasProxy || !hasHosts) {
        throw new Error('This settings file has only one of “proxy” and “autoproxy_hosts”, which go together.');
    }
    const {proxy, autoproxy_hosts: hosts} = settings;
    if (typeof proxy === 'string') {
        if (typeof hosts === 'string') {
            settings.autoproxy_hosts = [[hosts]];
        } else if (hosts.every((v) => typeof v === 'string')) {
            settings.autoproxy_hosts = [hosts];
        } else {
            throw new Error('This settings file\'s “autoproxy_hosts” is not one list of hosts for its one “proxy”.');
        }
        settings.proxy = [proxy];
    } else if (typeof hosts === 'string' || !hosts.every((v) => Array.isArray(v))) {
        throw new Error('This settings file\'s “autoproxy_hosts” is not a list of hosts for each “proxy”.');
    }
}

/*
 * The file an export writes, from the raw stored settings (getSettings 'RAW').
 * `includeData` adds marks and sessions. `exportedAt` (an ISO string) and
 * `extensionVersion` are passed in so the result depends on nothing but its input.
 */
export function buildExport(raw, {includeData = false, exportedAt = '', extensionVersion = ''} = {}) {
    return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt,
        extensionVersion,
        settings: pick(raw, includeData ? SETTINGS_KEYS.concat(DATA_KEYS) : SETTINGS_KEYS),
    };
}

// surfingkeys-settings-2026-09-29.json, in the local date
export function exportFileName(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `surfingkeys-settings-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/*
 * Reads the text of a backup file. Returns
 *   {version, exportedAt, extensionVersion, settings, ignored}
 * where `settings` holds only the keys a backup carries, each checked for its
 * type (the proxy in the shape this build stores), and `ignored` names every other key the file had. Throws an Error whose
 * message can be shown as it is.
 */
export function parseImport(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error('This file is not a Surfingkeys settings file: it is not JSON.');
    }
    if (!isPlainObject(data)) {
        throw new Error('This file is not a Surfingkeys settings file.');
    }
    let version = 0, exportedAt = '', extensionVersion = '', source = data;
    if (Object.prototype.hasOwnProperty.call(data, 'format')) {
        if (data.format !== BACKUP_FORMAT) {
            throw new Error('This file is not a Surfingkeys settings file.');
        }
        if (!Number.isInteger(data.version) || data.version < 1) {
            throw new Error('This settings file has no valid version.');
        }
        if (data.version > BACKUP_VERSION) {
            throw new Error(`This settings file was made by a newer Surfingkeys (file version ${data.version}); update Surfingkeys to import it.`);
        }
        if (!isPlainObject(data.settings)) {
            throw new Error('This settings file holds no settings.');
        }
        version = data.version;
        exportedAt = typeof data.exportedAt === 'string' ? data.exportedAt : '';
        extensionVersion = typeof data.extensionVersion === 'string' ? data.extensionVersion : '';
        source = data.settings;
    }
    const types = Object.assign({}, SETTINGS_TYPES, DATA_TYPES);
    const keys = Object.keys(source);
    // what yj copies always has some of these; anything with none is not settings
    if (version === 0 && !keys.some((k) => types.hasOwnProperty(k) || NEVER_KEYS.indexOf(k) !== -1)) {
        throw new Error('This file is not a Surfingkeys settings file.');
    }
    const settings = {}, ignored = [];
    keys.forEach((k) => {
        if (!types.hasOwnProperty(k)) {
            ignored.push(k);
        } else if (!hasType(source[k], types[k])) {
            throw new Error(`This settings file's “${k}” is not ${TYPE_NAMES[types[k]]}.`);
        } else {
            settings[k] = source[k];
        }
    });
    proxyPair(settings);
    return {version, exportedAt, extensionVersion, settings, ignored};
}

// Key order aside, so {a, b} and {b, a} compare equal.
function canonical(value) {
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(',')}]`;
    }
    if (isPlainObject(value)) {
        return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
}

// Stored and missing mean the same to Surfingkeys for these: {} / [] / '' / false / null.
function isEmpty(value) {
    return value === undefined || value === null || value === '' || value === false
        || (Array.isArray(value) && value.length === 0)
        || (isPlainObject(value) && Object.keys(value).length === 0);
}

/*
 * What importing `incoming` (parseImport's settings) over `current` (the raw
 * stored settings) would do, as key lists:
 *   added    the file sets a key that is empty now
 *   changed  the file sets a key to another value, emptying it included
 *   removed  a key set now that the file does not have: an import leaves it as it is
 */
export function diffSettings(current, incoming) {
    const out = {added: [], changed: [], removed: []};
    SETTINGS_KEYS.concat(DATA_KEYS).forEach((k) => {
        const has = incoming && Object.prototype.hasOwnProperty.call(incoming, k);
        const now = current ? current[k] : undefined;
        if (!has) {
            if (!isEmpty(now)) {
                out.removed.push(k);
            }
        } else if (isEmpty(now)) {
            if (!isEmpty(incoming[k])) {
                out.added.push(k);
            }
        } else if (canonical(now) !== canonical(incoming[k])) {
            out.changed.push(k);
        }
    });
    return out;
}

// A snippet that looks like it holds a credential, which an export would copy into the file.
export function mentionsSecret(snippets) {
    return typeof snippets === 'string' && /secret|api[_-]?key|token|password/i.test(snippets);
}
