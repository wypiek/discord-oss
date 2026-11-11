const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

class HTTPError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

function previewRoute({ members = [], recipients = [], permissions = {} } = {}) {
    const handlers = {};
    const previews = new Map();
    const channels = [
        { id: "voice", guild_id: "guild" },
        { id: "dm", guild_id: null },
    ];
    const streams = [
        { owner_id: "owner", channel_id: "voice" },
        { owner_id: "owner", channel_id: "dm" },
    ];
    const imports = {
        express: { Router: () => ({ get: (_, ...steps) => (handlers.get = steps.at(-1)), post: (_, ...steps) => (handlers.post = steps.at(-1)) }) },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/database": {
            Channel: { findOne: async ({ where }) => channels.find((channel) => channel.id === where.id) ?? null },
            Member: { exists: async ({ where }) => members.some((member) => member.id === where.id && member.guild_id === where.guild_id) },
            Recipient: { exists: async ({ where }) => recipients.some((recipient) => recipient.channel_id === where.channel_id && recipient.user_id === where.user_id) },
            Stream: {
                find: async ({ where }) =>
                    streams
                        .filter((stream) => stream.owner_id === where.owner_id)
                        .map((stream) => ({ ...stream, channel: channels.find((channel) => channel.id === stream.channel_id) })),
            },
            GoLiveStreams: {
                key: (stream) =>
                    stream.channel?.guild_id ? `guild:${stream.channel.guild_id}:${stream.channel_id}:${stream.owner_id}` : `call:${stream.channel_id}:${stream.owner_id}`,
            },
            StreamPreviews: previews,
        },
        "@spacebar/util": {
            getPermission: async (user_id) => ({ has: (flag) => (permissions[user_id] ?? []).includes(flag) }),
        },
        "lambert-server": { HTTPError },
    };
    const loaded = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/routes/streams/#stream_key/preview.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module: loaded,
            exports: loaded.exports,
            setTimeout,
            clearTimeout,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    const respond = () => {
        const res = { destroyed: false, writableEnded: false, on() {}, off() {} };
        res.json = (body) => (res.body = body);
        res.sendStatus = (status) => (res.status = status);
        return res;
    };
    return {
        previews,
        get: async (user_id, stream_key) => {
            const res = respond();
            await handlers.get({ user_id, params: { stream_key } }, res);
            return res.body;
        },
        post: async (user_id, stream_key, thumbnail) => {
            const res = respond();
            await handlers.post({ user_id, params: { stream_key }, body: { thumbnail } }, res);
            return res.status;
        },
    };
}

const guildKey = "guild:guild:voice:owner";
const thumbnail = "data:image/png;base64,AAAA";

test("a user outside the guild cannot read a guild stream preview", async () => {
    const route = previewRoute();
    route.previews.set(guildKey, thumbnail);
    await assert.rejects(route.get("stranger", guildKey), (err) => err.code === 404);
});

test("a member needs to see and connect to the voice channel to read its stream preview", async () => {
    const members = [
        { id: "viewer", guild_id: "guild" },
        { id: "blind", guild_id: "guild" },
        { id: "muted", guild_id: "guild" },
    ];
    const permissions = { viewer: ["VIEW_CHANNEL", "CONNECT"], blind: ["CONNECT"], muted: ["VIEW_CHANNEL"] };
    const route = previewRoute({ members, permissions });
    route.previews.set(guildKey, thumbnail);
    assert.equal((await route.get("viewer", guildKey)).url, thumbnail);
    assert.equal((await route.get("owner", guildKey)).url, thumbnail);
    await assert.rejects(route.get("blind", guildKey), (err) => err.code === 404);
    await assert.rejects(route.get("muted", guildKey), (err) => err.code === 404);
});

test("a stream key naming another guild than the channel's is refused", async () => {
    const route = previewRoute({ members: [{ id: "viewer", guild_id: "other" }], permissions: { viewer: ["VIEW_CHANNEL", "CONNECT"] } });
    route.previews.set("guild:other:voice:owner", thumbnail);
    await assert.rejects(route.get("viewer", "guild:other:voice:owner"), (err) => err.code === 404);
});

test("only recipients of a call can read its stream preview", async () => {
    const route = previewRoute({ recipients: [{ channel_id: "dm", user_id: "friend" }] });
    route.previews.set("call:dm:owner", thumbnail);
    assert.equal((await route.get("friend", "call:dm:owner")).url, thumbnail);
    await assert.rejects(route.get("stranger", "call:dm:owner"), (err) => err.code === 404);
});

test("the owner can only upload a preview for a channel they are streaming in", async () => {
    const route = previewRoute();
    assert.equal(await route.post("owner", guildKey, thumbnail), 204);
    await assert.rejects(route.post("owner", "guild:guild:elsewhere:owner", thumbnail), (err) => err.code === 404);
});
