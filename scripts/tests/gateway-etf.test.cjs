const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const zlib = require("node:zlib");
const ts = require("typescript");
const { packEtf, unpackEtf } = require("../../dist/gateway/util/Etf.js");
const { ZstdStreamEncoder, ZstdStreamDecoder } = require("../../dist/gateway/util/ZstdStream.js");
const { JSONStringify } = require("../../dist/util/util/JSON.js");

const bytes = (...values) => Buffer.from(values.flatMap((value) => (typeof value === "string" ? [...Buffer.from(value)] : [value])));
const atom = (name) => [115, name.length, name];

test("empty lists use NIL_EXT like Discord's erlpack and decode back to arrays", () => {
    assert.deepEqual(packEtf([]), bytes(131, 106));
    assert.deepEqual(unpackEtf(bytes(131, 106)), []);
    assert.deepEqual(unpackEtf(packEtf({ activities: [], guilds: [[]] })), { activities: [], guilds: [[]] });
});

test("null and booleans are atoms and come back as null and booleans", () => {
    assert.deepEqual(packEtf(null), bytes(131, ...atom("nil")));
    assert.deepEqual(packEtf(true), bytes(131, ...atom("true")));
    assert.equal(unpackEtf(bytes(131, ...atom("nil"))), null);
    assert.equal(unpackEtf(bytes(131, ...atom("null"))), null);
    assert.equal(unpackEtf(bytes(131, 119, 5, "false")), false);
    assert.equal(unpackEtf(bytes(131, 100, 0, 4, "true")), true);
});

test("maps skip undefined values without breaking the arity", () => {
    const packed = packEtf({ a: 1, b: undefined, c: () => 1, d: null });
    assert.equal(packed.readUInt32BE(2), 2);
    assert.deepEqual(unpackEtf(packed), { a: 1, d: null });
    assert.deepEqual(unpackEtf(packEtf({})), {});
});

test("integers pick the smallest exact term and survive a round trip", () => {
    assert.deepEqual(packEtf(0), bytes(131, 97, 0));
    assert.deepEqual(packEtf(255), bytes(131, 97, 255));
    assert.deepEqual(packEtf(256), bytes(131, 98, 0, 0, 1, 0));
    assert.deepEqual(packEtf(-1), bytes(131, 98, 255, 255, 255, 255));
    assert.deepEqual(packEtf(2 ** 31), bytes(131, 110, 4, 0, 0, 0, 0, 128));
    for (const value of [0, 1, 255, 256, -1, -(2 ** 31), 2 ** 31, 2 ** 32, 1760536800000, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 1.5, -0.25])
        assert.equal(unpackEtf(packEtf(value)), value, String(value));
    assert.equal(packEtf(1760536800000)[1], 110, "millisecond timestamps are integers, not floats");
});

test("bigints beyond the safe range stay exact and snowflake strings stay strings", () => {
    const snowflake = 1560322975004192834n;
    assert.equal(unpackEtf(packEtf(snowflake)), snowflake);
    assert.equal(unpackEtf(packEtf(-snowflake)), -snowflake);
    assert.equal(unpackEtf(packEtf(String(snowflake))), String(snowflake));
    assert.equal(unpackEtf(bytes(131, 111, 0, 0, 0, 1, 0, 7)), 7);
});

test("strings are UTF-8 binaries at every length", () => {
    for (const value of ["", "meow", "ñ".repeat(150), "🏳️‍🌈".repeat(40)]) assert.equal(unpackEtf(packEtf(value)), value);
    assert.equal(unpackEtf(bytes(131, 107, 0, 3, "abc")), "abc");
});

test("Discord-style client frames with atom keys decode into plain payloads", () => {
    const frame = bytes(
        131,
        116,
        0,
        0,
        0,
        2,
        ...atom("op"),
        97,
        14,
        ...atom("d"),
        116,
        0,
        0,
        0,
        2,
        109,
        0,
        0,
        0,
        8,
        "guild_id",
        109,
        0,
        0,
        0,
        1,
        "1",
        109,
        0,
        0,
        0,
        8,
        "channels",
        116,
        0,
        0,
        0,
        0,
    );
    assert.deepEqual(unpackEtf(frame), { op: 14, d: { guild_id: "1", channels: {} } });
    const tuple = bytes(131, 104, 2, 97, 0, 97, 99);
    assert.deepEqual(unpackEtf(tuple), [0, 99]);
});

test("malformed frames throw instead of returning partial data", () => {
    assert.throws(() => unpackEtf(bytes(130, 106)));
    assert.throws(() => unpackEtf(bytes(131, 109, 0, 0, 0, 9, "abc")));
    assert.throws(() => unpackEtf(bytes(131, 106, 106)));
    assert.throws(() => unpackEtf(bytes(131, 108, 255, 255, 255, 255)));
    assert.throws(() => unpackEtf(bytes(131, 116, 0, 0, 0, 1, 109, 0, 0, 0, 9, "__proto__", 97, 1)));
    assert.throws(() => unpackEtf(bytes(131, ...Array(300).fill([108, 0, 0, 0, 1]).flat(), 106)));
    assert.throws(() => unpackEtf(bytes(131, 80, 0, 0, 0, 0)));
    assert.throws(() => unpackEtf(bytes(131, 111, 0, 0, 0x30, 0, 0, ...Array(0x3000).fill(1))), RangeError);
    assert.equal(unpackEtf(bytes(131, 110, 32, 0, ...Array(32).fill(0))), 0);
});

test("zstd-stream keeps one frame open and flushes every message", () => {
    const encoder = new ZstdStreamEncoder(6);
    const decoder = new ZstdStreamDecoder();
    const message = JSON.stringify({ op: 0, t: "MESSAGE_CREATE", d: { content: "hello from android".repeat(4) } });
    const first = encoder.process(message);
    const second = encoder.process(message);
    assert.deepEqual(first.subarray(0, 4), Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
    assert.notDeepEqual(second.subarray(0, 4), Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), "the second message continues the first frame");
    assert.ok(second.length < first.length / 2, `${second.length} vs ${first.length}`);
    assert.equal(decoder.process(first).toString(), message);
    assert.equal(decoder.process(second).toString(), message);
    encoder.destroy();
    encoder.destroy();
    assert.throws(() => encoder.process(message));
});

test("Send encodes ETF from the same JSON the json encoding sends, through zstd-stream", async () => {
    const source = fs.readFileSync(path.join(__dirname, "../../src/gateway/util/Send.ts"), "utf8");
    const module = { exports: {} };
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
        module,
        exports: module.exports,
        require: (id) =>
            ({
                "@spacebar/gateway": {},
                "node:fs/promises": {},
                "node:path": {},
                "@spacebar/util": { JSONStringify },
                "./Etf": { packEtf },
                "./GatewayIntents": { filterBotDispatch: (_, data) => data },
                "./SessionResume": {
                    resolveSocket: (socket) => socket,
                    rememberDispatch() {},
                    notePayloadSize() {},
                    bufferForResume: () => false,
                    boundedDispatchPush: () => true,
                },
            })[id],
        process: { env: {} },
        Buffer,
    });
    const frames = [];
    const socket = {
        encoding: "etf",
        compress: "zstd-stream",
        zstdEncoder: new ZstdStreamEncoder(6),
        readyState: 1,
        bufferedAmount: 0,
        send: (data, done) => {
            frames.push(data);
            done();
        },
        close() {},
    };
    const entity = { secret: "hidden", toJSON: () => ({ id: "1" }) };
    const payload = {
        op: 0,
        t: "MESSAGE_CREATE",
        s: 1,
        d: { id: "1560322975004192834", timestamp: new Date(0), edited_timestamp: null, nonce: undefined, attachments: [], author: entity },
    };
    await module.exports.Send(socket, payload);
    await module.exports.Send(socket, { op: 11 });
    const decompress = zlib.createZstdDecompress();
    const decoded = await new Promise((resolve, reject) => {
        const chunks = [];
        decompress.on("data", (chunk) => chunks.push(chunk));
        decompress.on("error", reject);
        decompress.write(Buffer.concat(frames), () => setTimeout(() => resolve(Buffer.concat(chunks)), 20));
    });
    const first = unpackEtf(decoded.subarray(0, decoded.length - packEtf({ op: 11 }).length));
    assert.deepEqual(first, JSON.parse(JSONStringify(payload)));
    assert.equal(first.d.timestamp, "1970-01-01T00:00:00.000+00:00");
    assert.deepEqual(first.d.author, { id: "1" });
    assert.ok(!("nonce" in first.d));
    assert.equal(payload.d.timestamp instanceof Date, true, "the shared payload is not mutated");
    socket.zstdEncoder.destroy();
});
