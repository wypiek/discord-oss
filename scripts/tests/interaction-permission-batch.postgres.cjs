const assert = require("node:assert/strict");
const { test, before, after, mock } = require("node:test");
const { performance } = require("node:perf_hooks");
const fs = require("node:fs");
const { In } = require("typeorm");
const enabled = process.env.PERMISSION_BATCH_POSTGRES_TEST === "1";
const options = { skip: !enabled };
let db, e, guild, channel, thread, Permissions, getPermission, buildResolved;
const users = [];
before(async () => {
    if (!enabled) return;
    assert.equal(new URL(process.env.DATABASE).pathname, "/fosscord_codex_admin");
    e = require("../../dist/database");
    db = await e.initDatabase();
    ({ getPermission, Permissions } = require("../../dist/util/util/Permissions"));
    ({ buildResolved } = require("../../dist/api/util/handlers/Interaction"));
    const { ConfigValue } = require("../../dist/util/config");
    mock.method(require("../../dist/util/util/Config").Config, "get", () => new ConfigValue());
    mock.method(require("../../dist/util/util/ipc/Event"), "emitEvent", async () => undefined);
    for (let i = 0; i < 33; i++)
        users.push(
            await e.User.create({
                username: `Permission batch disposable ${i}`,
                discriminator: "0",
                bot: false,
                premium: false,
                premium_type: 0,
                verified: true,
                flags: 0,
                rights: "0",
                data: {},
                created_at: new Date(),
            }).save(),
        );
    guild = await e.Guild.createGuild({
        name: "Disposable interaction permission batch",
        owner_id: users[0].id,
        source_guild_id: null,
    });
    channel = await e.Channel.findOneOrFail({ where: { guild_id: guild.id, type: 0 } });
    await e.Role.update(
        { id: guild.id },
        {
            permissions: new Permissions(["VIEW_CHANNEL", "SEND_MESSAGES", "READ_MESSAGE_HISTORY"]).bitfield.toString(),
        },
    );
    for (const user of users)
        await e.Member.create({
            id: user.id,
            guild_id: guild.id,
            joined_at: new Date(),
            deaf: false,
            mute: false,
            pending: false,
            flags: 0,
            bio: "",
            settings: {},
            roles: [e.Role.create({ id: guild.id })],
        }).save();
    await e.Member.update({ id: users[1].id, guild_id: guild.id }, { communication_disabled_until: new Date(Date.now() + 60000) });
    await e.Member.update({ id: users[2].id, guild_id: guild.id }, { flags: Permissions.AUTOMOD_QUARANTINE_MEMBER_FLAGS });
    const { UserFlags } = require("../../dist/schemas");
    await e.User.update({ id: users[3].id }, { flags: Number(UserFlags.FLAGS.QUARANTINED) });
    const admin = await e.Role.create({
        guild_id: guild.id,
        name: "Disposable administrator role",
        permissions: Permissions.FLAGS.ADMINISTRATOR.toString(),
        color: 0,
        colors: { primary_color: 0 },
        hoist: false,
        mentionable: false,
        position: 1,
    }).save();
    const member = await e.Member.findOneOrFail({ where: { id: users[4].id, guild_id: guild.id } });
    await e.Member.createQueryBuilder().relation(e.Member, "roles").of(member.index).add(admin.id);
    await e.Channel.update(
        { id: channel.id },
        {
            permission_overwrites: [{ id: users[5].id, type: 1, allow: "0", deny: Permissions.FLAGS.VIEW_CHANNEL.toString() }],
        },
    );
    thread = await e.Channel.create({
        guild_id: guild.id,
        parent_id: channel.id,
        name: "Disposable batch private thread",
        type: 12,
        permission_overwrites: [],
        created_at: new Date(),
    }).save();
    const joined = await e.Member.findOneOrFail({ where: { id: users[6].id, guild_id: guild.id } });
    await e.ThreadMember.create({
        id: thread.id,
        member_idx: joined.index,
        user_id: joined.id,
        join_timestamp: new Date(),
        muted: false,
        flags: 0,
    }).save();
});
after(async () => {
    if (!enabled) return;
    mock.restoreAll();
    if (guild) {
        await e.AuditLog.delete({ guild_id: guild.id });
        await e.Guild.delete({ id: guild.id });
    }
    for (const user of users) {
        await e.UserSettingsProtos.delete({ user_id: user.id });
        await e.User.delete({ id: user.id });
    }
    await db?.destroy();
});
async function counted(fn) {
    let queries = 0;
    const original = db.logger.logQuery;
    db.logger.logQuery = () => queries++;
    const start = performance.now();
    try {
        return { result: await fn(), queries, milliseconds: performance.now() - start };
    } finally {
        db.logger.logQuery = original;
    }
}
async function legacy(target) {
    const found = await e.User.find({ where: { id: In(users.map((user) => user.id)) } });
    const members = await e.Member.find({
        where: { guild_id: guild.id, id: In(found.map((user) => user.id)) },
        relations: { roles: true },
    });
    return Object.fromEntries(
        await Promise.all(
            members.map(async (m) => {
                const { user, ...rest } = m.toPublicMember();
                void user;
                return [
                    m.id,
                    {
                        ...rest,
                        roles: rest.roles?.filter((id) => id !== guild.id),
                        permissions: (await getPermission(m.id, guild.id, target)).bitfield.toString(),
                    },
                ];
            }),
        ),
    );
}
const current = async (target) => (await buildResolved(undefined, guild.id, target, { users: users.map((user) => user.id) })).members;

test("33 distinct members keep owner, roles, timeout, quarantine and overwrites with constant query count", options, async () => {
    const baseline = await counted(() => legacy(channel.id));
    const optimized = await counted(() => current(channel.id));
    assert.deepEqual(optimized.result, baseline.result);
    assert.equal(optimized.queries, 4);
    assert.ok(baseline.queries >= 130, `baseline queries ${baseline.queries}`);
    for (const index of [1, 2, 3]) assert.equal(new Permissions(optimized.result[users[index].id].permissions).has("SEND_MESSAGES"), false);
    assert.equal(new Permissions(optimized.result[users[0].id].permissions).has("ADMINISTRATOR"), true);
    assert.equal(new Permissions(optimized.result[users[4].id].permissions).has("ADMINISTRATOR"), true);
    assert.equal(new Permissions(optimized.result[users[5].id].permissions).has("VIEW_CHANNEL"), false);
    const samples = [];
    for (let i = 0; i < 5; i++) {
        const before = await counted(() => legacy(channel.id));
        const after = await counted(() => current(channel.id));
        samples.push({
            before: { queries: before.queries, milliseconds: before.milliseconds },
            after: { queries: after.queries, milliseconds: after.milliseconds },
        });
    }
    const report = {
        fixture_members: 33,
        permissions_match: true,
        baseline_queries: baseline.queries,
        optimized_queries: optimized.queries,
        samples,
    };
    if (process.env.PERMISSION_BATCH_REPORT) fs.writeFileSync(process.env.PERMISSION_BATCH_REPORT, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
});

test("batch reuse retains private thread membership and administrator behavior", options, async () => {
    assert.deepEqual(await current(thread.id), await legacy(thread.id));
    const resolved = await current(thread.id);
    assert.equal(new Permissions(resolved[users[6].id].permissions).has("VIEW_CHANNEL"), true);
    assert.equal(new Permissions(resolved[users[7].id].permissions).bitfield, 0n);
    assert.equal(new Permissions(resolved[users[4].id].permissions).has("VIEW_CHANNEL"), true);
    await e.ThreadMember.delete({ id: thread.id, user_id: users[6].id });
    assert.deepEqual(await current(thread.id), await legacy(thread.id));
    assert.equal(new Permissions((await current(thread.id))[users[6].id].permissions).bitfield, 0n);
});

test("new interaction calls immediately see revoked permissions and memberships", options, async () => {
    await e.Role.update({ id: guild.id }, { permissions: Permissions.FLAGS.VIEW_CHANNEL.toString() });
    assert.deepEqual(await current(channel.id), await legacy(channel.id));
    assert.equal(new Permissions((await current(channel.id))[users[8].id].permissions).has("SEND_MESSAGES"), false);
    await e.Member.delete({ id: users[8].id, guild_id: guild.id });
    const next = await current(channel.id);
    assert.equal(Object.hasOwn(next, users[8].id), false);
    assert.deepEqual(next, await legacy(channel.id));
});
