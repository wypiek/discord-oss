const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");

function loadSend() {
    const module = { exports: {} };
    const serialized = [];
    const sizes = new Map();
    const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../..", "src/gateway/util/Send.ts"), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const mocks = {
        "@spacebar/gateway": {},
        "@spacebar/util": {
            JSONStringify: (value) => {
                serialized.push(value);
                return JSON.stringify(value);
            },
        },
        "./SessionResume": {
            boundedDispatchPush: () => true,
            bufferForResume: () => false,
            notePayloadSize: (payload, bytes) => sizes.set(payload, bytes),
            rememberDispatch() {},
            resolveSocket: (socket) => socket,
        },
        "./GatewayIntents": { filterBotDispatch: (_, payload) => payload },
        "./Etf": { packEtf: (value) => Buffer.from(JSON.stringify(value)) },
    };
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        require: (name) => (Object.hasOwn(mocks, name) ? mocks[name] : require(name)),
        process,
        Buffer,
        console,
    });
    return { Send: module.exports.Send, serialized, sizes };
}

const socket = () => {
    const frames = [];
    return {
        frames,
        encoding: "json",
        readyState: 1,
        bufferedAmount: 0,
        send: (frame, done) => {
            frames.push(frame);
            done();
        },
        close() {},
    };
};

test("one dispatch to 1,000 sockets serializes its data once and keeps each socket's sequence", async () => {
    const { Send, serialized, sizes } = loadSend();
    const d = { id: "1", content: "hello", timestamp: new Date(0), nested: { list: [1, 2, 3] } };
    const sockets = Array.from({ length: 1000 }, socket);
    const payloads = sockets.map((_, s) => ({ op: 0, t: "MESSAGE_CREATE", d, s }));
    await Promise.all(sockets.map((target, i) => Send(target, payloads[i])));
    assert.equal(serialized.filter((value) => value === d).length, 1);
    assert.equal(serialized.length, 1);
    sockets.forEach((target, s) => {
        assert.equal(target.frames.length, 1);
        assert.deepEqual(JSON.parse(target.frames[0]), JSON.parse(JSON.stringify({ op: 0, t: "MESSAGE_CREATE", d, s })));
        assert.equal(sizes.get(payloads[s]), Buffer.byteLength(target.frames[0]));
    });
});

test("payloads without a sequence or with primitive data serialize whole", async () => {
    const { Send, serialized } = loadSend();
    const target = socket();
    await Send(target, { op: 11, d: {} });
    await Send(target, { op: 7, d: 1000, s: 4 });
    await Send(target, { op: 0, t: "RESUMED", d: {}, s: 5 });
    assert.deepEqual(
        target.frames.map((frame) => JSON.parse(frame)),
        [
            { op: 11, d: {} },
            { op: 7, d: 1000, s: 4 },
            { op: 0, t: "RESUMED", d: {}, s: 5 },
        ],
    );
    assert.equal(serialized.length, 3);
});
