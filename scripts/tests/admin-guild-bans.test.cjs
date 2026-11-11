const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test, before, after, mock } = require("node:test");

const database = process.env.ADMIN_GUILD_MODERATION_TEST_DATABASE;
const enabled = Boolean(database);
const routes = ["src/api/routes/admin/guilds/#guild_id/bans/index.ts", "src/api/routes/admin/guilds/#guild_id/bans/#user_id.ts"];
let e, db, list, ban, unban;
const users = [];
const guilds = [];
const emitted = [];

test("ban routes need the server right and check staff hierarchy before writing", () => {
    for (const file of routes) {
        const source = fs.readFileSync(file, "utf8");
        const declared = source.match(/router\.(get|patch|put|post|delete)\(/g) ?? [];
        assert.ok(declared.length > 0, file);
        assert.equal((source.match(/right: "MANAGE_GUILDS"/g) ?? []).length, declared.length, file);
    }
    const writes = fs.readFileSync(routes[1], "utf8");
    assert.match(writes, /await assertCanActOnUser\(req, req\.params\.user_id as string\)/);
    assert.match(writes, /assertMirrorGuildEditable\(guild\)/);
});

const handler = (router, method) => router.stack.find((layer) => layer.route?.stack.some((entry) => entry.method === method)).route.stack.at(-1).handle;

async function invoke(fn, { params, body, query = {}, actor, headers = {} }) {
    let status = 200,
        result;
    const { Rights } = require("../../dist/util/util/Rights");
    await fn(
        { params, body, query, headers, user_id: actor, rights: new Rights("4") },
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

async function account(name, rights = "0") {
    const user = await e.User.create({
        username: `admin bans ${name} ${Date.now()}`,
        discriminator: "0",
        bot: false,
        premium: false,
        premium_type: 0,
        verified: true,
        rights,
        data: { hash: "disposable", valid_tokens_since: new Date() },
        created_at: new Date(),
        settings: await e.UserSettings.create({ locale: "en-US" }).save(),
    }).save();
    users.push(user.id);
    return user;
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
    list = handler(require("../../dist/api/routes/admin/guilds/#guild_id/bans/index").default, "get");
    const one = require("../../dist/api/routes/admin/guilds/#guild_id/bans/#user_id").default;
    ban = handler(one, "put");
    unban = handler(one, "delete");
});

after(async () => {
    if (!enabled) return;
    const { In } = require("typeorm");
    if (guilds.length) {
        await e.AuditLog.delete({ guild_id: In(guilds) });
        await e.Guild.delete({ id: In(guilds) });
    }
    if (users.length) {
        await e.AuditLog.delete({ user_id: In(users) });
        await e.User.delete({ id: In(users) });
    }
    mock.restoreAll();
    await db?.destroy();
});

test("staff ban a member, list the ban by cursor and lift it, with server audit entries", { skip: !enabled }, async () => {
    const owner = await account("owner");
    const actor = await account("actor", "4");
    const first = await account("first");
    const second = await account("second");
    const staff = await account("staff", "4");
    const guild = await e.Guild.createGuild({ name: "Disposable admin ban test", owner_id: owner.id, source_guild_id: null, channels: [] });
    guilds.push(guild.id);
    for (const user of [owner, first, second, staff]) await e.Member.addToGuild(user.id, guild.id);

    const params = (user) => ({ guild_id: guild.id, user_id: user.id });
    assert.equal((await invoke(ban, { params: params(first), body: { reason: "raid" }, actor: actor.id })).status, 204);
    assert.equal((await invoke(ban, { params: params(second), body: {}, actor: actor.id })).status, 204);
    assert.equal(await e.Member.count({ where: { guild_id: guild.id, id: first.id } }), 0);
    await assert.rejects(invoke(ban, { params: params(first), body: {}, actor: actor.id }), /already banned/);
    await assert.rejects(invoke(ban, { params: params(owner), body: {}, actor: actor.id }), /Transfer the server/);
    await assert.rejects(invoke(ban, { params: params(staff), body: {}, actor: actor.id }), /staff at or above/);
    assert.equal(await e.Member.count({ where: { guild_id: guild.id, id: staff.id } }), 1);

    const page = await invoke(list, { params: { guild_id: guild.id }, query: { limit: "1" }, actor: actor.id });
    assert.equal(page.body.total, 2);
    assert.equal(page.body.bans.length, 1);
    assert.equal(page.body.bans[0].executor.id, actor.id);
    const rest = await invoke(list, { params: { guild_id: guild.id }, query: { limit: "1", after: page.body.next }, actor: actor.id });
    assert.equal(rest.body.bans.length, 1);
    assert.equal(rest.body.next, null);
    const found = await invoke(list, { params: { guild_id: guild.id }, query: { q: "bans first" }, actor: actor.id });
    assert.deepEqual(
        found.body.bans.map((entry) => [entry.user.id, entry.reason]),
        [[first.id, "raid"]],
    );

    assert.equal((await invoke(unban, { params: params(first), actor: actor.id })).status, 204);
    await assert.rejects(invoke(unban, { params: params(first), actor: actor.id }), /isn't banned/);
    assert.equal(await e.Ban.count({ where: { guild_id: guild.id, user_id: first.id } }), 0);
    assert.equal(await e.AuditLog.count({ where: { guild_id: guild.id, target_id: first.id, action_type: 22 } }), 1);
    assert.equal(await e.AuditLog.count({ where: { guild_id: guild.id, target_id: first.id, action_type: 23 } }), 1);
    assert.ok(emitted.some((event) => event.event === "GUILD_BAN_REMOVE" && event.guild_id === guild.id));
});
