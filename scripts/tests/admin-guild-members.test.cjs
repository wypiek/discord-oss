const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test, before, after, mock } = require("node:test");

const database = process.env.ADMIN_GUILD_MODERATION_TEST_DATABASE;
const enabled = Boolean(database);
const routes = ["src/api/routes/admin/guilds/#guild_id/members/index.ts", "src/api/routes/admin/guilds/#guild_id/members/#member_id.ts"];
let e, db, config, list, update, remove;
const users = [];
const guilds = [];
const emitted = [];

test("member routes need the server right and check staff hierarchy before writing", () => {
    for (const file of routes) {
        const source = fs.readFileSync(file, "utf8");
        const declared = source.match(/router\.(get|patch|put|post|delete)\(/g) ?? [];
        assert.ok(declared.length > 0, file);
        assert.equal((source.match(/right: "MANAGE_GUILDS"/g) ?? []).length, declared.length, file);
    }
    const writes = fs.readFileSync(routes[1], "utf8");
    assert.match(writes, /await assertCanActOnUser\(req, member_id\)/);
    assert.match(writes, /assertMirrorGuildEditable\(guild\)/);
});

test("cursor helpers reject bad input and return the last id of a full page", () => {
    const { cursorLimit, cursorPage, snowflakeCursor, searchText, likePattern } = require("../../dist/api/util/utility/adminCursor");
    assert.equal(cursorLimit(undefined, 50, 100), 50);
    assert.equal(cursorLimit("100", 50, 100), 100);
    for (const bad of ["0", "101", "1.5", "-1", ["1", "2"]]) assert.throws(() => cursorLimit(bad, 50, 100));
    assert.equal(snowflakeCursor("", "after"), undefined);
    assert.equal(snowflakeCursor("1561486152681164947", "after"), "1561486152681164947");
    for (const bad of ["abc", "99999999999999999999", ["1"]]) assert.throws(() => snowflakeCursor(bad, "after"));
    assert.throws(() => searchText("x".repeat(101)));
    assert.equal(likePattern("50%_off\\"), "%50\\%\\_off\\\\%");
    assert.deepEqual(cursorPage([1, 2, 3], 2, String), { page: [1, 2], next: "2" });
    assert.deepEqual(cursorPage([1, 2], 2, String), { page: [1, 2], next: null });
});

const handler = (router, method) => router.stack.find((layer) => layer.route?.stack.some((entry) => entry.method === method)).route.stack.at(-1).handle;

async function invoke(fn, { params, body, query = {}, actor, rights = "4", headers = {} }) {
    let status = 200,
        result;
    const { Rights } = require("../../dist/util/util/Rights");
    await fn(
        { params, body, query, headers, user_id: actor, rights: new Rights(rights) },
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
        username: `admin members ${name} ${Date.now()}`,
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
    config = new ConfigValue();
    mock.method(Config, "get", () => config);
    mock.method(require("../../dist/util/util/ipc/Event"), "emitEvent", async (event) => emitted.push(event));
    list = handler(require("../../dist/api/routes/admin/guilds/#guild_id/members/index").default, "get");
    const member = require("../../dist/api/routes/admin/guilds/#guild_id/members/#member_id").default;
    update = handler(member, "patch");
    remove = handler(member, "delete");
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

async function fixture() {
    const owner = await account("owner");
    const actor = await account("actor", "4");
    const target = await account("target");
    const staff = await account("staff", String(1n << 2n));
    const guild = await e.Guild.createGuild({ name: "Disposable admin member test", owner_id: owner.id, source_guild_id: null, channels: [] });
    guilds.push(guild.id);
    for (const user of [owner, target, staff]) await e.Member.addToGuild(user.id, guild.id);
    const role = await e.Role.create({
        id: require("../../dist/util/util/Snowflake").Snowflake.generate(),
        guild_id: guild.id,
        name: "Helpers",
        color: 0,
        colors: { primary_color: 0 },
        hoist: false,
        managed: false,
        mentionable: false,
        permissions: "0",
        position: 1,
    }).save();
    return { owner, actor, target, staff, guild, role };
}

test("members page by user id and search by name", { skip: !enabled }, async () => {
    const { guild, owner, target, staff, actor } = await fixture();
    const first = await invoke(list, { params: { guild_id: guild.id }, query: { limit: "2" }, actor: actor.id });
    assert.equal(first.body.total, 3);
    assert.equal(first.body.members.length, 2);
    assert.ok(first.body.next);
    const second = await invoke(list, { params: { guild_id: guild.id }, query: { limit: "2", after: first.body.next }, actor: actor.id });
    assert.equal(second.body.members.length, 1);
    assert.equal(second.body.next, null);
    const ids = [...first.body.members, ...second.body.members].map((member) => member.id);
    assert.deepEqual(
        ids,
        [owner.id, target.id, staff.id].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)),
    );
    const found = await invoke(list, { params: { guild_id: guild.id }, query: { q: "members target" }, actor: actor.id });
    assert.deepEqual(
        found.body.members.map((member) => member.id),
        [target.id],
    );
    assert.equal(found.body.total, null);
    const flags = Object.fromEntries(first.body.members.concat(second.body.members).map((member) => [member.id, member]));
    assert.equal(flags[owner.id].owner, true);
    assert.equal(flags[staff.id].protected, true);
    assert.equal(flags[target.id].protected, false);
});

test("staff can rename, give roles, time out and remove members with server audit entries", { skip: !enabled }, async () => {
    const { guild, target, actor, role } = await fixture();
    const until = new Date(Date.now() + 3600_000).toISOString();
    const result = await invoke(update, {
        params: { guild_id: guild.id, member_id: target.id },
        body: { nick: "Renamed", roles: [role.id], communication_disabled_until: until },
        actor: actor.id,
        headers: { "x-audit-log-reason": encodeURIComponent("spam & links") },
    });
    assert.equal(result.body.nick, "Renamed");
    assert.deepEqual(result.body.roles, [role.id]);
    assert.ok(result.body.communication_disabled_until);
    const entries = await e.AuditLog.find({ where: { guild_id: guild.id, target_id: target.id } });
    assert.ok(entries.some((entry) => entry.action_type === 24 && entry.reason === "spam & links"));
    assert.ok(entries.some((entry) => entry.action_type === 25));
    assert.ok(emitted.some((event) => event.event === "GUILD_MEMBER_UPDATE" && event.guild_id === guild.id));

    await assert.rejects(
        invoke(update, {
            params: { guild_id: guild.id, member_id: target.id },
            body: { communication_disabled_until: new Date(Date.now() + 40 * 86400_000).toISOString() },
            actor: actor.id,
        }),
        /28 days/,
    );
    await assert.rejects(
        invoke(update, { params: { guild_id: guild.id, member_id: target.id }, body: { roles: ["123456789012345678"] }, actor: actor.id }),
        /aren't in the server/,
    );

    const removed = await invoke(remove, { params: { guild_id: guild.id, member_id: target.id }, actor: actor.id });
    assert.equal(removed.status, 204);
    assert.equal(await e.Member.count({ where: { guild_id: guild.id, id: target.id } }), 0);
    assert.equal(await e.AuditLog.count({ where: { guild_id: guild.id, target_id: target.id, action_type: 20 } }), 1);
});

test("the owner can't be timed out or removed and higher staff can't be touched", { skip: !enabled }, async () => {
    const { guild, owner, staff, actor } = await fixture();
    await assert.rejects(
        invoke(update, {
            params: { guild_id: guild.id, member_id: owner.id },
            body: { communication_disabled_until: new Date(Date.now() + 60_000).toISOString() },
            actor: actor.id,
        }),
        /owner can't be timed out/,
    );
    await assert.rejects(invoke(remove, { params: { guild_id: guild.id, member_id: owner.id }, actor: actor.id }), /Transfer the server/);
    await assert.rejects(invoke(update, { params: { guild_id: guild.id, member_id: staff.id }, body: { nick: "nope" }, actor: actor.id }), /staff at or above/);
    await assert.rejects(invoke(remove, { params: { guild_id: guild.id, member_id: staff.id }, actor: actor.id }), /staff at or above/);
    assert.equal(await e.Member.count({ where: { guild_id: guild.id, id: staff.id } }), 1);
});
