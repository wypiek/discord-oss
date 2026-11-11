const { test } = require("node:test");
const assert = require("node:assert/strict");
const { StubError, loadRoutes, response } = require("./helpers/route-harness.cjs");

const MEMBER = ["VIEW_CHANNEL", "CREATE_EVENTS"];
const STAGE_MODERATOR = [...MEMBER, "MANAGE_CHANNELS", "MUTE_MEMBERS", "MOVE_MEMBERS"];

function eventRoutes(granted) {
    const calls = [];
    const event = {
        id: "event",
        guild_id: "guild",
        channel_id: "stage",
        creator_id: "user",
        name: "town hall",
        privacy_level: 2,
        entity_type: 1,
        status: 1,
        scheduled_start_time: new Date(Date.now() + 3_600_000).toISOString(),
        save: async () => calls.push(["save"]),
    };
    const routes = loadRoutes("src/api/routes/guilds/#guild_id/scheduled-events.ts", {
        typeorm: { In: () => undefined, IsNull: () => undefined, LessThan: () => undefined, MoreThan: () => undefined },
        "@spacebar/database": {
            AuditLog: { log: async () => undefined, diff: () => [] },
            Channel: { findOne: async () => ({ id: "stage", type: 13 }) },
            GuildScheduledEvent: { findOne: async () => ({ ...event, status: calls.some(([name]) => name === "setStatus") ? 2 : event.status }) },
            GuildScheduledEventEntityType: { STAGE_INSTANCE: 1, VOICE: 2, EXTERNAL: 3 },
            GuildScheduledEventStatus: { SCHEDULED: 1, ACTIVE: 2, COMPLETED: 3, CANCELED: 4 },
            GuildScheduledEventUser: {},
            Member: { IsInGuildOrFail: async () => undefined },
            ScheduledEvents: {
                setStatus: async (fresh, status) => {
                    calls.push(["setStatus", status]);
                    return { ...fresh, status };
                },
                publish: async (fresh) => fresh,
            },
            StageInstances: {
                get: async () => null,
                create: async () => calls.push(["openStage"]),
                delete: async () => calls.push(["closeStage"]),
            },
        },
        "@spacebar/util": {
            DiscordApiErrors: {
                MISSING_PERMISSIONS: { withParams: (name) => new StubError(`missing ${name}`, 403) },
                UNKNOWN_CHANNEL: new StubError("unknown channel", 404),
                UNKNOWN_GUILD_SCHEDULED_EVENT: new StubError("unknown event", 404),
            },
            FieldErrors: (fields) => new StubError(JSON.stringify(fields)),
            Snowflake: { generate: () => "1" },
            deleteFile: async () => undefined,
            emitEvent: async () => undefined,
            getPermission: async () => ({ has: (name) => granted.includes(name) }),
            handleFile: async () => undefined,
        },
        "@spacebar/schemas": { AuditLogEvents: { GUILD_SCHEDULED_EVENT_UPDATE: 101 }, ChannelType: { GUILD_VOICE: 2, GUILD_STAGE_VOICE: 13 } },
    });
    const patch = (body) => routes["PATCH /:event_id"]({ params: { guild_id: "guild", event_id: "event" }, user_id: "user", body, headers: {} }, response());
    return { patch, calls };
}

test("a member who can only create events can't open a stage by starting a stage event", async () => {
    const { patch, calls } = eventRoutes(MEMBER);
    await assert.rejects(patch({ status: 2 }), /missing MANAGE_CHANNELS/);
    assert.deepEqual(calls, []);
});

test("a stage moderator still opens the stage when starting a stage event", async () => {
    const { patch, calls } = eventRoutes(STAGE_MODERATOR);
    await patch({ status: 2 });
    assert.deepEqual(calls, [["save"], ["openStage"], ["setStatus", 2]]);
});

test("a member who can only create events can still rename their own stage event", async () => {
    const { patch, calls } = eventRoutes(MEMBER);
    await patch({ name: "renamed" });
    assert.deepEqual(calls, [["save"]]);
});
