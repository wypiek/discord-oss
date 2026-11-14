const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, mocks) {
    const context = { exports: {}, require: (name) => mocks[name], console: { log() {} }, clearTimeout() {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
        context,
    );
    return context.exports;
}

function createFixture() {
    const created = [];
    const permissions = new Set(["VIEW_CHANNEL", "CONNECT", "STREAM"]);
    const state = { user_id: "user", channel_id: "voice", guild_id: "guild" };
    const mocks = {
        "@spacebar/database": {
            VoiceState: { findOne: async () => state },
            Member: { exists: async () => true, findOneOrFail: async () => ({}) },
            Channel: { findOne: async () => ({ id: "voice", guild_id: "guild" }) },
            Stream: {
                findOne: async () => null,
                delete: async () => {},
                create: (value) => {
                    created.push(value);
                    throw new Error("authorized creation");
                },
            },
        },
        typeorm: { Not: (value) => ({ not: value }) },
        "@spacebar/gateway": {},
        "@spacebar/util": {
            getPermission: async () => ({ has: (name) => permissions.has(name) }),
            Config: { get: () => ({ regions: { default: "local", available: [{ id: "local" }] } }) },
            Snowflake: { generate: () => "stream" },
        },
        "@spacebar/schemas": {},
        "./instanceOf": { check() {} },
    };
    return { ...load("src/gateway/opcodes/StreamCreate.ts", mocks), state, permissions, created };
}

test("stream creation binds authorization to the current voice channel", async () => {
    const fixture = createFixture();
    await fixture.onStreamCreate.call({ user_id: "user" }, { d: { channel_id: "foreign", guild_id: "guild", type: "guild" } });
    assert.equal(fixture.created.length, 0);
    await assert.rejects(fixture.onStreamCreate.call({ user_id: "user" }, { d: { channel_id: "voice", guild_id: "guild", type: "guild" } }), /authorized creation/);
    assert.equal(fixture.created.length, 1);
});

function restartFixture(session) {
    const events = [];
    const deleted = [];
    const createdSessions = [];
    const running = { id: "100", owner_id: "user", channel_id: "voice", endpoint: "localhost:3001" };
    const mocks = {
        "@spacebar/database": {
            VoiceState: { findOne: async () => ({ user_id: "user", channel_id: "voice", guild_id: "guild", save: async () => {}, toPublicVoiceState: () => ({}) }) },
            Member: { exists: async () => true, findOneOrFail: async () => ({ toPublicMember: () => ({}) }) },
            Channel: { findOne: async () => ({ id: "voice", guild_id: "guild" }) },
            Stream: {
                findOne: async ({ where }) => (where.channel_id === "voice" ? running : null),
                delete: async (where) => deleted.push(where),
                create: () => {
                    throw new Error("a running stream was replaced");
                },
            },
            StreamSession: {
                find: async () => [{ user_id: "viewer" }, { user_id: "viewer" }],
                findOne: async () => session,
                create: (value) => ({
                    ...value,
                    used: false,
                    save: async function () {
                        createdSessions.push(value);
                        return this;
                    },
                }),
            },
        },
        typeorm: { Not: (value) => ({ not: value }) },
        "@spacebar/gateway": { genVoiceToken: () => "fresh-token", generateStreamKey: () => "guild:guild:voice:user" },
        "@spacebar/util": {
            getPermission: async () => ({ has: () => true }),
            Config: { get: () => ({ regions: { default: "local", available: [{ id: "local", name: "local" }] } }) },
            Snowflake: { generate: () => "new" },
            emitEvent: async (event) => events.push(event),
        },
        "@spacebar/schemas": {},
        "./instanceOf": { check() {} },
    };
    return { ...load("src/gateway/opcodes/StreamCreate.ts", mocks), events, deleted, createdSessions };
}

test("creating a stream again while it runs keeps its server and connection", async () => {
    const fixture = restartFixture({ token: "live-token", used: true });
    await fixture.onStreamCreate.call({ user_id: "user", session_id: "gateway-session" }, { d: { channel_id: "voice", guild_id: "guild", type: "guild" } });
    const create = fixture.events.find((event) => event.event === "STREAM_CREATE");
    assert.equal(create.data.rtc_server_id, "100");
    assert.deepEqual([...create.data.viewer_ids], ["viewer"]);
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.deleted)), [{ owner_id: "user", id: { not: "100" } }]);
    assert.equal(fixture.createdSessions.length, 0);
    assert.ok(!fixture.events.some((event) => event.event === "STREAM_SERVER_UPDATE"));
});

test("creating a stream again from a session without a connection hands out a token for the same server", async () => {
    const fixture = restartFixture(null);
    await fixture.onStreamCreate.call({ user_id: "user", session_id: "gateway-session" }, { d: { channel_id: "voice", guild_id: "guild", type: "guild" } });
    assert.equal(fixture.events.find((event) => event.event === "STREAM_CREATE").data.rtc_server_id, "100");
    assert.equal(fixture.createdSessions.length, 1);
    assert.equal(fixture.events.find((event) => event.event === "STREAM_SERVER_UPDATE").data.token, "fresh-token");
});

test("stream creation requires all current channel permissions", async () => {
    for (const denied of ["VIEW_CHANNEL", "CONNECT", "STREAM"]) {
        const fixture = createFixture();
        fixture.permissions.delete(denied);
        await fixture.onStreamCreate.call({ user_id: "user" }, { d: { channel_id: "voice", guild_id: "guild", type: "guild" } });
        assert.equal(fixture.created.length, 0);
    }
});

function identifyFixture(owner = false) {
    let claims = 0;
    let joins = 0;
    let member = true;
    const permissions = new Set(["VIEW_CHANNEL", "CONNECT", "STREAM"]);
    const socket = {
        readyState: 1,
        close(code) {
            this.closed = code;
        },
    };
    const mocks = {
        "@spacebar/database": {
            VoiceState: { findOne: async () => null },
            StreamSession: {
                findOne: async () => ({ id: "session", stream: { channel_id: "voice", owner_id: owner ? "user" : "owner" } }),
                update: async () => {
                    claims++;
                    return { affected: 1 };
                },
            },
            Channel: { findOne: async () => ({ id: "voice", guild_id: "guild" }) },
            Member: { exists: async () => member },
        },
        "@spacebar/gateway": { CLOSECODES: { Authentication_failed: 4004 } },
        "@spacebar/schemas": { validateSchema: () => ({ server_id: "123", user_id: "user", session_id: "session", token: "token" }) },
        "@spacebar/util": { getPermission: async () => ({ has: (name) => permissions.has(name) }) },
        "@spacebar/webrtc": {
            mediaServer: {
                join: async () => {
                    joins++;
                    throw new Error("stop after join");
                },
            },
        },
        "@spacebarchat/spacebar-webrtc-types": {},
        "./Video": {},
        "./Speaking": {},
        "../util/VoiceSessions": { VoiceSessions: { register: async () => {} } },
    };
    return {
        ...load("src/webrtc/opcodes/Identify.ts", mocks),
        socket,
        permissions,
        revokeMembership: () => {
            member = false;
        },
        counts: () => ({ claims, joins }),
    };
}

test("stream tokens cannot redeem after membership or permissions are revoked", async () => {
    for (const denied of ["member", "VIEW_CHANNEL", "CONNECT"]) {
        const fixture = identifyFixture();
        if (denied === "member") fixture.revokeMembership();
        else fixture.permissions.delete(denied);
        await fixture.onIdentify.call(fixture.socket, { d: {} });
        assert.equal(fixture.socket.closed, 4004);
        assert.deepEqual(fixture.counts(), { claims: 0, joins: 0 });
    }
    const owner = identifyFixture(true);
    owner.permissions.delete("STREAM");
    await owner.onIdentify.call(owner.socket, { d: {} });
    assert.deepEqual(owner.counts(), { claims: 0, joins: 0 });
});

test("closed stream sockets cannot claim tokens or join media rooms", async () => {
    const closed = identifyFixture();
    closed.socket.readyState = 3;
    await closed.onIdentify.call(closed.socket, { d: {} });
    assert.deepEqual(closed.counts(), { claims: 0, joins: 0 });
    const viewer = identifyFixture();
    await viewer.onIdentify.call(viewer.socket, { d: {} });
    assert.deepEqual(viewer.counts(), { claims: 1, joins: 1 });
});

test("stream delete only announces to the guild the stream is in", async () => {
    for (const [guildId, expected] of [
        ["victim", 0],
        ["guild", 2],
    ]) {
        const events = [];
        let removed = 0;
        const handler = load("src/gateway/opcodes/StreamDelete.ts", {
            "@spacebar/database": {
                Stream: {
                    findOne: async () => ({
                        channel: { guild_id: "guild" },
                        remove: async () => {
                            removed++;
                        },
                    }),
                },
                VoiceState: { findOne: async () => ({ user_id: "owner", guild_id: "guild", save: async () => {}, toPublicVoiceState: () => ({}) }) },
                Member: { findOne: async () => null },
            },
            "@spacebar/gateway": { parseStreamKey: () => ({ type: "guild", channelId: "voice", guildId, userId: "owner" }) },
            "@spacebar/util": { emitEvent: async (event) => events.push(event) },
            "@spacebar/schemas": {},
            "./instanceOf": { check() {} },
        });
        await handler.onStreamDelete.call({ user_id: "owner" }, { d: { stream_key: "key" } });
        assert.equal(events.length, expected, guildId);
        assert.equal(removed, expected / 2);
        assert.ok(events.every((event) => event.guild_id === "guild"));
    }
});

test("stream watch refuses token issuance without current membership and connect permission", async () => {
    for (const denied of ["member", "VIEW_CHANNEL", "CONNECT"]) {
        let issued = 0;
        const events = [];
        const mocks = {
            typeorm: { Not: (value) => value },
            "@spacebar/database": {
                Stream: { findOne: async () => ({ id: "123", owner_id: "owner", channel_id: "voice", channel: { guild_id: "guild" } }) },
                Member: { exists: async () => denied !== "member" },
                StreamSession: {
                    create: () => {
                        issued++;
                    },
                },
            },
            "@spacebar/gateway": { parseStreamKey: () => ({ type: "guild", channelId: "voice", guildId: "guild", userId: "owner" }) },
            "@spacebar/util": {
                getPermission: async () => ({ has: (name) => name !== denied }),
                emitEvent: async (event) => events.push(event),
            },
            "@spacebar/schemas": {},
            "./instanceOf": { check() {} },
        };
        const handler = load("src/gateway/opcodes/StreamWatch.ts", mocks);
        await handler.onStreamWatch.call({ user_id: "viewer" }, { d: { stream_key: "key" } });
        assert.equal(issued, 0);
        assert.equal(events[0].data.reason, "unauthorized");
    }
});
