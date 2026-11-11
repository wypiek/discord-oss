const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const MISSING_ACCESS = Object.assign(new Error("Missing Access"), { code: 50001 });
const MISSING_PERMISSIONS = Object.assign(new Error("Missing Permissions"), { code: 50013 });
const UNKNOWN_CHANNEL = Object.assign(new Error("Unknown Channel"), { code: 10003 });
const NOT_CONNECTED = Object.assign(new Error("Target user is not connected to voice"), { code: 40032 });
const REACHED = new Error("passed the voice checks");

const stubs = (known) => new Proxy(known, { get: (target, key) => (key in target ? target[key] : () => ({})) });

function memberRoute(grants) {
    const channels = [
        { id: "lobby", guild_id: "guild" },
        { id: "private", guild_id: "guild" },
        { id: "foreign", guild_id: "other" },
    ];
    const permission = (user_id, channel_id) => {
        const flags = grants[user_id]?.[channel_id ?? "guild"] ?? [];
        return {
            has: (flag) => flags.includes(flag),
            hasThrow(flag) {
                if (!flags.includes("VIEW_CHANNEL")) throw MISSING_ACCESS;
                if (!flags.includes(flag)) throw MISSING_PERMISSIONS;
                return true;
            },
        };
    };
    let patch;
    const errors = {
        MISSING_PERMISSIONS: Object.assign(MISSING_PERMISSIONS, { withParams: () => MISSING_PERMISSIONS }),
        UNKNOWN_CHANNEL,
        TARGET_USER_IS_NOT_CONNECTED_TO_VOICE: NOT_CONNECTED,
    };
    const imports = {
        "@spacebar/util/util/IdentityModeration": { assertIdentityNameAllowed() {} },
        express: { Router: () => ({ get() {}, put() {}, delete() {}, patch: (_, ...steps) => (patch = steps.at(-1)) }) },
        "@spacebar/api/util/utility/memberRoleAuthorization": { authorizeMemberRoleChanges: async () => [] },
        "@spacebar/api/util/utility/remoteCollectibles": { remoteDecorationFor: async () => undefined },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/database": stubs({
            Channel: { exists: async ({ where }) => channels.some((channel) => channel.id === where.id && channel.guild_id === where.guild_id) },
            Member: {
                findOneOrFail: async () => ({
                    id: "target",
                    guild_id: "guild",
                    roles: [],
                    nick: null,
                    mute: false,
                    deaf: false,
                    communication_disabled_until: null,
                    assign() {
                        throw REACHED;
                    },
                }),
            },
            VoiceState: { findOne: async () => ({ id: "state", channel_id: "lobby" }), exists: async () => true },
        }),
        typeorm: { IsNull: () => null, MoreThan: () => ({}), Not: (value) => value },
        "@spacebar/util": stubs({
            Collectibles: {
                item: async () => {
                    throw REACHED;
                },
            },
            CollectibleItemType: {},
            DiscordApiErrors: errors,
            getPermission: async (user_id, _, channel_id) => permission(user_id, channel_id),
            Permissions: {},
        }),
        "@spacebar/api/util": stubs({}),
        "@spacebar/schemas": { AuditLogEvents: {}, PublicMemberProjection: [], PublicUserProjection: [] },
    };
    const loaded = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/routes/guilds/#guild_id/members/#member_id/index.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module: loaded,
            exports: loaded.exports,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    return (body) => patch({ params: { guild_id: "guild", member_id: "target" }, user_id: "mover", body }, { json() {} });
}

const everywhere = (flags) => ({ guild: flags, lobby: flags, private: flags });
const mover = ["VIEW_CHANNEL", "CONNECT", "MOVE_MEMBERS", "MUTE_MEMBERS", "DEAFEN_MEMBERS"];
const target = { target: everywhere(["VIEW_CHANNEL", "CONNECT"]) };

test("a mover with access to both channels can move a member", async () => {
    const patch = memberRoute({ mover: everywhere(mover), ...target });
    await assert.rejects(patch({ channel_id: "private" }), (err) => err === REACHED);
});

test("a mover cannot move a member into a channel they cannot see or connect to", async () => {
    const hidden = memberRoute({ mover: { guild: mover, lobby: mover, private: [] }, ...target });
    await assert.rejects(hidden({ channel_id: "private" }), (err) => err === MISSING_ACCESS);
    const noConnect = memberRoute({ mover: { guild: mover, lobby: mover, private: ["VIEW_CHANNEL", "MOVE_MEMBERS"] }, ...target });
    await assert.rejects(noConnect({ channel_id: "private" }), (err) => err === MISSING_PERMISSIONS);
    const noMove = memberRoute({ mover: { guild: mover, lobby: mover, private: ["VIEW_CHANNEL", "CONNECT"] }, ...target });
    await assert.rejects(noMove({ channel_id: "private" }), (err) => err === MISSING_PERMISSIONS);
});

test("a channel overwrite denying move members on the member's current channel blocks moves and disconnects", async () => {
    const patch = memberRoute({ mover: { guild: mover, lobby: ["VIEW_CHANNEL", "CONNECT"], private: mover }, ...target });
    await assert.rejects(patch({ channel_id: "private" }), (err) => err === MISSING_PERMISSIONS);
    await assert.rejects(patch({ channel_id: null }), (err) => err === MISSING_PERMISSIONS);
});

test("server mute and deafen follow the overwrites of the member's voice channel", async () => {
    const patch = memberRoute({ mover: { guild: mover, lobby: ["VIEW_CHANNEL", "MOVE_MEMBERS"] }, ...target });
    await assert.rejects(patch({ mute: true }), (err) => err === MISSING_PERMISSIONS);
    await assert.rejects(patch({ deaf: true }), (err) => err === MISSING_PERMISSIONS);
});

test("a channel of another guild is refused as a move target", async () => {
    const patch = memberRoute({ mover: { ...everywhere(mover), foreign: mover }, target: { ...target.target, foreign: ["VIEW_CHANNEL", "CONNECT"] } });
    await assert.rejects(patch({ channel_id: "foreign" }), (err) => err === UNKNOWN_CHANNEL);
});
