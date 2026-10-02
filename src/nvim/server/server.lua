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
-- `summary`, when given, is logged in place of the reply: one that carries tab titles
-- and URLs must not land in the log file.
local function send_reply(chan, id, status, res, summary)
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
    if summary ~= nil then
        logw("stdout: " .. summary .. ", " .. #resp .. " bytes\n")
    elseif status and type(res) == "table" and type(res.data) == "string" then
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
    -- the profile's window coming forward later. `pending` carries that to the menu,
    -- which says it without calling it a failure.
    timer = vim.fn.timer_start(PROFILE_OPEN_TIMEOUT_MS, function()
        finish({ pending = true, error = 'the browser did not confirm it within '
            .. (PROFILE_OPEN_TIMEOUT_MS / 1000) .. ' seconds; it may still open the profile once it responds' })
        pcall(vim.fn.jobstop, job)
    end)
    return DEFERRED
end

-- Tabs of the browser's other profiles (the palette) -----------------------------------
--
-- The browser runs one host per open profile: Surfingkeys in each profile connects its
-- own. The hosts of one browser find each other through UNIX sockets, one per host, in
-- a directory named after the browser's data directory, so a host never reaches the
-- hosts of another browser. A host asked for its tabs asks its own extension, over the
-- native messaging pipe the other way round: a message with `peer` set is a request
-- FROM this host, and the extension answers it with `peerReply`.
--
-- Tabs pass through sockets and memory only. Nothing of them is written to disk, the
-- log included.

-- How long Peers.tabs waits for each other host, all of them at once. The palette lists
-- this profile's tabs without waiting for it, so a host that hangs delays the other
-- profiles' group by this much and nothing else.
local PEER_LIST_TIMEOUT_MS = 1500
-- How long Peers.activate waits for the other profile to report what it switched to.
-- The background's own deadline (start.js) must outlast it.
local PEER_ACTIVATE_TIMEOUT_MS = 3000
-- How long a request from another host waits for this host's extension.
local PEER_SERVE_TIMEOUT_MS = 2500
-- Profile.identify looks for the token this many times, this far apart: the storage
-- write is on disk by the time the extension sends it, the retries are for a disk that
-- is slow to show it.
local IDENTIFY_ATTEMPTS = 8
local IDENTIFY_INTERVAL_MS = 250
-- When a scan found nothing, the extension is asked for a new token at most this often.
local REIDENTIFY_GAP_MS = 30000
-- How often a host checks that the others can still reach it, and listens anew when they
-- cannot: its socket removed (with the folder, or by a cleaner of temporary files) or
-- never made (the folder was refused, and has been fixed since). Otherwise only this
-- profile's own requests check it -- its extension connecting, its palette opening -- so
-- a profile whose palette is never opened would stay out of every other palette until
-- the browser restarts.
local PEER_RELISTEN_INTERVAL_MS = 30000
-- A request from another host is one short line. Past this it is not one.
local PEER_REQUEST_MAX = 65536
-- Or a reply of one: a profile with thousands of tabs comes to a few megabytes.
local PEER_REPLY_MAX = 32 * 1024 * 1024
-- Chrome ends the connection to a host that writes it a message over 1 MB, and the
-- editor and every settings read go with it.
local NATIVE_MESSAGE_MAX = 1024 * 1024
-- A socket's path must fit in sun_path with its NUL: 104 bytes on macOS, 108 on Linux.
-- libuv cuts a longer one short, and the socket would be made under another name.
local SOCKET_PATH_MAX = 103

local peer = {
    -- where the hosts of this browser meet, and this host's socket there
    dir = nil,
    path = nil,
    server = nil,
    udd = nil,
    -- The extension has sent Profile.identify, so it answers requests with `peer` set.
    -- One that has not is never sent one: an older extension takes a message carrying
    -- no id for the reply to the request it has outstanding.
    answering = false,
    -- the profile this host serves, once its token was found
    profile_dir = nil,
    identifying = false,
    -- uv.now() when the extension was last asked for a token, or nil
    asked_at = nil,
}

-- Requests to the extension waiting for their `peerReply`, by number.
local extension_waiting = {}
local next_extension_request = 1

-- Sends `message` to the extension and calls `done(res, timed_out)` once, with what it
-- answered or {error}; `timed_out` when that is because the extension had the message
-- but did not answer within `timeout_ms`. Only for an extension that has identified
-- itself (peer.answering).
local function ask_extension(message, timeout_ms, done)
    local n = next_extension_request
    next_extension_request = n + 1
    local timer = nil
    local function finish(res, timed_out)
        if extension_waiting[n] == nil then
            return
        end
        extension_waiting[n] = nil
        if timer ~= nil then
            pcall(vim.fn.timer_stop, timer)
        end
        done(res, timed_out == true)
    end
    extension_waiting[n] = finish
    message.peer = n
    local encoded, text = pcall(vim.fn.json_encode, message)
    local written = encoded and pcall(write_stdout, surfingkeys_server_id, text)
    if not written then
        finish({ error = 'the host could not write to Surfingkeys' })
        return
    end
    logw("stdout: " .. text .. "\n")
    timer = vim.fn.timer_start(timeout_ms, function()
        finish({ error = 'Surfingkeys in that profile did not answer within ' .. (timeout_ms / 1000) .. ' seconds' }, true)
    end)
end

-- `path` as a directory only this user can enter, made if missing; or nil and why.
-- Anyone else who could add a socket there would be sent this profile's requests, and
-- could hand the palette tabs of their own making.
local function private_dir(path)
    uv.fs_mkdir(path, 448)
    local st = uv.fs_lstat(path)
    if type(st) ~= 'table' or st.type ~= 'directory' then
        return nil, path .. ' is not a directory'
    end
    if st.uid ~= uv.getuid() then
        return nil, path .. ' belongs to another user'
    end
    if bit.band(st.mode, 511) ~= 448 then
        return nil, path .. ' can be entered by other users: it must have mode 0700'
    end
    return path
end

-- The directory the hosts of data directory `udd` meet in. Every host of one browser
-- inherits the browser's environment, so they all pick the same one.
local function peer_dir_for(udd)
    local base = os.getenv('XDG_RUNTIME_DIR')
    if base == nil or base == '' then
        base = os.getenv('TMPDIR')
    end
    if base == nil or base == '' then
        base = '/tmp'
    end
    base = (string.gsub(base, '/+$', ''))
    local root, err = private_dir(base .. '/surfingkeys-' .. uv.getuid())
    if root == nil then
        return nil, err
    end
    return private_dir(root .. '/' .. string.sub(vim.fn.sha256(udd), 1, 16))
end

local serve_peer
local reidentify

-- Listens for the other hosts of this browser, unless it does already through a socket
-- that is still in place. Returns true, or nil, why not, and whether that is because
-- there is no browser data directory to meet for.
local function peer_listen()
    if peer.server ~= nil then
        -- The socket FILE is what the others find this host by, and listening goes on
        -- after it is removed: taking "listening" for "reachable" leaves a host whose
        -- socket was removed out of every other palette for good.
        if peer.path ~= nil and uv.fs_stat(peer.path) ~= nil then
            return true
        end
        -- Closed BEFORE the next one is bound: closing a socket removes the name it was
        -- bound under, the temporary name below, which the next one is bound under too.
        -- Closed after, it takes the new socket's name away before the rename.
        peer.server:close()
        peer.server, peer.path = nil, nil
    end
    local browser, err = locate_browser(false)
    if browser == nil then
        return nil, err, true
    end
    local dir, derr = peer_dir_for(browser.udd)
    if dir == nil then
        return nil, derr
    end
    local pid = vim.fn.getpid()
    local path = dir .. '/' .. pid .. '.sock'
    local temp = dir .. '/' .. pid .. '.new'
    if #temp > SOCKET_PATH_MAX then
        return nil, 'the socket path ' .. path .. ' is too long'
    end
    -- Bound under another name and renamed once listening: another host that found it
    -- before it listens would take it for a dead host's socket, and remove it.
    uv.fs_unlink(temp)
    -- a dead host's, whose pid this one has now
    uv.fs_unlink(path)
    local server = uv.new_pipe(false)
    local ok, lerr = server:bind(temp)
    if ok then
        ok, lerr = server:listen(16, function(cerr)
            if cerr then
                return
            end
            local client = uv.new_pipe(false)
            if server:accept(client) then
                serve_peer(client)
            else
                client:close()
            end
        end)
    end
    if ok then
        ok, lerr = uv.fs_rename(temp, path)
    end
    if not ok then
        server:close()
        uv.fs_unlink(temp)
        return nil, 'could not listen on ' .. path .. ': ' .. tostring(lerr)
    end
    peer.server, peer.dir, peer.path, peer.udd = server, dir, path, browser.udd
    -- Reachable only from now, so possibly never named: identify gives up on a host that
    -- cannot listen, and the extension identified itself once, when it connected.
    reidentify()
    return true
end

-- The timer that runs keep_listening, while the host runs.
local relisten_timer = nil
-- Why the host last failed to listen, or nil while it listens: logged when it changes,
-- not every PEER_RELISTEN_INTERVAL_MS.
local listen_failure = nil

-- Listens, or tries to, and logs a change.
local function keep_listening()
    local ok, listening, err, no_browser = pcall(peer_listen)
    local why = nil
    if not (ok and listening) then
        why = tostring(ok and err or listening)
    end
    if why ~= listen_failure then
        logw(why and ("not listening for other profiles: " .. why .. "\n") or "listening for other profiles\n")
        listen_failure = why
    end
    -- The timer stops once no browser data directory is found -- Firefox, Windows, a
    -- start.sh that does not exec: no later try finds one, and each searches the user's
    -- folders of application data again.
    if ok and no_browser and relisten_timer ~= nil then
        pcall(vim.fn.timer_stop, relisten_timer)
        relisten_timer = nil
    end
end

-- Removes this host's socket, so the others do not try it once the host is gone, and
-- stops keep_listening making another.
function surfingkeys_peer_close()
    if relisten_timer ~= nil then
        pcall(vim.fn.timer_stop, relisten_timer)
        relisten_timer = nil
    end
    if peer.path ~= nil then
        uv.fs_unlink(peer.path)
        peer.path = nil
    end
end

-- The profile this host serves, as read_profiles names it, or vim.NIL (null) when not
-- known. Named anew each time, so a renamed profile shows its new name.
local function own_profile()
    if peer.profile_dir == nil or peer.udd == nil then
        return vim.NIL
    end
    local profiles = read_profiles(peer.udd)
    local entry = profiles and profiles.by_dir[peer.profile_dir]
    if entry == nil then
        return vim.NIL
    end
    return { dir = entry.dir, name = entry.name }
end

-- A LevelDB .log is a run of 32 KiB blocks. A record that does not fit in what is left
-- of a block goes on in the next one, after a 7-byte header of its own (checksum,
-- length, type), so a token written across a block boundary is in the file with that
-- header in the middle of it.
local LEVELDB_LOG_BLOCK = 32768
local LEVELDB_LOG_HEADER = 7

-- The bytes of a LevelDB .log with the header at the start of every block but the first
-- taken out: the records' bytes, joined across the block boundaries. The headers of the
-- records within a block stay, and only ever stand BETWEEN two records.
local function joined_log(content)
    local parts = { string.sub(content, 1, LEVELDB_LOG_BLOCK) }
    for start = LEVELDB_LOG_BLOCK + 1, #content, LEVELDB_LOG_BLOCK do
        parts[#parts + 1] = string.sub(content, start + LEVELDB_LOG_HEADER, start + LEVELDB_LOG_BLOCK - 1)
    end
    return table.concat(parts)
end

-- The profile directories of `udd` whose storage for extension `extension_id` holds
-- `token`. The browser keeps an extension's chrome.storage.local in
-- <profile>/Local Extension Settings/<id>/, a LevelDB that appends each write to its
-- .log file at once (and keeps it in an .ldb file once compacted). A .log is searched
-- joined as well as raw: searched raw only, a token cut by a block boundary is missed,
-- and the other profiles' palettes list this one's tabs under "another profile".
local function find_token(udd, extension_id, token)
    local found = {}
    for _, dir in ipairs(subdirs(udd)) do
        local store = dir .. '/Local Extension Settings/' .. extension_id
        local handle = uv.fs_scandir(store)
        local hit = false
        while handle ~= nil and not hit do
            local name, kind = uv.fs_scandir_next(handle)
            if name == nil then
                break
            end
            local is_log = string.match(name, '%.log$') ~= nil
            if kind == 'file' and (is_log or string.match(name, '%.ldb$')) then
                local content = read_file(store .. '/' .. name)
                hit = content ~= nil and (string.find(content, token, 1, true) ~= nil
                    or (is_log and #content > LEVELDB_LOG_BLOCK and string.find(joined_log(content), token, 1, true) ~= nil))
            end
        end
        if hit then
            found[#found + 1] = string.match(dir, '[^/]+$')
        end
    end
    return found
end

-- Which profile this host serves: an extension cannot say, as it does not know the
-- name of its own profile's folder, so it writes a fresh random token to its storage
-- and this host looks for the folder holding it. Answers {data = {dir, name}} once
-- found; the profile is then named in this host's answers to the others.
local function identify(chan, req)
    local token, extension_id = req['token'], req['extensionId']
    if type(token) ~= 'string' or #token < 16 or #token > 128 or string.find(token, '[^%w]') then
        return { error = 'Profile.identify needs a token of 16 to 128 letters and digits' }
    end
    -- part of a path: an extension id is 32 letters a to p
    if type(extension_id) ~= 'string' or #extension_id ~= 32 or string.find(extension_id, '[^a-p]') then
        return { error = 'Profile.identify needs the extension id' }
    end
    peer.answering = true
    if peer.identifying then
        return { error = 'already looking for a token' }
    end
    -- set first: peer_listen asks the extension for a token when it starts listening,
    -- and the extension is already sending this one
    peer.identifying = true
    local ok, err = peer_listen()
    if not ok then
        peer.identifying = false
        return { error = err }
    end
    local id = req['id']
    local attempt = 0
    local function look()
        attempt = attempt + 1
        local found = find_token(peer.udd, extension_id, token)
        if #found == 0 and attempt < IDENTIFY_ATTEMPTS then
            vim.fn.timer_start(IDENTIFY_INTERVAL_MS, look)
            return
        end
        peer.identifying = false
        if #found == 1 then
            peer.profile_dir = found[1]
            local profile = own_profile()
            send_reply(chan, id, true, { data = profile ~= vim.NIL and profile or { dir = found[1] } })
        elseif #found > 1 then
            send_reply(chan, id, true, { error = 'more than one profile holds the token: ' .. table.concat(found, ', ') })
        else
            send_reply(chan, id, true, { error = 'no profile of ' .. peer.udd .. ' holds the token' })
        end
    end
    -- after respond_to has taken this for a deferred reply, as every look is
    vim.schedule(look)
    return DEFERRED
end

-- While the profile is not known -- a scan found nothing, or none ran because the host
-- could not listen -- asks the extension to identify itself again: the next tab list
-- then carries the profile's name. Not while a scan runs, and not often, since each
-- answer is a storage write.
reidentify = function()
    if peer.profile_dir ~= nil or peer.identifying or not peer.answering then
        return
    end
    if peer.asked_at ~= nil and uv.now() - peer.asked_at < REIDENTIFY_GAP_MS then
        return
    end
    peer.asked_at = uv.now()
    ask_extension({ command = 'Profile.identify' }, PEER_SERVE_TIMEOUT_MS, function() end)
end

-- Answers request `line` from another host, through `respond(reply)`: {profile, res},
-- where `res` is what this host's extension answered. Runs in the main loop.
local function answer_peer(line, respond)
    local decoded, req = pcall(vim.fn.json_decode, line)
    if not decoded or type(req) ~= 'table' then
        respond({ profile = vim.NIL, res = { error = 'not a request' } })
        return
    end
    local function reply(res)
        respond({ profile = own_profile(), res = res })
    end
    if not peer.answering then
        reply({ error = 'Surfingkeys in that profile is not connected to its host yet, or too old to share its tabs' })
        return
    end
    if req['command'] == 'Tabs.list' then
        reidentify()
        ask_extension({ command = 'Tabs.list' }, PEER_SERVE_TIMEOUT_MS, reply)
    elseif req['command'] == 'Tabs.activate' then
        if type(req['tabId']) ~= 'number' then
            reply({ error = 'no tab was named' })
            return
        end
        -- At the deadline the extension has the request, and carries it out once it gets
        -- to it: a reply saying the switch failed is then proved wrong by the tab coming
        -- forward. `pending` carries that to the palette, as open_profile's does to the
        -- profile menu.
        ask_extension({ command = 'Tabs.activate', tabId = req['tabId'], windowId = req['windowId'] },
            PEER_SERVE_TIMEOUT_MS, function(res, timed_out)
                if timed_out then
                    res = { pending = true, error = 'Surfingkeys in that profile did not confirm the switch within '
                        .. (PEER_SERVE_TIMEOUT_MS / 1000) .. ' seconds; it may still make it once it responds' }
                end
                reply(res)
            end)
    else
        reply({ error = 'unknown request ' .. tostring(req['command']) })
    end
end

-- Reads one request line from another host on `client`, and writes the answer back.
-- The socket callbacks run where nvim's API may not be called: the answer is made in
-- the main loop.
serve_peer = function(client)
    local buffer, done = '', false
    local function close()
        if not client:is_closing() then
            client:close()
        end
    end
    client:read_start(function(err, chunk)
        if done then
            return
        end
        if err or chunk == nil then
            done = true
            close()
            return
        end
        buffer = buffer .. chunk
        local newline = string.find(buffer, '\n', 1, true)
        if newline == nil then
            if #buffer > PEER_REQUEST_MAX then
                done = true
                close()
            end
            return
        end
        done = true
        client:read_stop()
        local line = string.sub(buffer, 1, newline - 1)
        vim.schedule(function()
            answer_peer(line, function(reply)
                if client:is_closing() then
                    return
                end
                local encoded, text = pcall(vim.fn.json_encode, reply)
                if not encoded then
                    text = vim.fn.json_encode({ profile = vim.NIL, res = { error = 'the host could not encode its answer' } })
                end
                client:write(text .. '\n', close)
            end)
        end)
    end)
end

-- Sends `message` to the host listening at `path` and calls `done(answer)` once, in the
-- main loop, with its decoded answer -- or done(nil, why, gone, timed_out): `gone` when
-- no host listens there any more, `timed_out` when that host was sent the message but
-- did not answer within `timeout_ms`.
local function ask_peer(path, message, timeout_ms, done)
    local line = vim.fn.json_encode(message) .. '\n'
    local pipe = uv.new_pipe(false)
    local timer = uv.new_timer()
    local buffer, settled, sent = '', false, false
    local function finish(text, why, gone, timed_out)
        if settled then
            return
        end
        settled = true
        timer:stop()
        timer:close()
        if not pipe:is_closing() then
            pipe:close()
        end
        vim.schedule(function()
            if text == nil then
                done(nil, why, gone, timed_out == true)
                return
            end
            local decoded, answer = pcall(vim.fn.json_decode, text)
            if decoded and type(answer) == 'table' then
                done(answer)
            else
                done(nil, 'that profile gave an answer that is not one', false)
            end
        end)
    end
    timer:start(timeout_ms, 0, function()
        finish(nil, 'that profile did not answer within ' .. (timeout_ms / 1000) .. ' seconds', false, sent)
    end)
    pipe:connect(path, function(err)
        if err then
            -- Refused: the host that made it died without removing it (a host killed
            -- outright does), and the next one to look would try it again. Removed only
            -- when no process has its pid either: macOS also refuses a connection to a
            -- live host whose queue of them is full, and removing that one's socket
            -- would hide its profile until it restarts.
            if string.find(err, 'ECONNREFUSED', 1, true) then
                local pid = tonumber(string.match(path, '(%d+)%.sock$'))
                local _, kerr = nil, nil
                if pid ~= nil and pid > 0 then
                    _, kerr = uv.kill(pid, 0)
                end
                if type(kerr) == 'string' and string.find(kerr, 'ESRCH', 1, true) then
                    uv.fs_unlink(path)
                end
                finish(nil, 'that profile is no longer open', true)
            elseif string.find(err, 'ENOENT', 1, true) then
                finish(nil, 'that profile is no longer open', true)
            else
                finish(nil, 'could not reach that profile: ' .. err, false)
            end
            return
        end
        pipe:read_start(function(rerr, chunk)
            if rerr or chunk == nil then
                finish(nil, 'that profile closed the connection without answering', false)
                return
            end
            buffer = buffer .. chunk
            local newline = string.find(buffer, '\n', 1, true)
            if newline ~= nil then
                finish(string.sub(buffer, 1, newline - 1))
            elseif #buffer > PEER_REPLY_MAX then
                finish(nil, 'that profile answered with too much', false)
            end
        end)
        pipe:write(line)
        sent = true
    end)
end

-- The sockets of the other hosts of this browser: {pid, path} each.
local function peer_sockets()
    local list = {}
    local handle = uv.fs_scandir(peer.dir)
    while handle ~= nil do
        local name = uv.fs_scandir_next(handle)
        if name == nil then
            break
        end
        local pid = tonumber(string.match(name, '^(%d+)%.sock$'))
        local path = peer.dir .. '/' .. name
        if pid ~= nil and path ~= peer.path then
            list[#list + 1] = { pid = pid, path = path }
        end
    end
    return list
end

-- One entry of the Peers.tabs answer, from what the host with pid `pid` answered.
local function peer_entry(pid, answer, why)
    if answer == nil then
        return { peer = pid, profile = vim.NIL, tabs = {}, error = why }
    end
    local profile = type(answer['profile']) == 'table' and answer['profile'] or vim.NIL
    local res = answer['res']
    if type(res) == 'table' and type(res['data']) == 'table' and type(res['data']['tabs']) == 'table' then
        local tabs = {}
        for _, tab in ipairs(res['data']['tabs']) do
            if type(tab) == 'table' then
                tabs[#tabs + 1] = tab
            end
        end
        return { peer = pid, profile = profile, tabs = tabs }
    end
    local said = type(res) == 'table' and res['error'] or nil
    return { peer = pid, profile = profile, tabs = {}, error = type(said) == 'string' and said or 'that profile listed no tabs' }
end

-- The other profiles in the order of the browser's profile menu, unnamed ones last.
local function order_peers(entries)
    local profiles = read_profiles(peer.udd)
    local rank = {}
    for i, p in ipairs(profiles and profiles.list or {}) do
        rank[p.dir] = i
    end
    local function rank_of(entry)
        local dir = type(entry.profile) == 'table' and entry.profile.dir or nil
        return rank[dir] or math.huge
    end
    table.sort(entries, function(a, b)
        if rank_of(a) ~= rank_of(b) then
            return rank_of(a) < rank_of(b)
        end
        return a.peer < b.peer
    end)
    return entries
end

-- Shortens `entries` until the reply fits in one native message: favicons go first,
-- then a quarter of the longest list at a time, from its least recently used end.
-- The palette loses the oldest tabs of a profile with thousands, rather than the
-- connection everything else uses.
local function fit_peers(id, entries)
    local function size()
        local ok, text = pcall(vim.fn.json_encode, { status = true, id = id, res = { data = { peers = entries } } })
        return ok and #text or 0
    end
    local budget = NATIVE_MESSAGE_MAX - 1024
    if size() <= budget then
        return entries
    end
    for _, entry in ipairs(entries) do
        for _, tab in ipairs(entry.tabs) do
            tab['favIconUrl'] = nil
        end
    end
    while size() > budget do
        local longest = nil
        for _, entry in ipairs(entries) do
            if longest == nil or #entry.tabs > #longest.tabs then
                longest = entry
            end
        end
        if longest == nil or #longest.tabs == 0 then
            return {}
        end
        for i = #longest.tabs, math.floor(#longest.tabs * 3 / 4) + 1, -1 do
            longest.tabs[i] = nil
        end
    end
    return entries
end

-- Every other open profile's tabs: {data = {peers = [{peer, profile, tabs}]}}, `peer`
-- being the pid that Peers.activate names it by. A host that does not answer in time
-- is listed with an `error` and no tabs; a socket nothing listens on is left out.
local function peers_tabs(chan, req)
    local ok, err = peer_listen()
    if not ok then
        return { error = err }
    end
    local others = peer_sockets()
    if #others == 0 then
        return { data = { peers = {} } }
    end
    local id = req['id']
    local entries, left = {}, #others
    for i, other in ipairs(others) do
        ask_peer(other.path, { command = 'Tabs.list' }, PEER_LIST_TIMEOUT_MS, function(answer, why, gone)
            entries[i] = (not gone) and peer_entry(other.pid, answer, why) or false
            left = left - 1
            if left > 0 then
                return
            end
            local open = {}
            for _, entry in ipairs(entries) do
                if entry then
                    open[#open + 1] = entry
                end
            end
            send_reply(chan, id, true, { data = { peers = fit_peers(id, order_peers(open)) } },
                'Peers.tabs, ' .. #open .. ' other profiles')
        end)
    end
    return DEFERRED
end

-- Switches to tab `req.tabId` of the profile whose host is `req.peer`, and answers with
-- what that profile's Surfingkeys observed afterwards, or why it could not -- `pending`
-- when that host had the request and did not answer in time, as it may still carry it
-- out once its own work lets it.
local function peers_activate(chan, req)
    local pid = req['peer']
    if type(pid) ~= 'number' or pid <= 0 or pid ~= math.floor(pid) then
        return { error = 'no profile was named' }
    end
    if type(req['tabId']) ~= 'number' then
        return { error = 'no tab was named' }
    end
    local ok, err = peer_listen()
    if not ok then
        return { error = err }
    end
    local path = peer.dir .. '/' .. string.format('%d', pid) .. '.sock'
    if path == peer.path then
        return { error = 'that tab is in this profile' }
    end
    local id = req['id']
    ask_peer(path, { command = 'Tabs.activate', tabId = req['tabId'], windowId = req['windowId'] },
        PEER_ACTIVATE_TIMEOUT_MS, function(answer, why, gone, timed_out)
            local res = answer and answer['res']
            if answer == nil then
                res = timed_out and { pending = true, error = why .. '; it may still switch to the tab once it responds' }
                    or { error = why }
            elseif type(res) ~= 'table' then
                res = { error = 'Surfingkeys in that profile gave no answer' }
            end
            send_reply(chan, id, true, res)
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
    local decoded, req = pcall(vim.fn.json_decode, text)
    -- The extension's answer to a request of this host's own (ask_extension), never a
    -- request itself: a reply to it would reach the extension as the answer to
    -- whatever it asked last. Logged by size only, since it holds tab titles and URLs.
    if decoded and type(req) == "table" and req['peerReply'] ~= nil then
        logw("stdin: peerReply " .. tostring(req['peerReply']) .. ", " .. #text .. " bytes\n")
        local finish = extension_waiting[req['peerReply']]
        if finish ~= nil then
            local said = req['res']
            if req['status'] ~= true then
                said = { error = type(said) == "string" and said or "Surfingkeys in that profile failed to answer" }
            elseif type(said) ~= "table" then
                said = { error = "Surfingkeys in that profile gave no answer" }
            end
            finish(said)
        end
        return
    end
    logw("stdin: " .. text .. "\n")
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
    elseif data['command'] == 'Profile.identify' then
        return identify(id, data)
    elseif data['command'] == 'Peers.tabs' then
        return peers_tabs(id, data)
    elseif data['command'] == 'Peers.activate' then
        return peers_activate(id, data)
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
                surfingkeys_peer_close()
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
    -- The other hosts of this browser find this one from the start, the palette in
    -- another profile not waiting for this profile's first request, and again after
    -- its socket was lost (see PEER_RELISTEN_INTERVAL_MS). Scheduled, so the search for
    -- the browser's data directory does not hold up the first reply.
    vim.cmd('autocmd VimLeavePre * lua surfingkeys_peer_close()')
    vim.schedule(keep_listening)
    relisten_timer = vim.fn.timer_start(PEER_RELISTEN_INTERVAL_MS, function()
        keep_listening()
    end, { ['repeat'] = -1 })
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
