/**
 * @jest-environment node
 */
// The native messaging host (src/nvim/server/server.lua) run for real, when nvim is
// installed (skipped otherwise): this process plays the browser that started it, so
// the host's parent is this pid, and a fake data directory's SingletonLock names it.
// Covers the profile commands' refusals, the browser launch through the PARENT's
// executable (here node, which rejects the browser's switches -- its exit code must
// come back as a clean error reply), and that stdout carries nothing but replies.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER_LUA = path.resolve(__dirname, '../../src/nvim/server/server.lua');
const URL = 'chrome-extension://aajlcoiaogpknhgninhopncaldipjdnp/pages/newtab.html?focus';
const hasNvim = process.platform !== 'win32' && spawnSync('nvim', ['--version']).status === 0;
const describeWithNvim = hasNvim ? describe : describe.skip;

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

describeWithNvim('server.lua in nvim', () => {
    let root, udd, host, raw, waiters, nextId, exited;

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
        host.stdin.write(Buffer.concat([header, data]));
        return new Promise((resolve) => {
            waiters.push({ id, resolve });
            settle();
        });
    }

    function lock(dir, pid) {
        const file = path.join(dir, 'SingletonLock');
        fs.rmSync(file, { force: true });
        fs.symlinkSync(`${os.hostname()}-${pid}`, file);
    }

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-server-lua-'));
        const home = path.join(root, 'home');
        const config = path.join(home, '.config');
        const base = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : config;
        udd = path.join(base, 'TestBrowser');
        ['Default', 'Profile 1', 'Profile 3', 'Profile 4'].forEach((p) => fs.mkdirSync(path.join(udd, p), { recursive: true }));
        fs.writeFileSync(path.join(udd, 'Local State'), JSON.stringify(LOCAL_STATE));
        lock(udd, process.pid);
        // another browser, running as some other process
        const other = path.join(base, 'Vendor', 'Other');
        fs.mkdirSync(other, { recursive: true });
        fs.writeFileSync(path.join(other, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Not mine' } } } }));
        lock(other, process.pid + 100000);
        fs.writeFileSync(path.join(home, '.surfingkeys.js'), 'settings.smoothScroll = false;\n');

        const env = Object.assign({}, process.env, {
            HOME: home,
            XDG_CONFIG_HOME: config,
            XDG_STATE_HOME: path.join(root, 'state'),
            XDG_DATA_HOME: path.join(root, 'data'),
            XDG_CACHE_HOME: path.join(root, 'cache'),
        });
        delete env.CHROME_USER_DATA_DIR;
        raw = Buffer.alloc(0);
        waiters = [];
        nextId = 1;
        host = spawn('nvim', ['--headless', '-u', 'NONE', '-i', 'NONE', '-c', `luafile ${SERVER_LUA.replace(/ /g, '\\ ')}`],
            { env, stdio: ['pipe', 'pipe', 'pipe'] });
        host.stdout.on('data', (chunk) => {
            raw = Buffer.concat([raw, chunk]);
            settle();
        });
        exited = new Promise((resolve) => host.on('exit', (code) => resolve(code)));
    });

    afterAll(async () => {
        if (host && host.exitCode === null) {
            host.kill();
        }
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('Profile.list: Local State in the order of the profile menu, deleted ones out', async () => {
        const reply = await send({ command: 'Profile.list' });
        expect(reply).toEqual({ status: true, id: expect.any(Number), res: { data: [
            { dir: 'Profile 1', name: 'Ann Example (Work)', email: 'ann@example.com' },
            { dir: 'Default', name: 'Person 1' },
            // missed by profiles_order, so after it, by name
            { dir: 'Profile 4', name: 'Alpha' },
            { dir: 'Profile 3', name: 'beta' },
        ] } });
    });

    test('Settings.read still answers', async () => {
        const reply = await send({ command: 'Settings.read' });
        expect(reply.res).toEqual({ data: 'settings.smoothScroll = false;\n' });
    });

    test.each([
        ['a profile Local State does not list', { profile: 'Profile 9', url: URL }, 'no profile "Profile 9"'],
        ['a profile being deleted', { profile: 'Profile 2', url: URL }, 'no profile "Profile 2"'],
        ['a page that is not the extension\'s', { profile: 'Default', url: 'https://example.com/' }, 'chrome-extension://'],
    ])('Profile.open refuses %s', async (name, args, said) => {
        const reply = await send(Object.assign({ command: 'Profile.open' }, args));
        expect(reply.status).toBe(true);
        expect(reply.res.error).toContain(said);
    });

    test('Profile.open starts the parent executable and reports its exit code, not that it started', async () => {
        const reply = await send({ command: 'Profile.open', profile: 'Default', url: URL });
        expect(reply.status).toBe(true);
        // node refuses the browser's switches, and says so on stderr
        expect(reply.res.error).toMatch(/exit code (?!24\b)\d+/);
        expect(reply.res.error).toContain('--user-data-dir');
        // the stream is still in step after it
        expect((await send({ command: 'Settings.read' })).res.data).toContain('smoothScroll');
    }, 20000);

    test('a SingletonLock naming another process: nothing is listed or launched', async () => {
        lock(udd, process.pid + 1);
        try {
            const list = await send({ command: 'Profile.list' });
            expect(list.res.error).toContain('found no browser data directory');
            const open = await send({ command: 'Profile.open', profile: 'Default', url: URL });
            expect(open.res.error).toContain('found no browser data directory');
        } finally {
            lock(udd, process.pid);
        }
    });

    test('an unknown command still answers with no res, as old extensions expect', async () => {
        const reply = await send({ command: 'Nope.nothing' });
        expect(reply).toEqual({ status: true, id: expect.any(Number) });
    });

    test('stdout holds nothing but replies, and the host exits when the browser goes', async () => {
        const { out, rest } = frames();
        expect(rest.length).toBe(0);
        out.forEach((text) => expect(() => JSON.parse(text)).not.toThrow());
        host.stdin.end();
        expect(await exited).toBe(0);
    });
});
