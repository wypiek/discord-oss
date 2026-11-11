const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, imports) {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        console: { log() {}, error() {} },
        BigInt,
        Date,
        setTimeout,
        clearTimeout,
        require: (name) => imports[name] ?? require(name),
    });
    return module.exports;
}

async function connect(stored = { guild_id: "guild", channel_id: "lobby" }) {
    const listeners = [];
    const ended = [];
    const moderated = [];
    const client = {
        emitter: { once() {} },
        initIncomingSSRCs() {},
        moderate: (moderation) => moderated.push(moderation),
    };
    const { onIdentify } = load("src/webrtc/opcodes/Identify.ts", {
        typeorm: { IsNull: () => null, Not: (value) => value },
        "@spacebar/database": {
            VoiceState: { findOne: async () => ({ ...stored, user_id: "user", session_id: "session", token: "token", mute: false, deaf: false, suppress: false }) },
            Guild: { exists: async () => false },
            Channel: { exists: async () => false, findOne: async () => ({ id: stored.channel_id, type: 2 }) },
            StreamSession: {},
            GoLiveStreams: {},
            Member: {},
            Recipient: {},
            User: {},
        },
        "@spacebar/gateway": { CLOSECODES: { Authentication_failed: 4004 } },
        "@spacebar/schemas": { ChannelType: { GUILD_STAGE_VOICE: 13 }, validateSchema: (_, data) => data },
        "@spacebar/util": {
            FederatedVoice: {},
            getPermission: async () => ({ has: () => true }),
            listenEvent: async (_, listener) => {
                listeners.push(listener);
                return async () => {};
            },
        },
        "@spacebar/webrtc": {
            generateSsrc: () => 1,
            mediaServer: { join: async () => client, port: 1, ip: "127.0.0.1" },
            Send: async () => {},
            VoiceOPCodes: { READY: 2 },
        },
        "./Video": { subscribeToProducers: async () => {} },
        "./Speaking": { relaySpeaking: async () => {} },
        "../util/VoiceSessions": {
            VoiceSessions: {
                register: async () => {},
                find: () => undefined,
                end: async (socket) => {
                    socket.sessionEnded = true;
                    ended.push(socket);
                },
            },
        },
        "../util/DaveIdentity": { daveIdOf: async () => "1" },
    });
    const socket = {
        readyState: 1,
        close(code) {
            this.closed = code;
            this.readyState = 3;
        },
    };
    const server_id = stored.guild_id ?? stored.channel_id;
    await onIdentify.call(socket, { op: 0, d: { server_id, user_id: "user", session_id: "session", token: "token" } });
    assert.equal(socket.closed, undefined);
    assert.equal(listeners.length, 1);
    const emit = (data) => listeners[0]({ event: "VOICE_STATE_UPDATE", data: { user_id: "user", session_id: "session", ...data } });
    return { socket, emit, ended, moderated };
}

test("a moderator disconnect ends the voice session and closes it with 4014", async () => {
    const { socket, emit, ended } = await connect();
    await emit({ guild_id: "guild", channel_id: null });
    assert.deepEqual(ended, [socket]);
    assert.equal(socket.closed, 4014);
});

test("a move to another channel ends the media session in the old channel", async () => {
    const { socket, emit, ended } = await connect();
    await emit({ guild_id: "guild", channel_id: "elsewhere" });
    assert.deepEqual(ended, [socket]);
    assert.equal(socket.closed, 4014);
});

test("joining voice from another gateway session ends the old voice session", async () => {
    const { socket, emit, ended } = await connect();
    await emit({ guild_id: "guild", channel_id: "lobby", session_id: "other" });
    assert.deepEqual(ended, [socket]);
});

test("a server mute in the same channel moderates without ending the session", async () => {
    const { socket, emit, ended, moderated } = await connect();
    await emit({ guild_id: "guild", channel_id: "lobby", mute: true });
    assert.deepEqual(ended, []);
    assert.equal(socket.closed, undefined);
    assert.equal(moderated.at(-1).mute, true);
});

test("the resumed socket is the one that gets ended", async () => {
    const { socket, emit, ended } = await connect();
    const resumed = { readyState: 1, close: socket.close };
    socket.resumedBy = resumed;
    await emit({ guild_id: "guild", channel_id: null });
    assert.deepEqual(ended, [resumed]);
    assert.equal(resumed.closed, 4014);
});

test("leaving a group call ends the voice session", async () => {
    const { socket, emit, ended } = await connect({ guild_id: null, channel_id: "call" });
    await emit({ guild_id: null, channel_id: null });
    assert.deepEqual(ended, [socket]);
    assert.equal(socket.closed, 4014);
});
