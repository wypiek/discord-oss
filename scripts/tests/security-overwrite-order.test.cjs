const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./helpers/route-harness.cjs");

const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
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
const base = VIEW_CHANNEL | SEND_MESSAGES;
const guild = {
    id: "guild",
    owner_id: "owner",
    roles: [
        { id: "guild", permissions: String(base) },
        { id: "muted", permissions: "0" },
        { id: "staff", permissions: "0" },
    ],
};
const final = (roles, overwrites, id = "member") =>
    Permissions.finalPermission({ user: { id, roles, communication_disabled_until: null, flags: 0 }, guild, channel: { overwrites } }).bitfield;

test("a role deny beats an @everyone allow stored after it", () => {
    const overwrites = [overwrite("muted", ROLE, { deny: SEND_MESSAGES }), overwrite("guild", ROLE, { allow: SEND_MESSAGES })];
    assert.equal(final(["guild", "muted"], overwrites) & SEND_MESSAGES, 0n);
});

test("a role allow beats an @everyone deny stored after it, and role allows win over role denies", () => {
    const hidden = [overwrite("staff", ROLE, { allow: VIEW_CHANNEL }), overwrite("guild", ROLE, { deny: VIEW_CHANNEL })];
    assert.equal(final(["guild", "staff"], hidden) & VIEW_CHANNEL, VIEW_CHANNEL);
    const mixed = [overwrite("staff", ROLE, { allow: SEND_MESSAGES }), overwrite("muted", ROLE, { deny: SEND_MESSAGES })];
    assert.equal(final(["guild", "staff", "muted"], mixed) & SEND_MESSAGES, SEND_MESSAGES);
});

test("a member overwrite applies last whatever its place in the list", () => {
    const overwrites = [overwrite("member", MEMBER, { deny: SEND_MESSAGES }), overwrite("staff", ROLE, { allow: SEND_MESSAGES })];
    assert.equal(final(["guild", "staff"], overwrites) & SEND_MESSAGES, 0n);
});

test("the gateway's cached permissions use the same order", () => {
    const permission = new Permissions(base);
    permission.cache = { guild_id: "guild", roles: [{ id: "guild" }, { id: "muted" }], user_id: "member" };
    const overwrites = [overwrite("muted", ROLE, { deny: SEND_MESSAGES }), overwrite("guild", ROLE, { allow: SEND_MESSAGES })];
    assert.equal(permission.overwriteChannel(overwrites).bitfield & SEND_MESSAGES, 0n);
});
