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
        Math,
        setTimeout,
        clearTimeout,
        require: (name) => {
            if (!(name in imports)) throw new Error(`unexpected import ${name}`);
            return imports[name];
        },
    });
    return module.exports;
}

const permissionsFor = (granted) => async () => ({ has: (flag) => granted.includes(flag) });

async function identify(granted) {
    const moderated = [];
    const client = { emitter: { once() {} }, initIncomingSSRCs() {}, moderate: (moderation) => moderated.push(moderation) };
    const { onIdentify } = load("src/webrtc/opcodes/Identify.ts", {
        typeorm: { IsNull: () => null, Not: (value) => value },
        "@spacebar/database": {
            VoiceState: {
                findOne: async () => ({
                    guild_id: "guild",
                    channel_id: "lobby",
                    user_id: "user",
                    session_id: "session",
                    token: "token",
                    mute: false,
                    deaf: false,
                    suppress: false,
                }),
            },
            Guild: { exists: async () => false },
            Channel: { findOne: async () => ({ id: "lobby", type: 2 }) },
            StreamSession: {},
            GoLiveStreams: {},
            Member: {},
            Recipient: {},
            User: {},
        },
        "@spacebar/gateway": { CLOSECODES: { Authentication_failed: 4004 } },
        "@spacebar/schemas": { ChannelType: { GUILD_STAGE_VOICE: 13 }, validateSchema: (_, data) => data },
        "@spacebar/util": { FederatedVoice: {}, getPermission: permissionsFor(granted), listenEvent: async () => async () => {} },
        "@spacebar/webrtc": { generateSsrc: () => 1, mediaServer: { join: async () => client, port: 1, ip: "127.0.0.1" }, Send: async () => {}, VoiceOPCodes: { READY: 2 } },
        "./Video": { subscribeToProducers: async () => {} },
        "./Speaking": { relaySpeaking: async () => {} },
        "../util/VoiceSessions": { VoiceSessions: { register: async () => {}, find: () => undefined, end: async () => {} } },
        "../util/DaveIdentity": { daveIdOf: async () => "1" },
    });
    const socket = { readyState: 1, close() {} };
    await onIdentify.call(socket, { op: 0, d: { server_id: "guild", user_id: "user", session_id: "session", token: "token" } });
    return moderated;
}

test("the SFU blocks camera video from a member without the video permission", async () => {
    const [moderation] = await identify(["VIEW_CHANNEL", "CONNECT"]);
    assert.equal(moderation.video, true);
});

test("the SFU forwards camera video from a member with the video permission", async () => {
    const [moderation] = await identify(["VIEW_CHANNEL", "CONNECT", "STREAM"]);
    assert.equal(moderation.video, false);
});

async function joinWithVideo(granted) {
    let saved;
    const state = {
        save: async function () {
            saved = { ...this };
        },
        toPublicVoiceState() {
            return {};
        },
    };
    const { applyVoiceStateUpdate } = load("src/gateway/opcodes/VoiceStateUpdate.ts", {
        "@spacebar/database": {
            Channel: { findOne: async () => ({ id: "lobby", type: 2, guild_id: "guild" }) },
            Member: { findOne: async () => ({ toPublicMember: () => ({}) }) },
            VoiceState: { findOne: async () => null, create: (fields) => Object.assign(state, fields), count: async () => 0 },
            VoiceChannels: { occupancyChanged: async () => {} },
            Guild: { findOne: async () => ({ id: "guild" }) },
            Recipient: {},
            Relationship: {},
            User: {},
        },
        "@spacebar/gateway": { genVoiceToken: () => "token" },
        "@spacebar/util": {
            Config: { get: () => ({ login: {}, regions: { default: "local", available: [{ id: "local", endpoint: "127.0.0.1" }] } }) },
            emitEvent: async () => {},
            FederatedVoice: { setApplier() {} },
            getPermission: permissionsFor(granted),
            requiredAction: () => null,
        },
        "@spacebar/schemas": { ChannelType: { GUILD_VOICE: 2, GUILD_STAGE_VOICE: 13, DM: 1, GROUP_DM: 3 } },
        "./instanceOf": { check() {} },
    });
    await applyVoiceStateUpdate("user", "session", { guild_id: "guild", channel_id: "lobby", self_mute: false, self_deaf: false, self_video: true });
    return saved;
}

test("the gateway refuses self_video without the video permission", async () => {
    assert.equal((await joinWithVideo(["VIEW_CHANNEL", "CONNECT"])).self_video, false);
});

test("the gateway keeps self_video with the video permission", async () => {
    assert.equal((await joinWithVideo(["VIEW_CHANNEL", "CONNECT", "STREAM"])).self_video, true);
});
