const assert = require("node:assert/strict");
const { test, before, after, mock } = require("node:test");
const { In } = require("typeorm");

const enabled = process.env.ADMIN_GUILD_CREATION_TEST === "1";
let db, entities, config, actor, createChannel, createRole, ajv;
const fixtures = [];
const emitted = [];

before(async () => {
    if (!enabled) return;
    assert.match(new URL(process.env.DATABASE).pathname, /^\/fosscord_codex_admin$/);
    entities = require("../../dist/database");
    db = await entities.initDatabase();
    const { ConfigValue } = require("../../dist/util/config");
    const { Config } = require("../../dist/util/util/Config");
    config = new ConfigValue();
    mock.method(Config, "get", () => config);
    mock.method(require("../../dist/util/util/ipc/Event"), "emitEvent", async (event) => emitted.push(event));
    actor = (await entities.User.findOneOrFail({ where: { bot: false }, select: { id: true } })).id;
    ajv = require("../../dist/schemas").getAjv();
    const handler = (router) => router.stack.find((layer) => layer.route?.stack.some((entry) => entry.method === "post")).route.stack.at(-1).handle;
    createChannel = handler(require("../../dist/api/routes/admin/guilds/#guild_id/channels").default);
    createRole = handler(require("../../dist/api/routes/admin/guilds/#guild_id/roles").default);
});

after(async () => {
    if (!enabled) return;
    if (fixtures.length) {
        await entities.AuditLog.delete({ guild_id: In(fixtures) });
        await entities.Guild.delete({ id: In(fixtures) });
    }
    mock.restoreAll();
    if (db) await db.destroy();
});

async function guild() {
    const result = await entities.Guild.createGuild({
        name: "Disposable admin creation test",
        owner_id: actor,
        source_guild_id: null,
        channels: [],
    });
    fixtures.push(result.id);
    await entities.Guild.update({ id: result.id }, { system_channel_id: null, channel_ordering: [] });
    await entities.Channel.delete({ guild_id: result.id });
    return result;
}

async function invoke(handler, guild_id, body) {
    let status, result;
    await handler(
        { params: { guild_id }, body, user_id: actor, headers: {} },
        {
            status(value) {
                status = value;
                return this;
            },
            json(value) {
                result = value;
                return this;
            },
        },
    );
    assert.equal(status, 201);
    return result;
}

test("concurrent channel creates enforce the limit and retain every ordered channel", { skip: !enabled }, async () => {
    const server = await guild();
    config.limits.guild.maxChannels = 2;
    const results = await Promise.allSettled([0, 1, 2].map((i) => invoke(createChannel, server.id, { name: `Channel ${i}` })));
    assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        2,
        results
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason.message)
            .join("; "),
    );
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const channels = await entities.Channel.find({ where: { guild_id: server.id } });
    const persisted = await entities.Guild.findOneOrFail({
        where: { id: server.id },
        select: { id: true, channel_ordering: true },
    });
    assert.equal(channels.length, 2);
    assert.deepEqual(new Set(persisted.channel_ordering), new Set(channels.map((channel) => channel.id)));
    assert.equal(persisted.channel_ordering.length, 2);
    assert.equal(await entities.AuditLog.count({ where: { guild_id: server.id } }), 2);
    assert.equal(emitted.filter((event) => event.guild_id === server.id && event.event === "CHANNEL_CREATE").length, 2);
});

test("channel parents, category limits, feature gates and voice defaults", { skip: !enabled }, async () => {
    config.limits.guild.maxChannels = 20;
    config.limits.guild.maxChannelsInCategory = 1;
    const server = await guild();
    await entities.Guild.update({ id: server.id }, { features: [] });
    const category = await invoke(createChannel, server.id, { name: "Category", type: 4 });
    const text = await invoke(createChannel, server.id, { name: "Text", parent_id: category.id });
    assert.equal(text.parent_id, category.id);
    await assert.rejects(invoke(createChannel, server.id, { name: "Full category", parent_id: category.id }));
    await assert.rejects(invoke(createChannel, server.id, { name: "Category child", type: 4, parent_id: category.id }));
    await assert.rejects(invoke(createChannel, server.id, { name: "Bad parent", parent_id: text.id }));
    await assert.rejects(invoke(createChannel, server.id, { name: "News", type: 5 }));
    await assert.rejects(invoke(createChannel, server.id, { name: "Stage", type: 13 }));
    const other = await guild();
    const otherCategory = await invoke(createChannel, other.id, {
        name: "Other category",
        type: 4,
    });
    await assert.rejects(invoke(createChannel, server.id, { name: "Cross server", parent_id: otherCategory.id }));
    const voice = await invoke(createChannel, server.id, { name: "Voice", type: 2 });
    assert.equal(voice.bitrate, 64000);
    assert.equal(voice.user_limit, 0);
    await assert.rejects(invoke(createChannel, server.id, { name: "Text voice settings", bitrate: 64000 }));
});

test("concurrent role creates preserve ordering, everyone and the role limit", { skip: !enabled }, async () => {
    const server = await guild();
    config.limits.guild.maxRoles = 3;
    const results = await Promise.allSettled([0, 1, 2].map((i) => invoke(createRole, server.id, { name: `Role ${i}`, permissions: "8" })));
    assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        2,
        results
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason.message)
            .join("; "),
    );
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const roles = await entities.Role.find({
        where: { guild_id: server.id },
        order: { position: "ASC" },
    });
    assert.equal(roles.length, 3);
    assert.equal(roles[0].id, server.id);
    assert.deepEqual(
        roles.map((role) => role.position),
        [0, 1, 2],
    );
    assert.equal(roles[1].permissions, "8");
    assert.equal(roles[1].managed, false);
    assert.equal(await entities.AuditLog.count({ where: { guild_id: server.id } }), 2);
    assert.equal(emitted.filter((event) => event.guild_id === server.id && event.event === "GUILD_ROLE_CREATE").length, 2);
});

test("schemas reject invalid types, IDs, colors and permissions without allowing managed roles", { skip: !enabled }, async () => {
    for (const body of [
        { name: "Bad", type: 1 },
        { name: "Bad", type: 11 },
        { name: "Bad", parent_id: "abc" },
        { name: "Bad", bitrate: 7999 },
    ])
        assert.equal(ajv.validate("AdminChannelCreateSchema", body), false);
    for (const body of [
        { name: "Bad", color: -1 },
        { name: "Bad", permissions: "-1" },
        { name: "Bad", managed: true },
    ])
        assert.equal(ajv.validate("AdminRoleCreateSchema", body), false);
    config.limits.guild.maxRoles = 10;
    const server = await guild();
    await assert.rejects(invoke(createRole, server.id, { name: "Unsupported", permissions: (1n << 63n).toString() }));
    const role = await invoke(createRole, server.id, {
        name: " Safe role ",
        color: 0,
        hoist: true,
    });
    assert.equal(role.name, "Safe role");
    assert.equal(role.permissions, "0");
    assert.equal(role.colors.primary_color, 0);
    assert.equal(role.hoist, true);
});
