-- Part of this file comes from https://github.com/glacambre/firenvim

local b='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/' -- You will need this for encoding/decoding
-- encoding
function base64_enc(data)
    return ((data:gsub('.', function(x) 
        local r,b='',x:byte()
        for i=8,1,-1 do r=r..(b%2^i-b%2^(i-1)>0 and '1' or '0') end
        return r;
    end)..'0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
        if (#x < 6) then return '' end
        local c=0
        for i=1,6 do c=c+(x:sub(i,i)=='1' and 2^(6-i) or 0) end
        return b:sub(c+1,c+1)
    end)..({ '', '==', '=' })[#data%3+1])
end

-- decoding
function base64_dec(data)
    data = string.gsub(data, '[^'..b..'=]', '')
    return (data:gsub('.', function(x)
        if (x == '=') then return '' end
        local r,f='',(b:find(x)-1)
        for i=6,1,-1 do r=r..(f%2^i-f%2^(i-1)>0 and '1' or '0') end
        return r;
    end):gsub('%d%d%d?%d?%d?%d?%d?%d?', function(x)
        if (#x ~= 8) then return '' end
        local c=0
        for i=1,8 do c=c+(x:sub(i,i)=='1' and 2^(8-i) or 0) end
            return string.char(c)
    end))
end

-- Returns a 2-characters string the bits of which represent the argument
local function to_16_bits_str(number)
    return string.char(bit.band(bit.rshift(number, 8), 255)) ..
    string.char(bit.band(number, 255))
end

-- Returns a number representing the 2 first characters of the argument string
local function to_16_bits_number(str)
    return bit.lshift(string.byte(str, 1), 8) +
    string.byte(str, 2)
end

-- Returns a 4-characters string the bits of which represent the argument
local function to_32_bits_str(number)
    return string.char(bit.band(bit.rshift(number, 24), 255)) ..
    string.char(bit.band(bit.rshift(number, 16), 255)) ..
    string.char(bit.band(bit.rshift(number, 8), 255)) ..
    string.char(bit.band(number, 255))
end

-- Returns a number representing the 4 first characters of the argument string
local function to_32_bits_number(str)
    return bit.lshift(string.byte(str, 1), 24) +
    bit.lshift(string.byte(str, 2), 16) +
    bit.lshift(string.byte(str, 3), 8) +
    string.byte(str, 4)
end

-- Returns a 4-characters string the bits of which represent the argument
-- Returns incorrect results on numbers larger than 2^32
local function to_64_bits_str(number)
    return string.char(0) .. string.char(0) .. string.char(0) .. string.char(0) ..
    to_32_bits_str(number % 0xFFFFFFFF)
end

-- Returns a number representing the 8 first characters of the argument string
-- Returns incorrect results on numbers larger than 2^48
local function to_64_bits_number(str)
    return bit.lshift(string.byte(str, 2), 48) +
    bit.lshift(string.byte(str, 3), 40) +
    bit.lshift(string.byte(str, 4), 32) +
    bit.lshift(string.byte(str, 5), 24) +
    bit.lshift(string.byte(str, 6), 16) +
    bit.lshift(string.byte(str, 7), 8) +
    string.byte(str, 8)
end

-- Algorithm described in https://tools.ietf.org/html/rfc3174
local function sha1(val)

    -- Mark message end with bit 1 and pad with bit 0, then add message length
    -- Append original message length in bits as a 64bit number
    -- Note: We don't need to bother with 64 bit lengths so we just add 4 to
    -- number of zeros used for padding and append a 32 bit length instead
    local padded_message = val ..
    string.char(128) ..
    string.rep(string.char(0), 64 - ((string.len(val) + 1 + 8) % 64) + 4) ..
    to_32_bits_str(string.len(val) * 8)

    -- Blindly implement method 1 (section 6.1) of the spec without
    -- understanding a single thing
    local H0 = 0x67452301
    local H1 = 0xEFCDAB89
    local H2 = 0x98BADCFE
    local H3 = 0x10325476
    local H4 = 0xC3D2E1F0

    -- For each block
    for M = 0, string.len(padded_message) - 1, 64  do
        local block = string.sub(padded_message, M + 1)
        local words = {}
        -- Initialize 16 first words
        local i = 0
        for W = 1, 64, 4 do
            words[i] = to_32_bits_number(string.sub(
            block,
            W
            ))
            i = i + 1
        end

        -- Initialize the rest
        for t = 16, 79, 1 do
            words[t] = bit.rol(
            bit.bxor(
            words[t - 3],
            words[t - 8],
            words[t - 14],
            words[t - 16]
            ),
            1
            )
        end

        local A = H0
        local B = H1
        local C = H2
        local D = H3
        local E = H4

        -- Compute the hash
        for t = 0, 79, 1 do
            local TEMP
            if t <= 19 then
                TEMP = bit.bor(
                bit.band(B, C),
                bit.band(
                bit.bnot(B),
                D
                )
                ) +
                0x5A827999
            elseif t <= 39 then
                TEMP = bit.bxor(B, C, D) + 0x6ED9EBA1
            elseif t <= 59 then
                TEMP = bit.bor(
                bit.bor(
                bit.band(B, C),
                bit.band(B, D)
                ),
                bit.band(C, D)
                ) +
                0x8F1BBCDC
            elseif t <= 79 then
                TEMP = bit.bxor(B, C, D) + 0xCA62C1D6
            end
            TEMP = (bit.rol(A, 5) + TEMP + E + words[t])
            E = D
            D = C
            C = bit.rol(B, 30)
            B = A
            A = TEMP
        end

        -- Force values to be on 32 bits
        H0 = (H0 + A) % 0x100000000
        H1 = (H1 + B) % 0x100000000
        H2 = (H2 + C) % 0x100000000
        H3 = (H3 + D) % 0x100000000
        H4 = (H4 + E) % 0x100000000
    end

    return to_32_bits_str(H0) ..
    to_32_bits_str(H1) ..
    to_32_bits_str(H2) ..
    to_32_bits_str(H3) ..
    to_32_bits_str(H4)
end

local opcodes = {
    text = 1,
    binary = 2,
    close = 8,
    ping = 9,
    pong = 10,
}

-- The client's handshake is described here: https://tools.ietf.org/html/rfc6455#section-4.2.1
local function parse_headers()
    local headerend = nil
    local headerstring = ""
    -- Accumulate header lines until we have them all
    while headerend == nil do
        headerstring = headerstring .. coroutine.yield(nil, nil, nil)
        headerend = string.find(headerstring, "\r?\n\r?\n")
    end

    -- request is the first line of any HTTP request: 'GET /file HTTP/1.1'
    local request = string.sub(headerstring, 1, string.find(headerstring, "\n"))
    -- rest is any data that might follow the actual HTTP request
    -- (GET+key/values). If I understand the spec correctly, it should be
    -- empty.
    local rest = string.sub(headerstring, headerend + 2)

    local keyvalues = string.sub(headerstring, string.len(request))
    local headerobj = {}
    for key, value in string.gmatch(keyvalues, "([^:]+) *: *([^\r\n]+)\r?\n") do
        headerobj[key] = value
    end
    return request, headerobj, rest
end

local function compute_key(key)
    return base64_enc(sha1(key .. "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
end

-- The server's opening handshake is described here: https://tools.ietf.org/html/rfc6455#section-4.2.2
local function accept_connection(headers)
    return "HTTP/1.1 101 Swithing Protocols\n" ..
    "Connection: Upgrade\r\n" ..
    "Sec-WebSocket-Accept: " .. compute_key(headers["Sec-WebSocket-Key"]) .. "\r\n" ..
    "Upgrade: websocket\r\n" ..
    "\r\n"
end

-- Frames are described here: https://tools.ietf.org/html/rfc6455#section-5.2
local function decode_frame()
    local frame = ""
    local result = {}
    while true do
        local current_byte = 1
        -- We need at least the first two bytes of header in order to
        -- start doing any kind of useful work:
        -- - One for the fin/rsv/opcode fields
        -- - One for the mask + payload length
        while (string.len(frame) < 2) do
            frame = frame .. coroutine.yield(nil)
        end

        result.fin = bit.band(bit.rshift(string.byte(frame, current_byte), 7), 1) == 1
        result.rsv1 = bit.band(bit.rshift(string.byte(frame, current_byte), 6), 1) == 1
        result.rsv2 = bit.band(bit.rshift(string.byte(frame, current_byte), 5), 1) == 1
        result.rsv3 = bit.band(bit.rshift(string.byte(frame, current_byte), 4), 1) == 1
        result.opcode = bit.band(string.byte(frame, current_byte), 15)
        current_byte = current_byte + 1

        result.mask = bit.rshift(string.byte(frame, current_byte), 7) == 1
        result.payload_length = bit.band(string.byte(frame, current_byte), 127)
        current_byte = current_byte + 1

        if result.payload_length == 126 then
            -- Payload length is on the next two bytes, make sure
            -- they're present
            while (string.len(frame) < current_byte + 2) do
                frame = frame .. coroutine.yield(nil)
            end

            result.payload_length = to_16_bits_number(string.sub(frame, current_byte))
            current_byte = current_byte + 2
        elseif result.payload_length == 127 then
            -- Payload length is on the next eight bytes, make sure
            -- they're present
            while (string.len(frame) < current_byte + 8) do
                frame = frame .. coroutine.yield(nil)
            end
            result.payload_length = to_64_bits_number(string.sub(frame, current_byte))
            print("Warning: payload length on 64 bits. Estimated:" .. result.payload_length)
            current_byte = current_byte + 8
        end

        while string.len(frame) < current_byte + result.payload_length do
            frame = frame .. coroutine.yield(nil)
        end

        result.masking_key = string.sub(frame, current_byte, current_byte + 4)
        current_byte = current_byte + 4

        result.payload = ""
        local payload_end = current_byte + result.payload_length - 1
        local j = 1
        for i = current_byte, payload_end do
            result.payload = result.payload .. string.char(bit.bxor(
            string.byte(frame, i),
            string.byte(result.masking_key, j)
            ))
            j = (j % 4) + 1
        end
        current_byte = payload_end + 1
        if result.opcode == opcodes.close then
            logw("exit decode: " .. frame .. "\n")
            return result
        else
            frame = string.sub(frame, current_byte) .. coroutine.yield(result)
        end
    end
end

-- The format is the same as the client's (
-- https://tools.ietf.org/html/rfc6455#section-5.2 ), except we don't need to
-- mask the data.
local function encode_frame(data)
    -- 130: 10000010
    -- Fin: 1
    -- RSV{1,2,3}: 0
    -- Opcode: 2 (binary frame)
    local header = string.char(130)
    local len
    if string.len(data) < 126 then
        len = string.char(string.len(data))
    elseif string.len(data) < 65536 then
        len = string.char(126) .. to_16_bits_str(string.len(data))
    else
        len = string.char(127) .. to_64_bits_str(string.len(data))
    end
    return  header .. len .. data
end

local function close_frame()
    local frame = encode_frame("")
    return string.char(136) .. string.sub(frame, 2)
end

local function close_server(server)
    vim.loop.close(server)
    -- Work around https://github.com/glacambre/firenvim/issues/49 Note:
    -- important to do this before nvim_command("qall") because it breaks
    -- vim.loop.new_timer():start(1000, 100, (function() os.exit() end))
    -- vim.schedule(function()
        -- vim.api.nvim_command("qall!")
    -- end)
end

local function connection_handler(server, sock, token)
    local pipe = vim.loop.new_pipe(false)

    -- https://neovim.io/doc/user/eval.html#v%3Aservername
    local self_addr = vim.v.servername
    if self_addr == nil then
            self_addr = os.getenv("NVIM_LISTEN_ADDRESS")
    end
    vim.loop.pipe_connect(pipe, self_addr, function(err)
        assert(not err, err)
    end)

    local header_parser = coroutine.create(parse_headers)
    coroutine.resume(header_parser, "")
    local request, headers = nil, nil

    local frame_decoder = coroutine.create(decode_frame)
    coroutine.resume(frame_decoder, nil)
    local decoded_frame = nil
    local current_payload = ""

    return function(err, chunk)
        assert(not err, err)
        if not chunk then
            logw("close_server 1\n")
            return close_server()
        end
        local _
        if not headers then
            _ , request, headers = coroutine.resume(header_parser, chunk)
            if not request then
                -- Coroutine hasn't parsed the request
                -- because it isn't complete yet
                return
            end
            if not (string.match(request, "^GET /" .. token .. " HTTP/1.1\r\n$")
                and string.match(headers["Connection"] or "", "Upgrade")
                and string.match(headers["Upgrade"] or "", "websocket")) then
                -- Connection didn't give us the right
                -- token, isn't a websocket request or
                -- hasn't been made from a webextension
                -- context: abort.
                sock:close()
                logw("close_server 2\n")
                close_server(server)
                return
            end
            sock:write(accept_connection(headers))
            pipe:read_start(function(error, v)
                assert(not error, error)
                if v then
                    local status, res = pcall(vim.fn.msgpackparse, {v})
                    -- logw("\n======out========\n")
                    -- logw(v)
                    -- logw("\n=================\n")
                    sock:write(encode_frame(v))
                end
            end)
            return
        end
        _, decoded_frame = coroutine.resume(frame_decoder, chunk)
        while decoded_frame ~= nil do
            if decoded_frame.opcode == opcodes.binary then
                current_payload = current_payload .. decoded_frame.payload
                if decoded_frame.fin then
                    -- logw("\n=======in========\n")
                    -- logw(current_payload)
                    -- logw("\n=================\n")
                    pipe:write(current_payload)
                    current_payload = ""
                end
            elseif decoded_frame.opcode == opcodes.ping then
                -- TODO: implement pong_frame
                -- sock:write(pong_frame(decoded_frame))
                return
            elseif decoded_frame.opcode == opcodes.close and vim.g.server_token == nil then
                sock:write(close_frame(decoded_frame))
                sock:close()
                pipe:close()
                logw("close_server 3\n")
                -- close_server(server)
                logw("header_parser: " .. coroutine.status(header_parser) .. "\n")
                logw("frame_decoder: " .. coroutine.status(frame_decoder) .. "\n")
                return
            end
            _, decoded_frame = coroutine.resume(frame_decoder, "")
        end
    end
end

current_server_port = 0
local function start_server(token, port)
    vim.api.nvim_command("doautocmd GUIEnter")
    local server = vim.loop.new_tcp()
    server:nodelay(true)
    server:bind('127.0.0.1', port)
    server:listen(128, function(err)
        assert(not err, err)
        local sock = vim.loop.new_tcp()
        sock:nodelay(true)
        server:accept(sock)
        sock:read_start(connection_handler(server, sock, token))
    end)
    current_server_port = server:getsockname().port
    return {
        event = "serverStarted",
        port = current_server_port
    }
end

function write_stdout(id, data)
    -- The native messaging protocol expects the message's length
    -- to precede the message. It has to use native endianness. We
    -- assume big endian.
    -- https://developer.chrome.com/docs/apps/nativeMessaging/#native-messaging-host-protocol
    --
    -- The payload is CONCATENATED onto the header rather than unpacked with
    -- string.byte, which makes one return value per byte and LuaJIT refuses past
    -- ~8000 of them -- a size a reply carrying ~/.surfingkeys.js easily reaches.
    local len = string.len(data)
    local lenstr = string.char(bit.band(len, 255),
    bit.band(bit.rshift(len, 8), 255),
    bit.band(bit.rshift(len, 16), 255),
    bit.band(bit.rshift(len, 24), 255)) .. data

    vim.api.nvim_chan_send(id, lenstr)
end

-- Read when `localPath` is `<native>`. Reports why a read failed, so the path and
-- the host can be told apart.
function read_settings()
    local path = home_dir .. "/.surfingkeys.js"
    local f, err = io.open(path, "r")
    if f == nil then
        return { error = err or ("Could not read " .. path) }
    end
    local content = f:read("*a")
    f:close()
    if content == nil then
        return { error = "Could not read " .. path }
    end
    return { data = content }
end

-- Returned by a handler that answers LATER through send_reply, so respond_to writes
-- nothing for it. Profile.open is the one such handler: what it reports is the exit
-- code of the browser it launched, which can take 20 seconds to arrive, and waiting
-- for it inside respond_to would hold every other request -- a settings read on each
-- page load -- behind it.
local DEFERRED = {}

-- Writes the reply to request `id`. Every reply goes through here, deferred or not.
local function send_reply(chan, id, status, res)
    -- json_encode refuses a string that is not UTF-8 (a path, a program's output), and
    -- a reply that is never written leaves the browser waiting for it.
    local encoded, resp = pcall(vim.fn.json_encode, {
        status = status,
        res = res,
        id = id
    })
    if not encoded then
        logw("stdout failed to encode: " .. tostring(resp) .. "\n")
        status, res = false, "the native host could not encode its reply"
        resp = vim.fn.json_encode({ status = status, res = res, id = id })
    end
    -- A write that throws leaves the browser waiting on a reply that never arrives.
    local written, werr = pcall(write_stdout, chan, resp)
    if not written then
        logw("stdout failed: " .. tostring(werr) .. "\n")
    end
    -- Settings are read on every page load, so logging the reply text would grow this
    -- log by the size of ~/.surfingkeys.js per page.
    if status and type(res) == "table" and type(res.data) == "string" then
        logw("stdout: Settings.read " .. #res.data .. " bytes\n")
    else
        logw("stdout: " .. resp .. "\n")
    end
end

-- Profile switching (gP in the extension) ---------------------------------------------
--
-- An extension sees only its own profile: it can neither list the others nor open a
-- tab in one. A second browser process started with --profile-directory can. It hands
-- its command line to the browser already running, which opens the URL in the last
-- active window of that profile (or a new window when it has none), and exits.
--
-- Everything here rests on this host's PARENT being the browser, which holds because
-- start.sh EXECs nvim. That is the only thing tying the host to one browser: on
-- Windows start.bat cannot exec and the parent is cmd.exe, so Windows is refused
-- rather than guessed at.

local uv = vim.loop

-- The browser's exit codes when it handed its command line to the instance already
-- running. Inside it that is CHROME_RESULT_CODE_NORMAL_EXIT_PROCESS_NOTIFIED (24), but
-- ChromeMain turns every "normal" code into 0 before the process exits, so 0 is what a
-- hand-off that worked reports: a check for 24 alone reports every switch as a failure.
-- 24 is kept for a build that does not remap it.
local EXIT_HANDED_OVER = { [0] = true, [24] = true }
-- PROFILE_IN_USE, which LOCK_ERROR shares: the running browser did not take it.
local EXIT_PROFILE_IN_USE = 21
-- The deadline must stay under the 20 seconds the launched browser waits for the
-- running one to acknowledge: past those it kills the running browser and takes its
-- place, as when started from a terminal. The launcher is stopped at the deadline, so a
-- browser too busy to answer is reported as not having confirmed, never killed and
-- replaced by a switch the user only meant to bring a window forward.
local PROFILE_OPEN_TIMEOUT_MS = 15000

-- Local State can hold an object with an empty key, which vim.fn.json_decode can only
-- return as a special _TYPE/_VAL table; vim.json, where this nvim has it, reads it as
-- a plain one.
local json_decode_any = (vim.json and vim.json.decode) or vim.fn.json_decode

local function os_name()
    if vim.fn.has('win32') == 1 then
        return 'windows'
    end
    local ok, uname = pcall(uv.os_uname)
    local sysname = ok and type(uname) == 'table' and uname.sysname or ''
    if sysname == 'Darwin' then
        return 'mac'
    elseif sysname == 'Linux' then
        return 'linux'
    end
    return sysname
end

local function read_file(path)
    local f = io.open(path, "rb")
    if f == nil then
        return nil
    end
    local content = f:read("*a")
    f:close()
    return content
end

local function realpath(path)
    local ok, real = pcall(uv.fs_realpath, path)
    return (ok and type(real) == 'string') and real or path
end

-- LuaJIT's ffi with the two libSystem calls below declared, or nil on an nvim built
-- with PUC Lua. Each declaration is made on its own: another plugin may have made it
-- already, and the error a redeclaration raises would take the other one with it.
local function mac_ffi()
    local ok, ffi = pcall(require, 'ffi')
    if not ok then
        return nil
    end
    pcall(ffi.cdef, 'int proc_pidpath(int pid, void *buffer, uint32_t buffersize);')
    pcall(ffi.cdef, 'int sysctl(int *name, unsigned int namelen, void *oldp, size_t *oldlenp, void *newp, size_t newlen);')
    return ffi
end

-- The arguments in a KERN_PROCARGS2 buffer, given what follows its leading argc: the
-- executable path, NUL padding, then argc NUL-terminated arguments (the environment
-- comes after them).
local function parse_procargs2(data, argc)
    local pos = string.find(data, "\0", 1, true)
    if pos == nil then
        return nil
    end
    while pos <= #data and string.byte(data, pos) == 0 do
        pos = pos + 1
    end
    local argv = {}
    while #argv < argc and pos <= #data do
        local stop = string.find(data, "\0", pos, true) or (#data + 1)
        argv[#argv + 1] = string.sub(data, pos, stop - 1)
        pos = stop + 1
    end
    return argv
end

-- The exact argv of process `pid` on macOS, which `ps -o args` cannot give: it joins
-- the arguments with spaces, and the default data directory has one in it.
local function mac_argv(pid)
    local ffi = mac_ffi()
    if ffi == nil then
        return nil
    end
    local ok, argv = pcall(function()
        local int_size = ffi.sizeof('int')
        local argmax = ffi.new('int[1]')
        local size = ffi.new('size_t[1]', int_size)
        -- CTL_KERN, KERN_ARGMAX
        if ffi.C.sysctl(ffi.new('int[2]', 1, 8), 2, argmax, size, nil, 0) ~= 0 or argmax[0] <= int_size then
            return nil
        end
        local buf = ffi.new('char[?]', argmax[0])
        size[0] = argmax[0]
        -- CTL_KERN, KERN_PROCARGS2, pid
        if ffi.C.sysctl(ffi.new('int[3]', 1, 49, pid), 3, buf, size, nil, 0) ~= 0 then
            return nil
        end
        local len = tonumber(size[0])
        if len <= int_size then
            return nil
        end
        return parse_procargs2(ffi.string(buf + int_size, len - int_size), ffi.cast('int *', buf)[0])
    end)
    return ok and argv or nil
end

local function mac_exe(pid)
    local ffi = mac_ffi()
    if ffi ~= nil then
        local ok, exe = pcall(function()
            -- PROC_PIDPATHINFO_MAXSIZE
            local buf = ffi.new('char[?]', 4096)
            local n = ffi.C.proc_pidpath(pid, buf, 4096)
            return n > 0 and ffi.string(buf, n) or nil
        end)
        if ok and exe then
            return exe
        end
    end
    -- argv[0], which is the full path for a browser started from the Finder or the
    -- Dock, and is used only then. A list runs without a shell, its output captured.
    local ok, out = pcall(vim.fn.system, {'ps', '-o', 'comm=', '-p', tostring(pid)})
    if ok and vim.v.shell_error == 0 and type(out) == 'string' then
        out = string.gsub(out, '%s+$', '')
        if string.sub(out, 1, 1) == '/' then
            return out
        end
    end
    return nil
end

local function linux_argv(pid)
    local raw = read_file('/proc/' .. pid .. '/cmdline')
    if raw == nil or raw == '' then
        return nil
    end
    local argv = {}
    for arg in string.gmatch(raw, '([^%z]*)%z') do
        argv[#argv + 1] = arg
    end
    return argv
end

-- Every reading of a --user-data-dir value in `argv`. Chromium on Linux rewrites its
-- process title, after which /proc shows the whole command line as ONE argument joined
-- with spaces, so a value is also tried cut at each space in it. A wrong cut costs
-- nothing: only a directory whose SingletonLock names the browser is ever used.
local function udd_from_argv(argv, cwd)
    local found = {}
    local function add(value)
        if string.sub(value, 1, 1) ~= '/' then
            -- relative to the browser's own working directory, as it reads it
            if cwd == nil then
                return
            end
            value = cwd .. '/' .. value
        end
        found[#found + 1] = value
    end
    for _, arg in ipairs(argv) do
        local from = 1
        while true do
            local s, e = string.find(arg, 'user-data-dir=', from, true)
            if s == nil then
                break
            end
            local before = string.sub(arg, 1, s - 1)
            if string.match(before, '^%-%-?$') or string.match(before, ' %-%-?$') then
                local value = string.sub(arg, e + 1)
                add(value)
                for i = 1, #value do
                    if string.sub(value, i, i) == ' ' then
                        add(string.sub(value, 1, i - 1))
                    end
                end
            end
            from = e + 1
        end
    end
    return found
end

-- The pid in <dir>/SingletonLock, a symlink to "<hostname>-<pid>" that the browser
-- holding the directory makes. A hostname can contain '-', so the pid follows the LAST
-- one. nil for no lock, or one that is a plain file as old macOS builds left it.
local function lock_pid(dir)
    local target = uv.fs_readlink(dir .. '/SingletonLock')
    if type(target) ~= 'string' then
        return nil
    end
    return tonumber(string.match(target, '%-(%d+)$'))
end

-- Whether <dir>/SingletonSocket leads to a socket. A directory is the browser's only
-- when this holds as well as its lock naming the browser: a SingletonLock outlives a
-- crash and its pid is reused, while the socket lives in a temporary folder that a
-- reboot empties. Going by the lock alone, a stale one that happens to name the browser
-- wins, and the host lists another browser's profiles and launches with that
-- browser's directory, where nothing answers the launcher.
local function holds_socket(dir)
    local st = uv.fs_stat(dir .. '/SingletonSocket')
    return type(st) == 'table' and st.type == 'socket'
end

local function subdirs(dir)
    local list = {}
    local handle = uv.fs_scandir(dir)
    if handle == nil then
        return list
    end
    while true do
        local name, kind = uv.fs_scandir_next(handle)
        if name == nil then
            break
        end
        if kind ~= 'file' then
            list[#list + 1] = dir .. '/' .. name
        end
    end
    return list
end

-- Which browser started this host: its pid, its data directory (where Local State and
-- the profiles are) and, when `need_exe`, its executable. Or nil and the reason.
--
-- The data directory is accepted only when its SingletonLock names the parent. Any
-- other is never launched with: a browser started on a directory no running browser
-- holds does not hand anything over, it STARTS -- a second, complete browser on
-- another set of profiles.
local function locate_browser(need_exe)
    local system = os_name()
    if system ~= 'mac' and system ~= 'linux' then
        return nil, 'switching profiles works on macOS and Linux only'
    end
    local ppid = uv.os_getppid and uv.os_getppid()
    if type(ppid) ~= 'number' or ppid <= 1 then
        return nil, 'the browser that started this host has gone'
    end

    local argv, cwd
    if system == 'linux' then
        argv = linux_argv(ppid)
        cwd = uv.fs_readlink('/proc/' .. ppid .. '/cwd')
    else
        argv = mac_argv(ppid)
    end
    local named = argv and udd_from_argv(argv, cwd) or {}
    local roots = {}
    if system == 'linux' then
        -- read by Chromium on Linux only, and passed on to its children
        local env_dir = os.getenv('CHROME_USER_DATA_DIR')
        if env_dir and string.sub(env_dir, 1, 1) == '/' then
            named[#named + 1] = env_dir
        end
        -- Chromium puts its default directory under $CHROME_CONFIG_HOME when that is
        -- set, ahead of $XDG_CONFIG_HOME: a browser using it is found only there.
        local chrome_config = os.getenv('CHROME_CONFIG_HOME')
        if chrome_config and string.sub(chrome_config, 1, 1) == '/' then
            roots[#roots + 1] = chrome_config
        end
        local xdg = os.getenv('XDG_CONFIG_HOME')
        roots[#roots + 1] = (xdg and xdg ~= '') and xdg or (home_dir .. '/.config')
    else
        roots[1] = home_dir .. '/Library/Application Support'
    end

    -- Looked through in stages, nearest first, and the first stage holding a match
    -- decides: the command line names the directory outright, and the default places
    -- sit one level (Chromium, Helium) or two (Google/Chrome) below a root.
    local top = nil
    local function top_dirs()
        if top == nil then
            top = {}
            for _, root in ipairs(roots) do
                for _, dir in ipairs(subdirs(root)) do
                    top[#top + 1] = dir
                end
            end
        end
        return top
    end
    local stages = {
        function() return named end,
        top_dirs,
        function()
            local deeper = {}
            for _, dir in ipairs(top_dirs()) do
                for _, sub in ipairs(subdirs(dir)) do
                    deeper[#deeper + 1] = sub
                end
            end
            return deeper
        end,
    }
    local udd
    for _, stage in ipairs(stages) do
        local matches, seen = {}, {}
        for _, dir in ipairs(stage()) do
            if lock_pid(dir) == ppid and holds_socket(dir) then
                local real = realpath(dir)
                if not seen[real] then
                    seen[real] = true
                    matches[#matches + 1] = real
                end
            end
        end
        if #matches > 1 then
            return nil, 'more than one browser data directory names process ' .. ppid
                .. ' in its SingletonLock: ' .. table.concat(matches, ', ')
        elseif #matches == 1 then
            udd = matches[1]
            break
        end
    end
    if udd == nil then
        return nil, 'found no browser data directory whose SingletonLock names process ' .. ppid
            .. ', the one that started this host, with its SingletonSocket in place: start.sh must start nvim with exec'
    end

    local exe
    if need_exe then
        if system == 'linux' then
            exe = uv.fs_readlink('/proc/' .. ppid .. '/exe')
            -- the browser was updated while it ran: the new binary is at the same path
            exe = type(exe) == 'string' and string.gsub(exe, ' %(deleted%)$', '') or nil
        else
            exe = mac_exe(ppid)
        end
        if type(exe) ~= 'string' or string.sub(exe, 1, 1) ~= '/' or vim.fn.executable(exe) ~= 1 then
            return nil, 'could not find the executable of the browser that started this host (process '
                .. ppid .. ')'
        end
    end
    return { pid = ppid, udd = udd, exe = exe }
end

local function profile_label(info)
    local name = type(info.name) == 'string' and info.name or ''
    local gaia = type(info.gaia_name) == 'string' and info.gaia_name or ''
    if gaia ~= '' and gaia ~= name then
        return name ~= '' and (gaia .. ' (' .. name .. ')') or gaia
    end
    return name
end

-- The profiles <udd>/Local State lists, in the order of the browser's own profile
-- menu. Read anew on every request: a profile deleted since the list was shown must
-- not be launched.
local function read_profiles(udd)
    local path = udd .. '/Local State'
    local text = read_file(path)
    if text == nil then
        return nil, 'could not read ' .. path
    end
    local ok, state = pcall(json_decode_any, text)
    if not ok or type(state) ~= 'table' then
        return nil, 'could not parse ' .. path
    end
    local function field(t, key)
        return (type(t) == 'table' and type(t[key]) == 'table') and t[key] or {}
    end
    local cache = field(field(state, 'profile'), 'info_cache')
    -- Profiles deleted but not yet removed from disk, by path or by name.
    local gone = {}
    for _, p in ipairs(field(field(state, 'profiles'), 'profile_basenames_deleted')) do
        if type(p) == 'string' then
            gone[p] = true
            gone[string.match(p, '[^/\\]+$') or p] = true
        end
    end

    local list, by_dir = {}, {}
    local function add(dir)
        local info = cache[dir]
        if type(dir) ~= 'string' or by_dir[dir] or gone[dir] or type(info) ~= 'table' then
            return
        end
        local entry = { dir = dir, name = profile_label(info) }
        if entry.name == '' then
            entry.name = dir
        end
        if type(info.user_name) == 'string' and info.user_name ~= '' then
            entry.email = info.user_name
        end
        by_dir[dir] = entry
        list[#list + 1] = entry
    end
    for _, dir in ipairs(field(field(state, 'profile'), 'profiles_order')) do
        add(dir)
    end
    -- Ones the order misses, as the browser itself sorts them: by name.
    local rest = {}
    for dir, info in pairs(cache) do
        if type(dir) == 'string' and type(info) == 'table' and not by_dir[dir] and not gone[dir] then
            local label = profile_label(info)
            rest[#rest + 1] = { dir = dir, key = string.lower(label ~= '' and label or dir) }
        end
    end
    table.sort(rest, function(a, b)
        if a.key ~= b.key then
            return a.key < b.key
        end
        return a.dir < b.dir
    end)
    for _, r in ipairs(rest) do
        add(r.dir)
    end
    return { list = list, by_dir = by_dir }
end

local function list_profiles()
    local browser, err = locate_browser(false)
    if browser == nil then
        return { error = err }
    end
    local profiles, perr = read_profiles(browser.udd)
    if profiles == nil then
        return { error = perr }
    end
    return { data = profiles.list }
end

-- The launched browser's output, for an error message: kept short, and UTF-8, which
-- is all a reply can carry.
local function job_output(lines)
    local text = table.concat(lines, ' ')
    text = string.gsub(text, '%s+', ' ')
    text = string.gsub(text, '^ ', '')
    text = string.gsub(text, ' $', '')
    if #text > 300 then
        -- not in the middle of a character
        text = string.gsub(string.sub(text, 1, 300), '[\192-\255][\128-\191]*$', '') .. '…'
    end
    if not pcall(vim.fn.json_encode, text) then
        text = string.gsub(text, '[\128-\255]', '?')
    end
    return text
end

-- Starts the browser on `req.url` in profile `req.profile`, and answers request
-- `req.id` once it has seen what became of it: the outcome is the launched browser's
-- exit code, not that it started.
local function open_profile(chan, req)
    local id = req['id']
    local dir, url = req['profile'], req['url']
    -- only Surfingkeys' own page: anything else here is a URL opened by whoever can
    -- send this host a message
    if type(url) ~= 'string' or string.sub(url, 1, 19) ~= 'chrome-extension://' or string.find(url, '[%c%s]') then
        return { error = 'only a chrome-extension:// page is opened in another profile' }
    end
    local browser, err = locate_browser(true)
    if browser == nil then
        return { error = err }
    end
    local profiles, perr = read_profiles(browser.udd)
    if profiles == nil then
        return { error = perr }
    end
    -- --profile-directory naming a profile the browser does not have CREATES it.
    if type(dir) ~= 'string' or profiles.by_dir[dir] == nil or string.find(dir, '[/\\]')
        or vim.fn.isdirectory(browser.udd .. '/' .. dir) ~= 1 then
        return { error = 'the browser has no profile "' .. tostring(dir) .. '" (any more): open the list again' }
    end

    local output = {}
    local settled = false
    local timer = nil
    local function finish(res)
        if settled then
            return
        end
        settled = true
        if timer ~= nil then
            pcall(vim.fn.timer_stop, timer)
        end
        send_reply(chan, id, true, res)
    end
    local function collect(_, data)
        if type(data) == 'table' then
            for _, line in ipairs(data) do
                if line ~= '' then
                    output[#output + 1] = line
                end
            end
        end
    end
    -- Its stdout is PIPED, never inherited: this host's stdout is the browser's native
    -- messaging pipe, the launched browser prints "Opening in existing browser session."
    -- on handing over, and one stray byte there breaks the protocol for good. So no
    -- os.execute, and no io.popen.
    local ok, job = pcall(vim.fn.jobstart, {
        browser.exe,
        '--user-data-dir=' .. browser.udd,
        '--profile-directory=' .. dir,
        url,
    }, {
        -- Not detached: the launcher must die with this host. The host exits when the
        -- browser that started it has gone, and a launcher outliving it would find no
        -- browser to hand over to and start one the user never asked for.
        stdin = 'null',
        stdout_buffered = true,
        stderr_buffered = true,
        on_stdout = collect,
        on_stderr = collect,
        on_exit = function(_, code)
            if EXIT_HANDED_OVER[code] then
                finish({ data = { dir = dir } })
                return
            end
            local said = job_output(output)
            local why
            if code == EXIT_PROFILE_IN_USE then
                why = 'the browser refused it, its profile being in use or locked (exit code 21)'
            else
                why = 'the browser did not hand it to the running one (exit code ' .. tostring(code) .. ')'
            end
            finish({ error = why .. (said ~= '' and (': ' .. said) or '') })
        end,
    })
    if not ok or type(job) ~= 'number' or job <= 0 then
        return { error = 'could not start ' .. browser.exe }
    end
    -- At the deadline the launcher is still waiting on the running browser; see
    -- PROFILE_OPEN_TIMEOUT_MS for why it is stopped rather than left to finish. The
    -- outcome is then UNKNOWN, not a failure: the launcher writes its whole request
    -- before it waits for the answer, and the running browser carries it out once it is
    -- free again, so a reply saying the switch will not happen can be proved wrong by
    -- the profile's window coming forward later.
    timer = vim.fn.timer_start(PROFILE_OPEN_TIMEOUT_MS, function()
        finish({ error = 'the browser did not confirm it within '
            .. (PROFILE_OPEN_TIMEOUT_MS / 1000) .. ' seconds; it may still open the profile once it responds' })
        pcall(vim.fn.jobstop, job)
    end)
    return DEFERRED
end

-- Bytes received from the browser that do not yet make up a whole message.
local stdin_buffer = ""

-- Recovers the exact bytes the browser wrote. A channel delivers stdin as LINES with
-- NUL and newline swapped: a newline splits the list, a NUL arrives as "\n" inside an
-- element. Both must be put back to read a binary length header.
local function stream_bytes(data)
    local parts = {}
    for i, chunk in ipairs(data) do
        parts[i] = (string.gsub(chunk, "\n", "\0"))
    end
    return table.concat(parts, "\n")
end

-- Takes the next complete native message out of the buffer, or nil when there is not
-- one yet. One on_stdin call is not one message: a length byte of 0x0A splits the
-- delivery, the editor and a settings read can both arrive in one call, and a long
-- message arrives in pieces.
local function take_message()
    if #stdin_buffer < 4 then
        return nil
    end
    local b1, b2, b3, b4 = string.byte(stdin_buffer, 1, 4)
    local len = b1 + b2 * 256 + b3 * 65536 + b4 * 16777216
    if #stdin_buffer < 4 + len then
        return nil
    end
    local text = string.sub(stdin_buffer, 5, 4 + len)
    stdin_buffer = string.sub(stdin_buffer, 5 + len)
    return text
end

-- Handles one whole message and writes its reply. The id tells the extension which
-- request a reply answers, and is read separately from handling so that a request
-- whose handling THROWS still carries it.
local function respond_to(chan, text)
    logw("stdin: " .. text .. "\n")
    local decoded, req = pcall(vim.fn.json_decode, text)
    local status, res
    if decoded then
        status, res = pcall(handle_input, chan, req)
    else
        status, res = false, req
    end
    local id = decoded and type(req) == "table" and req['id'] or nil
    if status and res == DEFERRED then
        logw("stdout: deferred " .. tostring(id) .. "\n")
        return
    end
    send_reply(chan, id, status, res)
end

function handle_input(id, data)
    if data['startServer'] and data['password'] then
        vim.g.surfingkeys_standalone = data['standalone']
        return start_server(data['password'], 0)
    elseif data['mode'] then
        vim.fn['SetSurfingkeysStandAlone'](data['mode'])
        return {
            mode = data['mode']
        }
    elseif data['command'] == 'Settings.read' then
        return read_settings()
    elseif data['command'] == 'Profile.list' then
        return list_profiles()
    elseif data['command'] == 'Profile.open' then
        return open_profile(id, data)
    end
end

home_dir = os.getenv("HOME")
if home_dir == nil then
    home_dir = os.getenv("USERPROFILE")
end
-- Logging is opt-in: it records every message in both directions, and a host is
-- long-lived. The switch is a FILE because the host inherits the browser's
-- environment, and a browser launched from the Dock has nothing to set.
--
-- One file per pid, since several hosts can run at once and sharing one name
-- interleaves their lines. Truncating keeps a recycled pid from appending onto a dead
-- one's log.
local function open_log()
    local marker = io.open(home_dir .. "/.surfingkeys.log.on", "r")
    if marker == nil then
        return nil
    end
    marker:close()
    local f = io.open(home_dir .. "/.surfingkeys." .. vim.fn.getpid() .. ".log", "w")
    if f ~= nil then
        f:setvbuf("no")
    end
    return f
end

log = open_log()

-- Every log site goes through this, including those in the stdin handler and the
-- socket callbacks: a bare log:write there would throw while logging is off, and
-- turning the log off has to quiet the host, not stop it answering.
function logw(msg)
    if log ~= nil then
        log:write(msg)
    end
end

surfingkeys_server_id = 0
if (vim.g ~= nil and vim.g.server_token ~= nil) then
    print("start server...")
    print(start_server(vim.g.server_token, vim.g.server_port))
elseif vim.fn ~= nil then
    surfingkeys_server_id = vim.fn.stdioopen({
        on_stdin = function(id, data, event)
            -- The stream closing arrives as a single empty string. Checked explicitly,
            -- since "nothing decoded" also describes a split length header.
            if #data == 1 and data[1] == "" then
                logw("qall: " .. tostring(current_server_port) .. "\n")
                vim.api.nvim_command('qall!')
                return
            end
            -- See stream_bytes for why this is not the bytes as delivered.
            stdin_buffer = stdin_buffer .. stream_bytes(data)
            while true do
                local text = take_message()
                if text == nil then
                    break
                end
                respond_to(id, text)
            end
        end
    })
else
    vim.api.nvim_command('quit')
end

function _G.surfingkeys_notify(event)
    vim.fn.rpcnotify(0, 'surfingkeys:rpc', event)
end

vim.api.nvim_exec([[
function! SurfingkeysNotify(event, ...)
    call rpcnotify(0, 'surfingkeys:rpc', a:event, a:000)
endfunction

function! NewScratch(fn, content, type)
    exec 'tabnew surfingkeys://'.a:fn
    setlocal bufhidden=wipe nobuflisted noswapfile
    tabonly
    let @v = v:lua.base64_dec(a:content)
    normal ggdG"vgP
    nnoremap <buffer> <silent> <Esc> :q<Cr>
    nnoremap <buffer> <silent> <Enter> :w<Cr>
    set nomodified
    if a:type == 'url'
        inoremap <silent> <CR> <Esc>:w<CR>
        set nonumber
        set norelativenumber
    elseif a:type == 'input'
        inoremap <silent> <CR> <Esc>:w<CR>
        set nonumber
        set norelativenumber
    endif
endfunction

function! SetSurfingkeysStandAlone(v)
endfunction

function! SurfingkeysWrite()
    call SurfingkeysNotify("WriteData", getbufline('%', 0, '$'))
    set nomodified
endfunction
au BufWriteCmd surfingkeys://* call SurfingkeysWrite()

nnoremap <silent> <M-i> :call SurfingkeysNotify("Enter")<CR>
nnoremap <silent> <Space>E :call SurfingkeysNotify("Enter", "E")<CR>
nnoremap <silent> <Space>R :call SurfingkeysNotify("Enter", "R")<CR>
" nnoremap <silent> <M-i> :call v:lua.surfingkeys_notify("Enter")<CR>

]], false)
