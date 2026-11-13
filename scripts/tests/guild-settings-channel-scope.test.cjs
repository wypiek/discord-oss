const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const compile = (file, imports) => {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            Object,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    return module.exports;
};

const FAVORITED = 1 << 11;
const OPT_IN_ENABLED = 1 << 12;
const UNKNOWN_CHANNEL = Object.assign(new Error("Unknown Channel"), { code: 10003 });

const channels = [
    { id: "general", guild_id: "guild-1" },
    { id: "voice", guild_id: "guild-1" },
    { id: "elsewhere", guild_id: "guild-2" },
];
const recipients = [
    { user_id: "user-1", channel_id: "dm-1" },
    { user_id: "user-2", channel_id: "dm-2" },
];

const database = {
    Channel: { count: async ({ where }) => channels.filter((c) => c.guild_id === where.guild_id && where.id.ids.includes(c.id)).length },
    Recipient: { count: async ({ where }) => recipients.filter((r) => r.user_id === where.user_id && where.channel_id.ids.includes(r.channel_id)).length },
};
const util = { DiscordApiErrors: { UNKNOWN_CHANNEL } };
const typeorm = { In: (ids) => ({ ids }) };

const { assertChannelOverridesInScope } = compile("src/api/util/utility/guildSettingsChannels.ts", {
    "@spacebar/database": database,
    "@spacebar/util": util,
    typeorm,
});

const pinned = { flags: FAVORITED | OPT_IN_ENABLED };

test("pinning channels of the same guild passes", async () => {
    await assertChannelOverridesInScope("user-1", "guild-1", { general: pinned, voice: pinned });
    await assertChannelOverridesInScope("user-1", "guild-1", undefined);
    await assertChannelOverridesInScope("user-1", "guild-1", null);
    await assertChannelOverridesInScope("user-1", "guild-1", {});
});

test("a channel of another guild or an unknown channel is rejected", async () => {
    await assert.rejects(assertChannelOverridesInScope("user-1", "guild-1", { elsewhere: pinned }), UNKNOWN_CHANNEL);
    await assert.rejects(assertChannelOverridesInScope("user-1", "guild-1", { general: pinned, missing: pinned }), UNKNOWN_CHANNEL);
});

test("private channel overrides need the user to be a recipient", async () => {
    await assertChannelOverridesInScope("user-1", null, { "dm-1": pinned });
    await assert.rejects(assertChannelOverridesInScope("user-1", null, { "dm-2": pinned }), UNKNOWN_CHANNEL);
    await assert.rejects(assertChannelOverridesInScope("user-1", null, { general: pinned }), UNKNOWN_CHANNEL);
});

const loadBulkRoute = (updates) => {
    const routes = {};
    const router = { patch: (path, options, handler) => (routes[`PATCH ${path}`] = handler) };
    compile("src/api/routes/users/@me/guilds/settings.ts", {
        express: { Router: () => router },
        "@spacebar/api/middlewares": { route: (options) => options },
        "@spacebar/api/util/utility/guildSettingsChannels": { assertChannelOverridesInScope },
        "@spacebar/database": {
            Member: {
                updateGuildSettings: async (user_id, guild_id, settings) => {
                    updates.push({ user_id, guild_id, settings });
                    return { guild_id, channel_overrides: Object.entries(settings.channel_overrides ?? {}).map(([channel_id, o]) => ({ ...o, channel_id })) };
                },
            },
        },
        "@spacebar/util": { FieldErrors: (fields) => Object.assign(new Error("Invalid Form Body"), { fields }) },
        "@spacebar/schemas": { getAjv: () => ({ getSchema: () => () => true }) },
        "@spacebar/util/util/UserFieldCaps": { UserFieldCaps: { guildSettingsBulk: 1000 } },
    });
    return routes["PATCH /"];
};

const callBulk = async (handler, user_id, body) => {
    let json;
    await handler({ user_id, body }, { json: (value) => (json = value) });
    return JSON.parse(JSON.stringify(json));
};

test("the bulk settings route saves a pin the way the client sends it", async () => {
    const updates = [];
    const handler = loadBulkRoute(updates);
    const entries = await callBulk(handler, "user-1", {
        guilds: { "guild-1": { channel_overrides: { general: { flags: 6144 } } }, null: { channel_overrides: { "dm-1": pinned } } },
    });
    assert.deepEqual(entries, [
        { guild_id: "guild-1", channel_overrides: [{ flags: 6144, channel_id: "general" }] },
        { guild_id: null, channel_overrides: [{ flags: 6144, channel_id: "dm-1" }] },
    ]);
    assert.deepEqual(
        updates.map((u) => u.guild_id),
        ["guild-1", null],
    );
});

test("the bulk settings route writes nothing when any guild names a channel outside it", async () => {
    const updates = [];
    const handler = loadBulkRoute(updates);
    await assert.rejects(
        callBulk(handler, "user-1", { guilds: { "guild-1": { channel_overrides: { general: pinned } }, "guild-2": { channel_overrides: { general: pinned } } } }),
        UNKNOWN_CHANNEL,
    );
    assert.equal(updates.length, 0);
});

test("the single guild settings route uses the same scope check", () => {
    const source = fs.readFileSync("src/api/routes/users/@me/guilds/#guild_id/settings.ts", "utf8");
    assert.match(source, /await assertChannelOverridesInScope\(req\.user_id, target, body\.channel_overrides\)/);
});
