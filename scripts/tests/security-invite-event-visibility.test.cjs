const { test } = require("node:test");
const assert = require("node:assert/strict");
const { StubError, loadRoutes, response } = require("./helpers/route-harness.cjs");

const VIEW = 1n << 10n;

class Permissions {
    constructor(bits) {
        this.bits = BigInt(bits);
    }
    has(name) {
        assert.equal(name, "VIEW_CHANNEL");
        return (this.bits & VIEW) === VIEW;
    }
    static channelPermission(overwrites, init) {
        return overwrites.reduce((bits, overwrite) => (bits & ~BigInt(overwrite.deny)) | BigInt(overwrite.allow), init);
    }
}

function inviteRoute({ channels, everyone = VIEW, members = [], memberView = {} }) {
    const event = (id, channel_id) => ({ id, guild_id: "guild", channel_id, name: `event ${id}` });
    const events = { 101: event("101", "hidden"), 102: event("102", "open"), 103: event("103", null) };
    const routes = loadRoutes("src/api/routes/invites/index.ts", {
        "@spacebar/api/util": {},
        "lambert-server/HTTPError": { HTTPError: StubError },
        "@spacebar/schemas": { AuditLogEvents: {}, ChannelPermissionOverwriteType: { role: 0, member: 1 }, ChannelType: { GROUP_DM: 3 }, MessageType: {}, UserFlags: {} },
        "@spacebar/util": {
            DiscordApiErrors: { UNKNOWN_INVITE: new StubError("Unknown invite", 404) },
            Permissions,
            getPermission: async (user_id, guild_id, channel_id) => new Permissions(memberView[channel_id] ? VIEW : 0n),
        },
        "@spacebar/database": {
            PublicInviteRelation: [],
            Invite: {
                resolveCode: async (code) => code,
                findOne: async () => ({
                    code: "abc",
                    channel: { id: "open", type: 0 },
                    guild: { id: "guild", withPresenceCount: async () => undefined },
                    isExpired: () => false,
                    isFriendInvite: () => false,
                    loadGroupRecipients: async () => undefined,
                    toPublicJSON: () => ({ code: "abc" }),
                }),
            },
            GuildScheduledEvent: { findOne: async ({ where }) => (where.guild_id === "guild" ? (events[where.id] ?? null) : null) },
            ScheduledEvents: { serialize: async (value) => ({ id: value.id, name: value.name }) },
            Member: { exists: async ({ where }) => members.includes(where.id) && where.guild_id === "guild" },
            Channel: { findOne: async ({ where }) => (where.guild_id === "guild" ? (channels[where.id] ?? null) : null) },
            Role: { findOne: async ({ where }) => (where.id === "guild" ? { id: "guild", permissions: String(everyone) } : null) },
        },
    });
    return async (eventId, user_id) => {
        const res = response();
        await routes["GET /:invite_code"]({ params: { invite_code: "abc" }, query: { guild_scheduled_event_id: eventId }, isAuthenticated: !!user_id, user_id }, res);
        return res.body.guild_scheduled_event?.id ?? null;
    };
}

const hiddenFromEveryone = {
    hidden: { id: "hidden", permission_overwrites: [{ id: "guild", type: 0, allow: "0", deny: String(VIEW) }] },
    open: { id: "open", permission_overwrites: [] },
};

test("anonymous invite lookups don't return events in channels @everyone can't view", async () => {
    const lookup = inviteRoute({ channels: hiddenFromEveryone });
    assert.equal(await lookup("101"), null);
    assert.equal(await lookup("102"), "102");
    assert.equal(await lookup("103"), "103");
});

test("anonymous invite lookups follow the @everyone role when it can't view any channel", async () => {
    const lookup = inviteRoute({ channels: hiddenFromEveryone, everyone: 0n });
    assert.equal(await lookup("102"), null);
    assert.equal(await lookup("103"), "103");
});

test("a member gets the event only when they can view its channel", async () => {
    const lookup = inviteRoute({ channels: hiddenFromEveryone, members: ["mod", "member"], memberView: { hidden: true, open: true } });
    assert.equal(await lookup("101", "mod"), "101");
    const denied = inviteRoute({ channels: hiddenFromEveryone, members: ["member"], memberView: { open: true } });
    assert.equal(await denied("101", "member"), null);
    assert.equal(await denied("102", "member"), "102");
});

test("a signed in non-member is checked as @everyone", async () => {
    const lookup = inviteRoute({ channels: hiddenFromEveryone, members: [] });
    assert.equal(await lookup("101", "outsider"), null);
    assert.equal(await lookup("102", "outsider"), "102");
});
