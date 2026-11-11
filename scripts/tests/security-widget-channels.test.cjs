const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule, loadRoutes, response } = require("./helpers/route-harness.cjs");

const VIEW_CHANNEL = 1n << 10n;
const CONNECT = 1n << 20n;
const ROLE = 0;
const MEMBER = 1;

const { Permissions } = loadModule("src/util/util/Permissions.ts", {
    "../../database/entities": { Application: {}, Member: class {}, User: {}, Role: {}, Guild: {}, Channel: class {}, ThreadMember: class {} },
    "./BitField": loadModule("src/util/util/BitField.ts", {}),
    "lambert-server/HTTPError": { HTTPError: class extends Error {} },
    "./Constants": { DiscordApiErrors: {} },
    "@spacebar/schemas": {
        ChannelType: { GUILD_PRIVATE_THREAD: 12 },
        ChannelPermissionOverwriteType: { role: ROLE, member: MEMBER },
        UserFlags: { FLAGS: { QUARANTINED: 1n << 44n } },
    },
    typeorm: { ArrayContains: () => ({}), EntityNotFoundError: class extends Error {} },
    "@spacebar/util": { OrmUtils: { keysToObject: () => ({}) } },
});

const overwrite = (id, type, { allow = 0n, deny = 0n }) => ({ id, type, allow: String(allow), deny: String(deny) });

async function widgetChannels(channels, everyonePermissions = VIEW_CHANNEL | CONNECT) {
    const guild = { id: "guild", name: "guild", widget_enabled: true, widget_channel_id: null, channel_ordering: [] };
    const routes = loadRoutes("src/api/routes/guilds/#guild_id/widget.json.ts", {
        typeorm: { IsNull: () => undefined, MoreThan: () => undefined },
        "@spacebar/database": {
            Channel: { getOrderedChannels: async () => channels },
            Guild: { findOneOrFail: async () => guild },
            Invite: { findOne: async () => null },
            Member: { find: async () => [] },
            Role: { findOne: async () => ({ id: "guild", permissions: String(everyonePermissions) }) },
        },
        "@spacebar/extensions": { Random: { getString: () => "code" } },
        "@spacebar/util": {
            Config: { get: () => ({ cdn: { endpointPublic: "" } }) },
            DiscordApiErrors: { EMBED_DISABLED: new Error("disabled") },
            getUserPresences: async () => new Map(),
            Permissions,
        },
        "@spacebar/schemas": { ChannelPermissionOverwriteType: { role: ROLE, member: MEMBER }, ChannelType: { GUILD_VOICE: 2 } },
    });
    const res = response();
    res.set = () => undefined;
    await routes["GET /"]({ params: { guild_id: "guild" } }, res);
    return Array.from(res.body.channels, (channel) => channel.name);
}

const voice = (name, permission_overwrites = []) => ({ id: name, name, type: 2, position: 0, permission_overwrites });

test("the public widget leaves out voice channels that @everyone can't view", async () => {
    const names = await widgetChannels([
        voice("lobby"),
        voice("owners-only", [overwrite("guild", ROLE, { deny: VIEW_CHANNEL })]),
        voice("staff", [overwrite("guild", ROLE, { deny: VIEW_CHANNEL }), overwrite("staff", ROLE, { allow: VIEW_CHANNEL })]),
        voice("no-connect", [overwrite("guild", ROLE, { deny: CONNECT })]),
    ]);
    assert.deepEqual(names, ["lobby"]);
});

test("a role or member overwrite doesn't hide or reveal a channel in the widget", async () => {
    const names = await widgetChannels(
        [
            voice("open-with-allow", [overwrite("guild", ROLE, { allow: VIEW_CHANNEL | CONNECT }), overwrite("mods", ROLE, { allow: 1n << 22n })]),
            voice("role-denied", [overwrite("muted", ROLE, { deny: CONNECT }), overwrite("someone", MEMBER, { deny: VIEW_CHANNEL })]),
            voice("role-allowed-only", [overwrite("vip", ROLE, { allow: VIEW_CHANNEL | CONNECT })]),
        ],
        VIEW_CHANNEL,
    );
    assert.deepEqual(names, ["open-with-allow"]);
});
