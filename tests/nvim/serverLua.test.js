/**
 * @jest-environment node
 */
// The native messaging host (src/nvim/server/server.lua) run for real, when nvim is
// installed (skipped otherwise). Mostly this process plays the browser that started
// it, so the host's parent is this pid, and a fake data directory's SingletonLock names
// it. Covers the profile commands' refusals, the browser launch through the PARENT's
// executable (here node, which rejects the browser's switches -- its exit code must
// come back as a clean error reply), and that stdout carries nothing but replies.
// Where a C compiler is at hand, a compiled stand-in for the browser is the parent
// instead, so the launched "browser" can exit as Chromium does on a hand-off.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const SERVER_LUA = path.resolve(__dirname, '../../src/nvim/server/server.lua');
const URL = 'chrome-extension://aajlcoiaogpknhgninhopncaldipjdnp/pages/newtab.html?focus';
const hasNvim = process.platform !== 'win32' && spawnSync('nvim', ['--version']).status === 0;
const describeWithNvim = hasNvim ? describe : describe.skip;
const hasCC = hasNvim && spawnSync('cc', ['--version']).status === 0;
const NVIM = ['nvim', '--headless', '-u', 'NONE', '-i', 'NONE', '-c', `luafile ${SERVER_LUA.replace(/ /g, '\\ ')}`];

const LOCAL_STATE = {
    profile: {
        info_cache: {
            'Default': { name: 'Person 1', gaia_name: '', user_name: '' },
            'Profile 1': { name: 'Work', gaia_name: 'Ann Example', user_name: 'ann@example.com' },
            'Profile 2': { name: 'Deleted one' },
            'Profile 3': { name: 'beta' },
            'Profile 4': { name: 'Alpha', user_name: null },
        },
        profiles_order: ['Profile 1', 'Default', 'Profile 2'],
    },
    profiles: { profile_basenames_deleted: ['/elsewhere/Profile 2'] },
    // an empty key, which vim.fn.json_decode cannot return as a plain table
    odd: { '': 1 },
};
const LISTED = [
    { dir: 'Profile 1', name: 'Ann Example (Work)', email: 'ann@example.com' },
    { dir: 'Default', name: 'Person 1' },
    // missed by profiles_order, so after it, by name
    { dir: 'Profile 4', name: 'Alpha' },
    { dir: 'Profile 3', name: 'beta' },
];

function lock(dir, pid) {
    const file = path.join(dir, 'SingletonLock');
    fs.rmSync(file, { force: true });
    fs.symlinkSync(`${os.hostname()}-${pid}`, file);
}

// A data directory as the browser holding it leaves it: Local State, the profile
// folders, a SingletonLock naming `pid`, and a SingletonSocket leading to `socket`.
function makeUdd(udd, pid, socket) {
    ['Default', 'Profile 1', 'Profile 3', 'Profile 4'].forEach((p) => fs.mkdirSync(path.join(udd, p), { recursive: true }));
    fs.writeFileSync(path.join(udd, 'Local State'), JSON.stringify(LOCAL_STATE));
    lock(udd, pid);
    fs.symlinkSync(socket, path.join(udd, 'SingletonSocket'));
}

// A unix socket listening at `file`, as the browser's SingletonSocket leads to.
function listenOn(file) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.on('error', reject);
        server.listen(file, () => resolve(server));
    });
}

// XDG_RUNTIME_DIR is where the hosts of one browser meet (server.lua's peer_dir_for):
// each test's own, so no host of a test makes anything in the real one or in /tmp.
function envFor(root, home, extra) {
    fs.mkdirSync(path.join(root, 'run'), { recursive: true });
    const env = Object.assign({}, process.env, {
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_STATE_HOME: path.join(root, 'state'),
        XDG_DATA_HOME: path.join(root, 'data'),
        XDG_CACHE_HOME: path.join(root, 'cache'),
        XDG_RUNTIME_DIR: path.join(root, 'run'),
    }, extra);
    delete env.CHROME_USER_DATA_DIR;
    if (!(extra && extra.CHROME_CONFIG_HOME)) {
        delete env.CHROME_CONFIG_HOME;
    }
    return env;
}

// nvim running server.lua, as the child of `cmd` (this process when empty), and the
// replies it writes, frame by frame. A frame with `peer` set is the host's own request
// to its extension, handed to `host.onRequest` (once each) -- this process plays that
// extension too, answering with `host.answer`.
function startHost(cmd, env) {
    let raw = Buffer.alloc(0);
    let waiters = [];
    let nextId = 1;
    let requestsSeen = 0;
    const argv = cmd.concat(NVIM);
    const proc = spawn(argv[0], argv.slice(1), { env, stdio: ['pipe', 'pipe', 'pipe'] });

    // Every complete frame so far, and the bytes after them that are not one.
    function frames() {
        const out = [];
        let pos = 0;
        while (pos + 4 <= raw.length) {
            const len = raw.readUInt32LE(pos);
            if (pos + 4 + len > raw.length) {
                break;
            }
            out.push(raw.subarray(pos + 4, pos + 4 + len).toString('utf8'));
            pos += 4 + len;
        }
        return { out, rest: raw.subarray(pos) };
    }

    function settle() {
        const replies = frames().out.map((text) => JSON.parse(text));
        const requests = replies.filter((r) => r.peer !== undefined);
        requests.slice(requestsSeen).forEach((r) => host.onRequest(r));
        requestsSeen = requests.length;
        waiters = waiters.filter(({ id, resolve }) => {
            const reply = replies.find((r) => r.id === id);
            if (reply) {
                resolve(reply);
            }
            return !reply;
        });
    }

    function write(message) {
        const data = Buffer.from(JSON.stringify(message));
        const header = Buffer.alloc(4);
        header.writeUInt32LE(data.length);
        proc.stdin.write(Buffer.concat([header, data]));
    }

    function send(message) {
        const id = nextId++;
        write(Object.assign({ id }, message));
        return new Promise((resolve) => {
            waiters.push({ id, resolve });
            settle();
        });
    }

    proc.stdout.on('data', (chunk) => {
        raw = Buffer.concat([raw, chunk]);
        settle();
    });
    const exited = new Promise((resolve) => proc.on('exit', (code) => resolve(code)));
    const host = {
        proc,
        send,
        frames,
        exited,
        onRequest: () => {},
        answer: (request, status, res) => write({ peerReply: request.peer, status, res }),
    };
    return host;
}

function stopHost(host) {
    if (host && host.proc.exitCode === null) {
        host.proc.kill();
    }
}

describeWithNvim('server.lua in nvim', () => {
    let root, base, udd, host, server;

    beforeAll(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-server-lua-'));
        const home = path.join(root, 'home');
        base = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : path.join(home, '.config');
        udd = path.join(base, 'TestBrowser');
        server = await listenOn(path.join(root, 'sock'));
        makeUdd(udd, process.pid, path.join(root, 'sock'));
        // another browser, running as some other process
        const other = path.join(base, 'Vendor', 'Other');
        fs.mkdirSync(other, { recursive: true });
        fs.writeFileSync(path.join(other, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Not mine' } } } }));
        lock(other, process.pid + 100000);
        fs.writeFileSync(path.join(home, '.surfingkeys.js'), 'settings.smoothScroll = false;\n');
        host = startHost([], envFor(root, home));
    });

    afterAll(async () => {
        stopHost(host);
        server && server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('Profile.list: Local State in the order of the profile menu, deleted ones out', async () => {
        const reply = await host.send({ command: 'Profile.list' });
        expect(reply).toEqual({ status: true, id: expect.any(Number), res: { data: LISTED } });
    });

    test('Settings.read still answers', async () => {
        const reply = await host.send({ command: 'Settings.read' });
        expect(reply.res).toEqual({ data: 'settings.smoothScroll = false;\n' });
    });

    test.each([
        ['a profile Local State does not list', { profile: 'Profile 9', url: URL }, 'no profile "Profile 9"'],
        ['a profile being deleted', { profile: 'Profile 2', url: URL }, 'no profile "Profile 2"'],
        ['a page that is not the extension\'s', { profile: 'Default', url: 'https://example.com/' }, 'chrome-extension://'],
    ])('Profile.open refuses %s', async (name, args, said) => {
        const reply = await host.send(Object.assign({ command: 'Profile.open' }, args));
        expect(reply.status).toBe(true);
        expect(reply.res.error).toContain(said);
    });

    test('Profile.open starts the parent executable and reports its exit code, not that it started', async () => {
        const reply = await host.send({ command: 'Profile.open', profile: 'Default', url: URL });
        expect(reply.status).toBe(true);
        // node refuses the browser's switches, and says so on stderr
        expect(reply.res.error).toMatch(/exit code (?!0\b|24\b)\d+/);
        expect(reply.res.error).toContain('--user-data-dir');
        // the stream is still in step after it
        expect((await host.send({ command: 'Settings.read' })).res.data).toContain('smoothScroll');
    }, 20000);

    test('a SingletonLock naming another process: nothing is listed or launched', async () => {
        lock(udd, process.pid + 1);
        try {
            const list = await host.send({ command: 'Profile.list' });
            expect(list.res.error).toContain('found no browser data directory');
            const open = await host.send({ command: 'Profile.open', profile: 'Default', url: URL });
            expect(open.res.error).toContain('found no browser data directory');
        } finally {
            lock(udd, process.pid);
        }
    });

    // A crash leaves the lock behind, and its pid comes round again after a reboot,
    // which empties the folder the socket was in.
    test('a stale SingletonLock naming the browser, its socket gone, is not taken for its directory', async () => {
        const stale = path.join(base, 'Stale');
        fs.mkdirSync(stale, { recursive: true });
        fs.writeFileSync(path.join(stale, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Not mine' } } } }));
        lock(stale, process.pid);
        fs.symlinkSync(path.join(root, 'gone', 'SingletonSocket'), path.join(stale, 'SingletonSocket'));
        try {
            const reply = await host.send({ command: 'Profile.list' });
            expect(reply.res).toEqual({ data: LISTED });
        } finally {
            fs.rmSync(stale, { recursive: true, force: true });
        }
    });

    test('an unknown command still answers with no res, as old extensions expect', async () => {
        const reply = await host.send({ command: 'Nope.nothing' });
        expect(reply).toEqual({ status: true, id: expect.any(Number) });
    });

    test('stdout holds nothing but replies, and the host exits when the browser goes', async () => {
        const { out, rest } = host.frames();
        expect(rest.length).toBe(0);
        out.forEach((text) => expect(() => JSON.parse(text)).not.toThrow());
        host.proc.stdin.end();
        expect(await host.exited).toBe(0);
    });
});

// Chromium on Linux puts its default directory under $CHROME_CONFIG_HOME when that is
// set, and the host inherits the browser's environment.
(hasNvim && process.platform === 'linux' ? describe : describe.skip)('server.lua with $CHROME_CONFIG_HOME', () => {
    let root, host, server;

    beforeAll(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-server-lua-cch-'));
        const home = path.join(root, 'home');
        fs.mkdirSync(path.join(home, '.config'), { recursive: true });
        server = await listenOn(path.join(root, 'sock'));
        makeUdd(path.join(root, 'cfg', 'chromium'), process.pid, path.join(root, 'sock'));
        host = startHost([], envFor(root, home, { CHROME_CONFIG_HOME: path.join(root, 'cfg') }));
    });

    afterAll(() => {
        stopHost(host);
        server && server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('finds the data directory there', async () => {
        const reply = await host.send({ command: 'Profile.list' });
        expect(reply.res).toEqual({ data: LISTED });
    });
});

// The stand-in browser. As nvim's parent it runs nvim as its child, as the browser
// does. As the browser the host launches (with --profile-directory) it logs its argv to
// $FAKE_LOG, prints what Chromium prints on a hand-off, and exits with the code in
// $FAKE_EXIT_FILE -- or, for the profile in $FAKE_SLOW_PROFILE, waits a minute first.
const FAKE_BROWSER_C = String.raw`
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/wait.h>

int main(int argc, char **argv) {
    const char *profile = NULL;
    for (int i = 1; i < argc; i++) {
        if (strncmp(argv[i], "--profile-directory=", 20) == 0) profile = argv[i] + 20;
    }
    if (profile) {
        const char *log = getenv("FAKE_LOG");
        FILE *f = log ? fopen(log, "a") : NULL;
        if (f) {
            for (int i = 0; i < argc; i++) fprintf(f, "%s%s", argv[i], i + 1 < argc ? "\x1f" : "\n");
            fclose(f);
        }
        printf("Opening in existing browser session.\n");
        fflush(stdout);
        const char *slow = getenv("FAKE_SLOW_PROFILE");
        if (slow && strcmp(slow, profile) == 0) sleep(60);
        int code = 0;
        const char *exit_file = getenv("FAKE_EXIT_FILE");
        f = exit_file ? fopen(exit_file, "r") : NULL;
        if (f) {
            if (fscanf(f, "%d", &code) != 1) code = 0;
            fclose(f);
        }
        return code;
    }
    if (argc < 2) return 64;
    pid_t pid = fork();
    if (pid == 0) {
        execvp(argv[1], argv + 1);
        _exit(127);
    }
    int status = 0;
    waitpid(pid, &status, 0);
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
`;

(hasCC ? describe : describe.skip)('server.lua under a browser that hands over', () => {
    let root, fake, udd, host, server, exitFile, log, slow, slowSent;

    const launches = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => line.split('\x1f'));
    const exitWith = (code) => fs.writeFileSync(exitFile, String(code));

    beforeAll(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-server-lua-fake-'));
        fake = path.join(root, 'fakebrowser');
        fs.writeFileSync(`${fake}.c`, FAKE_BROWSER_C);
        const built = spawnSync('cc', ['-o', fake, `${fake}.c`]);
        if (built.status !== 0) {
            throw new Error(`could not build the stand-in browser: ${built.stderr}`);
        }
        const home = path.join(root, 'home');
        const config = path.join(home, '.config');
        exitFile = path.join(root, 'exit');
        log = path.join(root, 'launches.log');
        exitWith(0);
        fs.writeFileSync(log, '');
        host = startHost([fake], envFor(root, home,
            { FAKE_EXIT_FILE: exitFile, FAKE_LOG: log, FAKE_SLOW_PROFILE: 'Profile 4' }));
        // the lock names the stand-in, whose pid is known only now
        server = await listenOn(path.join(root, 'sock'));
        // two levels down, as Google/Chrome is ...
        udd = path.join(config, 'Vendor', 'Browser');
        makeUdd(udd, host.proc.pid, path.join(root, 'sock'));
        // ... and a level above it, the lock a crash left, naming the same pid by chance
        const stale = path.join(config, 'Stale');
        fs.mkdirSync(path.join(stale, 'Default'), { recursive: true });
        fs.writeFileSync(path.join(stale, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Not mine' } } } }));
        lock(stale, host.proc.pid);
        fs.symlinkSync(path.join(root, 'gone', 'SingletonSocket'), path.join(stale, 'SingletonSocket'));
        // a browser that does not answer: waited on while the other tests run
        slowSent = Date.now();
        slow = host.send({ command: 'Profile.open', profile: 'Profile 4', url: URL });
    });

    afterAll(async () => {
        if (host && host.proc.exitCode === null) {
            host.proc.stdin.end();
            await Promise.race([host.exited, new Promise((r) => setTimeout(r, 3000).unref())]);
        }
        stopHost(host);
        server && server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('lists the directory whose lock and socket are the browser\'s, not a stale lock nearer the top', async () => {
        const reply = await host.send({ command: 'Profile.list' });
        expect(reply.res).toEqual({ data: LISTED });
    });

    // ChromeMain turns PROCESS_NOTIFIED (24) into 0 on the way out
    test('exit code 0, what a browser that handed the request over exits with, is a switch done', async () => {
        exitWith(0);
        const reply = await host.send({ command: 'Profile.open', profile: 'Profile 1', url: URL });
        expect(reply.res).toEqual({ data: { dir: 'Profile 1' } });
        expect(launches().pop()).toEqual([fake, `--user-data-dir=${fs.realpathSync(udd)}`, '--profile-directory=Profile 1', URL]);
    });

    test('exit code 24, from a build that does not turn it into 0, is a switch done too', async () => {
        exitWith(24);
        const reply = await host.send({ command: 'Profile.open', profile: 'Default', url: URL });
        expect(reply.res).toEqual({ data: { dir: 'Default' } });
    });

    test('exit code 21 is a profile in use, with what the browser said', async () => {
        exitWith(21);
        const reply = await host.send({ command: 'Profile.open', profile: 'Default', url: URL });
        expect(reply.res.error).toContain('in use');
        expect(reply.res.error).toContain('Opening in existing browser session.');
    });

    test('a browser that does not confirm in 15 seconds: the outcome is said to be unknown, not a failure', async () => {
        const reply = await slow;
        expect(Date.now() - slowSent).toBeGreaterThanOrEqual(14500);
        expect(reply.res).toEqual({
            pending: true,
            error: 'the browser did not confirm it within 15 seconds; it may still open the profile once it responds',
        });
    }, 25000);

    test('the launcher printed to ITS stdout, and none of it reached the host\'s', () => {
        const { out, rest } = host.frames();
        expect(rest.length).toBe(0);
        out.forEach((text) => expect(() => JSON.parse(text)).not.toThrow());
    });
});

// Tabs of the browser's other profiles: one host per open profile, all children of the
// same browser (here this process), meeting through sockets in one private directory.
// This process plays each host's extension, answering what the host asks it.
const EXTENSION_ID = 'aajlcoiaogpknhgninhopncaldipjdnp';

// A profile's chrome.storage.local as the browser keeps it: a LevelDB whose .log holds
// each write as it was made, among other records.
function storeToken(udd, profile, token, file = '000003.log') {
    const store = path.join(udd, profile, 'Local Extension Settings', EXTENSION_ID);
    fs.mkdirSync(store, { recursive: true });
    fs.appendFileSync(path.join(store, file), Buffer.concat([
        Buffer.from([0x8a, 0x13, 0x00, 0x01, 0x01]),
        Buffer.from(`_profileToken"${token}"`),
        Buffer.from([0x00, 0xff]),
    ]));
}

// The same, but in a .log of more than one block, with the record holding the token cut
// by the block boundary. LevelDB writes its .log in 32 KiB blocks, and a record that
// does not fit in what is left of one goes on in the next after a 7-byte header of its
// own (checksum, length, type), which ends up in the middle of the token.
function storeSplitToken(udd, profile, token, file) {
    const BLOCK = 32768;
    const HEADER = 7;
    const chunks = [];
    let offset = 0;
    const append = (payload) => {
        let first = true;
        do {
            const fragment = payload.subarray(0, BLOCK - offset % BLOCK - HEADER);
            payload = payload.subarray(fragment.length);
            const header = Buffer.alloc(HEADER);
            header.writeUInt16LE(fragment.length, 4);
            // FULL, FIRST, MIDDLE, LAST
            header[6] = first ? (payload.length ? 2 : 1) : (payload.length ? 3 : 4);
            chunks.push(header, fragment);
            offset += HEADER + fragment.length;
            first = false;
        } while (payload.length);
    };
    const record = Buffer.concat([
        Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 13]),
        Buffer.from('_profileToken'),
        Buffer.from([34]),
        Buffer.from(`"${token}"`),
    ]);
    // earlier writes of the extension's storage, up to where half the token fits
    const before = BLOCK - token.length / 2 - record.indexOf(token) - 2 * HEADER;
    append(Buffer.alloc(before, 'x'));
    append(record);
    const log = Buffer.concat(chunks);
    expect(log.includes(token)).toBe(false);
    expect(log.subarray(BLOCK - token.length / 2, BLOCK).toString()).toBe(token.slice(0, token.length / 2));
    const store = path.join(udd, profile, 'Local Extension Settings', EXTENSION_ID);
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, file), log);
}

const randomToken = () => require('crypto').randomBytes(16).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TABS_B = [
    { id: 7, windowId: 3, title: 'Quarterly plan', url: 'https://docs.test/plan', favIconUrl: 'https://docs.test/icon.png' },
    { id: 9, windowId: 3, title: 'Inbox', url: 'https://mail.test/' },
];

// A host that died without removing its socket: the file is there, nothing listens.
function deadSocket(file) {
    const killed = spawnSync(process.execPath, ['-e',
        `require('net').createServer().listen(${JSON.stringify(file)}, () => process.kill(process.pid, 'SIGKILL'))`]);
    expect(killed.signal).toBe('SIGKILL');
    expect(fs.existsSync(file)).toBe(true);
}

(hasNvim ? describe : describe.skip)('server.lua: the tabs of the browser\'s other profiles', () => {
    let root, home, udd, server, env, meet, a, b, c, silent, many;

    beforeAll(async () => {
        // short: a socket's path must fit in 104 bytes
        root = fs.mkdtempSync('/tmp/skp-');
        home = path.join(root, 'home');
        udd = path.join(home, '.config', 'TestBrowser');
        server = await listenOn(path.join(root, 'sock'));
        makeUdd(udd, process.pid, path.join(root, 'sock'));
        env = envFor(root, home);
        const hash = require('crypto').createHash('sha256').update(fs.realpathSync(udd)).digest('hex').slice(0, 16);
        meet = path.join(fs.realpathSync(root), 'run', `surfingkeys-${process.getuid()}`, hash);
        a = startHost([], env);
        b = startHost([], env);
        // a host whose extension never identifies itself, as an older one would
        c = startHost([], env);
        b.onRequest = (request) => {
            if (request.command === 'Tabs.list' && !silent) {
                b.answer(request, true, { data: { tabs: many || TABS_B } });
            } else if (request.command === 'Tabs.activate') {
                // tab 8's switch is carried out after the host's 2.5 seconds
                setTimeout(() => {
                    b.answer(request, true, { data: { tabId: request.tabId, windowId: request.windowId, active: true, focused: true } });
                }, request.tabId === 8 ? 2700 : 0);
            }
        };
        const tokenA = randomToken();
        storeToken(udd, 'Default', tokenA);
        const identifiedA = await a.send({ command: 'Profile.identify', token: tokenA, extensionId: EXTENSION_ID });
        expect(identifiedA.res).toEqual({ data: { dir: 'Default', name: 'Person 1' } });
        // the write lands after the request: the host looks again
        const tokenB = randomToken();
        const identifiedB = b.send({ command: 'Profile.identify', token: tokenB, extensionId: EXTENSION_ID });
        await sleep(400);
        storeToken(udd, 'Profile 1', tokenB, '000005.ldb');
        expect((await identifiedB).res).toEqual({ data: { dir: 'Profile 1', name: 'Ann Example (Work)' } });
        // c listens from the start, unasked
        for (let i = 0; i < 50 && !fs.existsSync(path.join(meet, `${c.proc.pid}.sock`)); i++) {
            await sleep(100);
        }
    }, 20000);

    afterAll(async () => {
        [a, b, c].forEach(stopHost);
        server && server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('each host listens in a directory only this user can enter, named after the browser\'s data directory', () => {
        expect(fs.readdirSync(meet).sort()).toEqual([a, b, c].map((h) => `${h.proc.pid}.sock`).sort());
        [meet, path.dirname(meet)].forEach((dir) => {
            const st = fs.lstatSync(dir);
            expect(st.isDirectory()).toBe(true);
            expect(st.mode & 0o777).toBe(0o700);
        });
    });

    test('Peers.tabs: the other profiles\' tabs, each named, in the order of the profile menu', async () => {
        silent = false;
        const reply = await a.send({ command: 'Peers.tabs' });
        expect(reply.status).toBe(true);
        expect(reply.res.data.peers).toEqual([
            { peer: b.proc.pid, profile: { dir: 'Profile 1', name: 'Ann Example (Work)' }, tabs: TABS_B },
            { peer: c.proc.pid, profile: null, tabs: [], error: expect.stringContaining('not connected to its host yet') },
        ]);
    });

    test('a host asked by another asks its extension, and answers it alone: its stdout gets no reply to the peerReply', async () => {
        const before = b.frames().out.map((text) => JSON.parse(text));
        await a.send({ command: 'Peers.tabs' });
        const after = b.frames().out.map((text) => JSON.parse(text)).slice(before.length);
        expect(after).toEqual([{ peer: expect.any(Number), command: 'Tabs.list' }]);
        // c's extension never said it answers: it is asked nothing
        expect(c.frames().out.map((text) => JSON.parse(text)).filter((r) => r.peer !== undefined)).toEqual([]);
    });

    test('a socket nothing listens on is left out, and removed', async () => {
        const dead = path.join(meet, '99999999.sock');
        deadSocket(dead);
        const reply = await a.send({ command: 'Peers.tabs' });
        expect(reply.res.data.peers.map((p) => p.peer)).toEqual([b.proc.pid, c.proc.pid]);
        expect(fs.existsSync(dead)).toBe(false);
    });

    // macOS refuses a connection to a live host whose queue of them is full, too
    test('a refused socket named after a process still running is left out, but kept', async () => {
        const refused = path.join(meet, `${process.pid}.sock`);
        deadSocket(refused);
        try {
            const reply = await a.send({ command: 'Peers.tabs' });
            expect(reply.res.data.peers.map((p) => p.peer)).toEqual([b.proc.pid, c.proc.pid]);
            expect(fs.existsSync(refused)).toBe(true);
        } finally {
            fs.rmSync(refused, { force: true });
        }
    });

    test('a host that does not answer costs 1.5 seconds and its own entry, not the others\'', async () => {
        const mute = path.join(meet, '88888888.sock');
        const held = [];
        const hung = await listenOn(mute);
        hung.on('connection', (sock) => held.push(sock));
        try {
            const sent = Date.now();
            const reply = await a.send({ command: 'Peers.tabs' });
            const took = Date.now() - sent;
            expect(took).toBeGreaterThanOrEqual(1400);
            expect(took).toBeLessThan(3000);
            const peers = reply.res.data.peers;
            expect(peers.find((p) => p.peer === b.proc.pid).tabs).toEqual(TABS_B);
            expect(peers.find((p) => p.peer === 88888888)).toEqual({
                peer: 88888888, profile: null, tabs: [], error: 'that profile did not answer within 1.5 seconds',
            });
        } finally {
            held.forEach((sock) => sock.destroy());
            hung.close();
            fs.rmSync(mute, { force: true });
        }
    });

    test('so does a host whose extension does not answer', async () => {
        silent = true;
        try {
            const reply = await a.send({ command: 'Peers.tabs' });
            expect(reply.res.data.peers.find((p) => p.peer === b.proc.pid)).toEqual({
                peer: b.proc.pid, profile: null, tabs: [], error: 'that profile did not answer within 1.5 seconds',
            });
        } finally {
            silent = false;
        }
        // its late answer, when it comes, is dropped and the next list is whole again
        await sleep(1200);
        const again = await a.send({ command: 'Peers.tabs' });
        expect(again.res.data.peers[0].tabs).toEqual(TABS_B);
    });

    // Chrome drops a host that writes it a message over 1 MB, the editor's and every
    // settings read's connection with it
    test('a list too long for one native message loses its least recently used tabs, not the connection', async () => {
        many = Array.from({ length: 4000 }, (x, i) => ({
            id: i, windowId: 1, title: `Tab ${i}`, url: `https://many.test/${i}/${'p'.repeat(300)}`, favIconUrl: `https://many.test/${i}.ico`,
        }));
        try {
            const reply = await a.send({ command: 'Peers.tabs' });
            const { out } = a.frames();
            expect(Buffer.byteLength(out[out.length - 1])).toBeLessThanOrEqual(1024 * 1024);
            const tabs = reply.res.data.peers.find((p) => p.peer === b.proc.pid).tabs;
            expect(tabs.length).toBeGreaterThan(1000);
            expect(tabs.length).toBeLessThan(4000);
            expect(tabs[0]).toEqual({ id: 0, windowId: 1, title: 'Tab 0', url: many[0].url });
            expect(tabs.map((t) => t.id)).toEqual(many.slice(0, tabs.length).map((t) => t.id));
            // and the connection is in step after it
            expect((await a.send({ command: 'Settings.read' })).status).toBe(true);
        } finally {
            many = null;
        }
    });

    test('Peers.activate goes to that profile\'s extension and answers with what it observed', async () => {
        const reply = await a.send({ command: 'Peers.activate', peer: b.proc.pid, tabId: 7, windowId: 3 });
        expect(reply.res).toEqual({ data: { tabId: 7, windowId: 3, active: true, focused: true } });
        const asked = b.frames().out.map((text) => JSON.parse(text)).filter((r) => r.command === 'Tabs.activate');
        expect(asked.pop()).toEqual({ peer: expect.any(Number), command: 'Tabs.activate', tabId: 7, windowId: 3 });
    });

    // The other profile had the request by then, and may still switch: said as a failure,
    // that profile's window coming forward a moment later would contradict it.
    test('a switch the other profile does not confirm within 2.5 seconds is pending, not failed', async () => {
        const reply = await a.send({ command: 'Peers.activate', peer: b.proc.pid, tabId: 8, windowId: 3 });
        expect(reply.res).toEqual({
            pending: true,
            error: 'Surfingkeys in that profile did not confirm the switch within 2.5 seconds; it may still make it once it responds',
        });
        // its late answer is dropped, and the next switch is answered as usual
        await sleep(400);
        const next = await a.send({ command: 'Peers.activate', peer: b.proc.pid, tabId: 7, windowId: 3 });
        expect(next.res).toEqual({ data: { tabId: 7, windowId: 3, active: true, focused: true } });
    }, 10000);

    test('so is one whose host takes the request and does not answer within 3 seconds', async () => {
        const mute = path.join(meet, '88888888.sock');
        const held = [];
        const hung = await listenOn(mute);
        hung.on('connection', (sock) => held.push(sock));
        try {
            const reply = await a.send({ command: 'Peers.activate', peer: 88888888, tabId: 7, windowId: 3 });
            expect(reply.res).toEqual({
                pending: true,
                error: 'that profile did not answer within 3 seconds; it may still switch to the tab once it responds',
            });
        } finally {
            held.forEach((sock) => sock.destroy());
            hung.close();
            fs.rmSync(mute, { force: true });
        }
    }, 10000);

    test.each([
        ['a profile that is no longer open', { peer: 77777777, tabId: 7 }, 'that profile is no longer open'],
        ['a peer that is not a pid', { peer: '../../etc', tabId: 7 }, 'no profile was named'],
        ['no tab', { peer: 1234 }, 'no tab was named'],
    ])('Peers.activate refuses %s', async (name, args, said) => {
        const reply = await a.send(Object.assign({ command: 'Peers.activate' }, args));
        expect(reply.res).toEqual({ error: said });
    });

    // what a cleaner of temporary files does, or a user removing the folder
    test('a host whose socket is gone makes it again when next asked, the folder too', async () => {
        fs.rmSync(path.dirname(meet), { recursive: true });
        const reply = await a.send({ command: 'Peers.tabs' });
        expect(reply.res).toEqual({ data: { peers: [] } });
        expect(fs.readdirSync(meet)).toEqual([`${a.proc.pid}.sock`]);
        [meet, path.dirname(meet)].forEach((dir) => expect(fs.lstatSync(dir).mode & 0o777).toBe(0o700));
        // a switch needs the socket too
        await b.send({ command: 'Peers.activate', peer: 77777777, tabId: 7 });
        await c.send({ command: 'Peers.activate', peer: 77777777, tabId: 7 });
        expect(fs.readdirSync(meet).sort()).toEqual([a, b, c].map((h) => `${h.proc.pid}.sock`).sort());
        const again = await a.send({ command: 'Peers.tabs' });
        expect(again.res.data.peers.map((p) => p.peer)).toEqual([b.proc.pid, c.proc.pid]);
        expect(again.res.data.peers[0].tabs).toEqual(TABS_B);
    });

    test.each([
        ['a token no profile holds', () => ({ token: randomToken(), extensionId: EXTENSION_ID }), 'holds the token'],
        ['a token two profiles hold', () => {
            const token = randomToken();
            storeToken(udd, 'Profile 3', token);
            storeToken(udd, 'Profile 4', token);
            return { token, extensionId: EXTENSION_ID };
        }, 'more than one profile holds the token: '],
        ['an extension id that is a path', () => ({ token: randomToken(), extensionId: '../../../../../../etc/passwd' }), 'extension id'],
    ])('Profile.identify refuses %s', async (name, args, said) => {
        const reply = await c.send(Object.assign({ command: 'Profile.identify' }, args()));
        expect(reply.res.error).toContain(said);
    }, 10000);

    test('Profile.identify finds a token that a block boundary of the storage\'s log cuts in two', async () => {
        const token = randomToken();
        storeSplitToken(udd, 'Profile 3', token, '000009.log');
        const reply = await c.send({ command: 'Profile.identify', token, extensionId: EXTENSION_ID });
        expect(reply.res).toEqual({ data: { dir: 'Profile 3', name: 'beta' } });
    }, 10000);

    test('stdout holds nothing but frames, and a host that exits removes its socket', async () => {
        [a, b, c].forEach((host) => {
            const { out, rest } = host.frames();
            expect(rest.length).toBe(0);
            out.forEach((text) => expect(() => JSON.parse(text)).not.toThrow());
        });
        b.proc.stdin.end();
        expect(await b.exited).toBe(0);
        expect(fs.existsSync(path.join(meet, `${b.proc.pid}.sock`))).toBe(false);
        const reply = await a.send({ command: 'Peers.tabs' });
        expect(reply.res.data.peers.map((p) => p.peer)).toEqual([c.proc.pid]);
    });
});

// A meeting directory other users can enter, which a host refuses, and which the user
// then removes as the Readme says. Set up before every other test of this file, since a
// host tries to listen again only every 30 seconds: they pass while the others run.
const refused = {};
if (hasNvim) {
    beforeAll(async () => {
        refused.root = fs.mkdtempSync('/tmp/skp-');
        const home = path.join(refused.root, 'home');
        refused.udd = path.join(home, '.config', 'TestBrowser');
        refused.server = await listenOn(path.join(refused.root, 'sock'));
        makeUdd(refused.udd, process.pid, path.join(refused.root, 'sock'));
        const env = envFor(refused.root, home);
        refused.folder = path.join(refused.root, 'run', `surfingkeys-${process.getuid()}`);
        fs.mkdirSync(refused.folder, { mode: 0o755 });
        fs.chmodSync(refused.folder, 0o755);
        const hash = require('crypto').createHash('sha256').update(fs.realpathSync(refused.udd)).digest('hex').slice(0, 16);
        refused.meet = path.join(fs.realpathSync(refused.folder), hash);
        refused.host = startHost([], env);
        refused.started = Date.now();
        // its extension, asked to identify itself again
        refused.asked = [];
        refused.host.onRequest = (request) => {
            refused.asked.push({ command: request.command, after: Date.now() - refused.started });
            refused.host.answer(request, true, { data: true });
        };
        const token = randomToken();
        storeToken(refused.udd, 'Default', token);
        refused.identified = await refused.host.send({ command: 'Profile.identify', token, extensionId: EXTENSION_ID });
        refused.listed = await refused.host.send({ command: 'Peers.tabs' });
        refused.left = fs.readdirSync(refused.folder);
        // what the Readme says fixes it
        fs.rmSync(refused.folder, { recursive: true });
    });
    afterAll(() => {
        stopHost(refused.host);
        refused.server && refused.server.close();
        refused.root && fs.rmSync(refused.root, { recursive: true, force: true });
    });
}

(hasNvim ? describe : describe.skip)('server.lua: a meeting directory other users can enter', () => {
    test('is not used: Peers.tabs says why, and the directory is left as it was', () => {
        expect(refused.listed.res.error).toContain('must have mode 0700');
        expect(refused.identified.res.error).toContain('must have mode 0700');
        expect(refused.left).toEqual([]);
    });

    test('removed, it is made again: the host listens within 30 seconds, unasked, and has itself named', async () => {
        const socket = path.join(refused.meet, `${refused.host.proc.pid}.sock`);
        while (!fs.existsSync(socket) && Date.now() - refused.started < 40000) {
            await sleep(200);
        }
        expect(fs.existsSync(socket)).toBe(true);
        [refused.meet, path.dirname(refused.meet)].forEach((dir) => expect(fs.lstatSync(dir).mode & 0o777).toBe(0o700));
        // the first try is 30 seconds after the host started
        while (!refused.asked.length && Date.now() - refused.started < 41000) {
            await sleep(100);
        }
        expect(refused.asked).toEqual([{ command: 'Profile.identify', after: expect.any(Number) }]);
        expect(refused.asked[0].after).toBeGreaterThanOrEqual(29000);
        // what the extension does when asked: a new token
        const token = randomToken();
        storeToken(refused.udd, 'Default', token);
        const reply = await refused.host.send({ command: 'Profile.identify', token, extensionId: EXTENSION_ID });
        expect(reply.res).toEqual({ data: { dir: 'Default', name: 'Person 1' } });
    }, 45000);
});
