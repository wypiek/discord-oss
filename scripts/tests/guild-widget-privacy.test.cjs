const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const typeorm = require("typeorm");

function widget({ invites = [], members = [], presences = {} } = {}) {
    const created = [];
    let handler;
    const matches = (value, condition) => {
        if (condition instanceof typeorm.FindOperator) {
            if (condition.type === "isNull") return value == null;
            if (condition.type === "moreThan") return value != null && value > condition.value;
            throw new Error(`unexpected operator ${condition.type}`);
        }
        return value === condition;
    };
    const imports = {
        express: { Router: () => ({ get: (_, ...steps) => (handler = steps.at(-1)) }) },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/database": {
            Guild: {
                findOneOrFail: async () => ({ id: "guild-1", name: "Guild", widget_enabled: true, widget_channel_id: "channel-1", channel_ordering: [], presence_count: 0 }),
            },
            Channel: { getOrderedChannels: async () => [] },
            Role: { findOne: async () => null },
            Member: { find: async () => members },
            Invite: {
                findOne: async ({ where }) => invites.find((invite) => Object.entries(where).every(([key, condition]) => matches(invite[key], condition))) ?? null,
                create: (invite) => ({
                    ...invite,
                    save: async () => {
                        created.push(invite);
                        return invite;
                    },
                }),
            },
        },
        "@spacebar/extensions": { Random: { getString: () => "widget" } },
        typeorm,
        "@spacebar/util": {
            Config: { get: () => ({ cdn: { endpointPublic: "https://cdn.test" } }) },
            DiscordApiErrors: {},
            Permissions: { channelPermission: () => 0n, FLAGS: {} },
            getUserPresences: async (ids) => new Map(ids.filter((id) => presences[id]).map((id) => [id, { status: presences[id] }])),
        },
        "@spacebar/schemas": { ChannelType: { GUILD_VOICE: 2 } },
    };
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/routes/guilds/#guild_id/widget.json.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            Date,
            BigInt,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
            console: { log() {} },
        },
    );
    const get = async (guild_id) => {
        let body;
        await handler({ params: { guild_id } }, { set() {}, json: (value) => (body = value) });
        return body;
    };
    return { get, created };
}

const later = new Date(Date.now() + 60 * 60 * 1000);

test("the public widget never hands out an invite a member created", async () => {
    const { get, created } = widget({
        invites: [
            { code: "private1", guild_id: "guild-1", channel_id: "channel-1", inviter_id: "moderator", flags: 8, temporary: false, max_uses: 1, expires_at: later },
            { code: "member22", guild_id: "guild-1", channel_id: "channel-1", inviter_id: "member", flags: 0, temporary: false, max_uses: 0, expires_at: later },
            { code: "stale333", guild_id: "guild-1", channel_id: "channel-1", inviter_id: null, flags: 0, temporary: false, max_uses: 0, expires_at: new Date(Date.now() - 1000) },
        ],
    });
    const body = await get("guild-1");
    assert.equal(body.instant_invite, "widget");
    assert.equal(created.length, 1);
    assert.equal(created[0].inviter_id, undefined);
});

test("the public widget reuses its own live invite", async () => {
    const { get, created } = widget({
        invites: [{ code: "widget44", guild_id: "guild-1", channel_id: "channel-1", inviter_id: null, flags: 0, temporary: false, max_uses: 0, expires_at: later }],
    });
    assert.equal((await get("guild-1")).instant_invite, "widget44");
    assert.equal(created.length, 0);
});

test("the public widget lists only members whose presence is visible", async () => {
    const member = (id, username) => ({ id, avatar: null, user: { username, discriminator: "0", avatar: null } });
    const { get } = widget({
        members: [member("10", "visible"), member("20", "hidden"), member("30", "away"), member("40", "gone")],
        presences: { 10: "online", 20: "invisible", 30: "idle", 40: "offline" },
    });
    const body = await get("guild-1");
    assert.deepEqual(
        body.members.map((m) => `${m.username}:${m.status}`),
        ["visible:online", "away:idle"],
    );
});
