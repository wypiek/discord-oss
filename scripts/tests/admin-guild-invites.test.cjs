const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test, before, after, mock } = require("node:test");

const database = process.env.ADMIN_GUILD_MODERATION_TEST_DATABASE;
const enabled = Boolean(database);
const routes = ["src/api/routes/admin/guilds/#guild_id/invites/index.ts", "src/api/routes/admin/guilds/#guild_id/invites/#code.ts"];
let e, db, list, create, revoke;
const users = [];
const guilds = [];
const emitted = [];

test("invite routes need the server right and refuse mirrored servers", () => {
    for (const file of routes) {
        const source = fs.readFileSync(file, "utf8");
        const declared = source.match(/router\.(get|patch|put|post|delete)\(/g) ?? [];
        assert.ok(declared.length > 0, file);
        assert.equal((source.match(/right: "MANAGE_GUILDS"/g) ?? []).length, declared.length, file);
        if (/router\.(post|delete)\(/.test(source)) assert.match(source, /assertMirrorGuildEditable\(/, file);
    }
});

const handler = (router, method) => router.stack.find((layer) => layer.route?.stack.some((entry) => entry.method === method)).route.stack.at(-1).handle;

async function invoke(fn, { params, body, query = {}, actor }) {
    let status = 200,
        result;
    const { Rights } = require("../../dist/util/util/Rights");
    await fn(
        { params, body, query, headers: {}, user_id: actor, rights: new Rights("4") },
        {
            status(value) {
                status = value;
                return this;
            },
            json(value) {
                result = value;
                return this;
            },
            sendStatus(value) {
                status = value;
                return this;
            },
        },
    );
    return { status, body: result };
}

before(async () => {
    if (!enabled) return;
    assert.equal(new URL(process.env.DATABASE).pathname, `/${database}`);
    e = require("../../dist/database");
    db = await e.initDatabase();
    const { ConfigValue } = require("../../dist/util/config");
    const { Config } = require("../../dist/util/util/Config");
    const config = new ConfigValue();
    mock.method(Config, "get", () => config);
    mock.method(require("../../dist/util/util/ipc/Event"), "emitEvent", async (event) => emitted.push(event));
    const index = require("../../dist/api/routes/admin/guilds/#guild_id/invites/index").default;
    list = handler(index, "get");
    create = handler(index, "post");
    revoke = handler(require("../../dist/api/routes/admin/guilds/#guild_id/invites/#code").default, "delete");
});

after(async () => {
    if (!enabled) return;
    const { In } = require("typeorm");
    if (guilds.length) {
        await e.AuditLog.delete({ guild_id: In(guilds) });
        await e.Guild.delete({ id: In(guilds) });
    }
    if (users.length) await e.User.delete({ id: In(users) });
    mock.restoreAll();
    await db?.destroy();
});

test("staff create, page and revoke invites with server audit entries", { skip: !enabled }, async () => {
    const actor = await e.User.create({
        username: `admin invites actor ${Date.now()}`,
        discriminator: "0",
        bot: false,
        premium: false,
        premium_type: 0,
        verified: true,
        rights: "4",
        data: { hash: "disposable", valid_tokens_since: new Date() },
        created_at: new Date(),
        settings: await e.UserSettings.create({ locale: "en-US" }).save(),
    }).save();
    users.push(actor.id);
    const guild = await e.Guild.createGuild({
        name: "Disposable admin invite test",
        owner_id: actor.id,
        source_guild_id: null,
        channels: [
            { name: "general", type: 0 },
            { name: "Lobby", type: 4 },
        ],
    });
    guilds.push(guild.id);
    const channels = await e.Channel.find({ where: { guild_id: guild.id } });
    const text = channels.find((channel) => channel.type === 0);
    const category = channels.find((channel) => channel.type === 4);
    const other = await e.Guild.createGuild({ name: "Disposable other invite test", owner_id: actor.id, source_guild_id: null, channels: [{ name: "elsewhere", type: 0 }] });
    guilds.push(other.id);
    const foreign = await e.Channel.findOneOrFail({ where: { guild_id: other.id } });

    const made = [];
    for (const max_uses of [0, 5, 10])
        made.push((await invoke(create, { params: { guild_id: guild.id }, body: { channel_id: text.id, max_age: 3600, max_uses }, actor: actor.id })).body);
    assert.equal(made[1].max_uses, 5);
    assert.ok(made[0].expires_at);
    assert.equal(made[0].inviter.id, actor.id);
    await assert.rejects(invoke(create, { params: { guild_id: guild.id }, body: { channel_id: category.id }, actor: actor.id }), /Invites can only point/);
    await assert.rejects(invoke(create, { params: { guild_id: guild.id }, body: { channel_id: foreign.id }, actor: actor.id }), /isn't in this server/);
    assert.equal(await e.AuditLog.count({ where: { guild_id: guild.id, action_type: 40 } }), 3);

    const first = await invoke(list, { params: { guild_id: guild.id }, query: { limit: "2" }, actor: actor.id });
    assert.equal(first.body.total, 3);
    assert.equal(first.body.invites.length, 2);
    const rest = await invoke(list, { params: { guild_id: guild.id }, query: { limit: "2", after: first.body.next }, actor: actor.id });
    assert.equal(rest.body.invites.length, 1);
    assert.equal(rest.body.next, null);
    assert.deepEqual(new Set([...first.body.invites, ...rest.body.invites].map((invite) => invite.code)), new Set(made.map((invite) => invite.code)));
    await assert.rejects(invoke(list, { params: { guild_id: guild.id }, query: { after: "nonsense" }, actor: actor.id }), /next value/);

    assert.equal((await invoke(revoke, { params: { guild_id: guild.id, code: made[0].code }, actor: actor.id })).status, 204);
    await assert.rejects(invoke(revoke, { params: { guild_id: other.id, code: made[1].code }, actor: actor.id }), /no invite/);
    assert.equal(await e.Invite.count({ where: { guild_id: guild.id } }), 2);
    assert.equal(await e.AuditLog.count({ where: { guild_id: guild.id, action_type: 42 } }), 1);
    assert.ok(emitted.some((event) => event.event === "INVITE_DELETE" && event.data.code === made[0].code));
});
