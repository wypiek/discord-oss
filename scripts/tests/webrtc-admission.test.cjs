const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const WS = require("ws");
const { once } = require("node:events");

function load(file, imports, timers = {}) {
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, {
        module,
        exports: module.exports,
        Buffer,
        process,
        Date,
        URL,
        console: { log() {}, error() {} },
        setTimeout,
        clearTimeout,
        ...timers,
        require(name) {
            return imports[name] ?? require(name);
        },
    });
    return module.exports;
}
const codes = { Decode_error: 4002, Unknown_opcode: 4001, Not_authenticated: 4003, Session_timed_out: 4009 };
const ops = { IDENTIFY: 0, RESUME: 7, HEARTBEAT: 3, SPEAKING: 5, HELLO: 8 };

function fixture(identify) {
    let cleared = 0;
    const message = load(
        "src/webrtc/events/Message.ts",
        {
            "@spacebar/gateway": { CLOSECODES: codes },
            "../util": { VoiceOPCodes: ops },
            "../opcodes": { default: undefined, 0: identify, 3: async () => {} },
        },
        {
            clearTimeout() {
                cleared++;
            },
        },
    ).onMessage;
    const socket = {
        readyState: 1,
        authenticationTimeout: 1,
        close(code) {
            this.closed = code;
            this.readyState = 2;
        },
    };
    return { socket, message, cleared: () => cleared };
}

test("invalid identify closes and cannot cancel authentication deadline", async () => {
    const { socket, message, cleared } = fixture(async () => {
        throw new Error("invalid identify");
    });
    await message.call(socket, Buffer.from('{"op":0,"d":{}}'), false);
    assert.equal(socket.closed, 4002);
    assert.equal(cleared(), 0);
});

test("heartbeats cannot complete authentication while identify is pending", async () => {
    let finish;
    const { socket, message, cleared } = fixture(async function () {
        this.user_id = "user";
        await new Promise((resolve) => {
            finish = resolve;
        });
    });
    const pending = message.call(socket, Buffer.from('{"op":0}'), false);
    await message.call(socket, Buffer.from('{"op":3,"d":1}'), false);
    assert.equal(cleared(), 0);
    finish();
    await pending;
    assert.equal(cleared(), 1);
});

test("preauthentication command floods close the socket", async () => {
    const { socket, message } = fixture(async () => {});
    for (let i = 0; i < 11; i++) await message.call(socket, Buffer.from('{"op":3,"d":1}'), false);
    assert.equal(socket.closed, 4008);
});

test("real loopback websocket heartbeats cannot extend authentication deadline", async () => {
    const connection = load(
        "src/webrtc/events/Connection.ts",
        {
            "@spacebar/gateway": { CLOSECODES: codes, setHeartbeat() {} },
            "../util": { VoiceOPCodes: ops, Send: async () => {} },
            "./Close": {
                onClose() {
                    clearTimeout(this.authenticationTimeout);
                },
            },
            "./Message": { onMessage() {} },
        },
        {
            setTimeout(callback) {
                return setTimeout(callback, 100);
            },
        },
    ).Connection;
    const server = new WS.Server({ port: 0, host: "127.0.0.1", maxPayload: 1024 * 1024 });
    server.on("connection", connection);
    await once(server, "listening");
    const client = new WS(`ws://127.0.0.1:${server.address().port}/?v=8`);
    await once(client, "open");
    const timer = setInterval(() => client.send('{"op":3,"d":1}'), 10);
    try {
        await once(client, "close");
    } finally {
        clearInterval(timer);
        await new Promise((resolve) => server.close(resolve));
    }
    assert.equal(client.readyState, WS.CLOSED);
});
