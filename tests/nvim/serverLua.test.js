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

function envFor(root, home, extra) {
    const env = Object.assign({}, process.env, {
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_STATE_HOME: path.join(root, 'state'),
        XDG_DATA_HOME: path.join(root, 'data'),
        XDG_CACHE_HOME: path.join(root, 'cache'),
    }, extra);
    delete env.CHROME_USER_DATA_DIR;
    if (!(extra && extra.CHROME_CONFIG_HOME)) {
        delete env.CHROME_CONFIG_HOME;
    }
    return env;
}

// nvim running server.lua, as the child of `cmd` (this process when empty), and the
// replies it writes, frame by frame.
function startHost(cmd, env) {
    let raw = Buffer.alloc(0);
    let waiters = [];
    let nextId = 1;
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
        waiters = waiters.filter(({ id, resolve }) => {
            const reply = replies.find((r) => r.id === id);
            if (reply) {
                resolve(reply);
            }
            return !reply;
        });
    }

    function send(message) {
        const id = nextId++;
        const data = Buffer.from(JSON.stringify(Object.assign({ id }, message)));
        const header = Buffer.alloc(4);
        header.writeUInt32LE(data.length);
        proc.stdin.write(Buffer.concat([header, data]));
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
    return { proc, send, frames, exited };
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
