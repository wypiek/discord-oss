const assert = require("node:assert/strict");
const { test, before, after, mock } = require("node:test");

const enabled = process.env.PERMISSION_QUERY_TEST === "1";
let db, entities, getPermission, Permissions, guild, member, channel, user;

before(async () => {
    if (!enabled) return;
    assert.equal(new URL(process.env.DATABASE).pathname, "/fosscord_codex_admin");
    entities = require("../../dist/database");
    db = await entities.initDatabase();
    ({ getPermission, Permissions } = require("../../dist/util/util/Permissions"));
    const { ConfigValue } = require("../../dist/util/config");
    mock.method(require("../../dist/util/util/Config").Config, "get", () => new ConfigValue());
    mock.method(require("../../dist/util/util/ipc/Event"), "emitEvent", async () => undefined);
    const users = await entities.User.find({
        where: { bot: false },
        select: { id: true, flags: true },
        take: 2,
    });
    assert.equal(users.length, 2);
    user = users[1];
    guild = await entities.Guild.createGuild({
        name: "Disposable permission query test",
        owner_id: users[0].id,
        source_guild_id: null,
    });
    await entities.Guild.update({ id: guild.id }, { features: [] });
    member = await entities.Member.create({
        id: user.id,
        guild_id: guild.id,
        joined_at: new Date(),
        deaf: false,
        mute: false,
        pending: false,
        bio: "Retained public member bio",
        nick: "Retained nickname",
        pronouns: "they/them",
        avatar_decoration_data: { asset: "retained-local-asset", sku_id: "123456789012345678" },
        settings: {},
        roles: [entities.Role.create({ id: guild.id })],
    }).save();
    channel = await entities.Channel.findOneOrFail({ where: { guild_id: guild.id, type: 0 } });
    await entities.Role.update(
        { id: guild.id },
        {
            permissions: new Permissions(["VIEW_CHANNEL", "SEND_MESSAGES", "READ_MESSAGE_HISTORY"]).bitfield.toString(),
        },
    );
});

after(async () => {
    if (!enabled) return;
    mock.restoreAll();
    if (guild) {
        await entities.AuditLog.delete({ guild_id: guild.id });
        await entities.Guild.delete({ id: guild.id });
    }
    if (db) await db.destroy();
});

const permission = (target = channel.id, options = {}) => getPermission(user.id, guild.id, target, { user, ...options });
const snapshot = (result) => JSON.parse(JSON.stringify({ bitfield: result.bitfield.toString(), cache: result.cache }));

async function counted(fn) {
    let queries = 0;
    const original = db.logger.logQuery;
    db.logger.logQuery = () => queries++;
    try {
        return { result: await fn(), queries };
    } finally {
        db.logger.logQuery = original;
    }
}

async function legacyFinders(fn) {
    const channelFinder = mock.method(entities.Channel, "createQueryBuilder", () => ({
        setFindOptions(options) {
            return { getOneOrFail: () => entities.Channel.findOneOrFail(options) };
        },
    }));
    const memberFinder = mock.method(entities.Member, "createQueryBuilder", () => ({
        setFindOptions(options) {
            return { getOne: () => entities.Member.findOne(options) };
        },
    }));
    try {
        return await fn();
    } finally {
        channelFinder.mock.restore();
        memberFinder.mock.restore();
    }
}

test("unique permission reads retain the complete hydration and eliminate two SQL round trips", { skip: !enabled }, async () => {
    const legacy = await legacyFinders(() => counted(() => permission()));
    const current = await counted(() => permission());
    assert.deepEqual(snapshot(current.result), snapshot(legacy.result));
    assert.equal(legacy.queries, 5);
    assert.equal(current.queries, 3);
    assert.equal(current.result.cache.member.bio, "Retained public member bio");
    assert.equal(current.result.cache.member.pronouns, "they/them");
    assert.equal(current.result.cache.member.avatar_decoration_data.asset, "retained-local-asset");
    assert.deepEqual(current.result.cache.member.toPublicMember(), legacy.result.cache.member.toPublicMember());
    const options = {
        member_relations: ["user"],
        guild_select: ["features"],
        channel_select: ["name"],
    };
    const withRelations = await permission(channel.id, options);
    const legacyRelations = await legacyFinders(() => permission(channel.id, options));
    assert.deepEqual(snapshot(withRelations), snapshot(legacyRelations));
    assert.equal(withRelations.cache.member.user.id, user.id);
    assert.equal(withRelations.cache.channel.name, channel.name);
});

test("permission and role assignment revocation take effect on the very next read", { skip: !enabled }, async () => {
    assert.equal((await permission()).has("SEND_MESSAGES"), true);
    await entities.Role.update(
        { id: guild.id },
        {
            permissions: new Permissions(["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"]).bitfield.toString(),
        },
    );
    assert.equal((await permission()).has("SEND_MESSAGES"), false);
    const role = await entities.Role.create({
        guild_id: guild.id,
        name: "Disposable permission role",
        permissions: Permissions.FLAGS.SEND_MESSAGES.toString(),
        color: 0,
        colors: { primary_color: 0 },
        hoist: false,
        mentionable: false,
        position: 1,
    }).save();
    await entities.Member.createQueryBuilder().relation(entities.Member, "roles").of(member.index).add(role.id);
    assert.equal((await permission()).has("SEND_MESSAGES"), true);
    await entities.Member.createQueryBuilder().relation(entities.Member, "roles").of(member.index).remove(role.id);
    assert.equal((await permission()).has("SEND_MESSAGES"), false);
    await entities.Role.update(
        { id: guild.id },
        {
            permissions: new Permissions(["VIEW_CHANNEL", "SEND_MESSAGES", "READ_MESSAGE_HISTORY"]).bitfield.toString(),
        },
    );
});

test("timeouts, quarantine and channel blocking are read without stale permission state", { skip: !enabled }, async () => {
    await entities.Member.update({ index: member.index }, { communication_disabled_until: new Date(Date.now() + 60000) });
    assert.equal((await permission()).has("SEND_MESSAGES"), false);
    await entities.Member.update({ index: member.index }, { communication_disabled_until: null });
    assert.equal((await permission()).has("SEND_MESSAGES"), true);
    await entities.Member.update({ index: member.index }, { flags: Permissions.AUTOMOD_QUARANTINE_MEMBER_FLAGS });
    assert.equal((await permission()).has("SEND_MESSAGES"), false);
    await entities.Member.update({ index: member.index }, { flags: 0 });
    await entities.Channel.update(
        { id: channel.id },
        {
            permission_overwrites: [{ id: user.id, type: 1, allow: "0", deny: Permissions.FLAGS.VIEW_CHANNEL.toString() }],
        },
    );
    assert.equal((await permission()).has("VIEW_CHANNEL"), false);
    await entities.Channel.update({ id: channel.id }, { permission_overwrites: [] });
    assert.equal((await permission()).has("VIEW_CHANNEL"), true);
});

test("private thread membership removal and manage-threads revocation block the next read", { skip: !enabled }, async () => {
    const thread = await entities.Channel.create({
        guild_id: guild.id,
        parent_id: channel.id,
        name: "Disposable private thread",
        type: 12,
        permission_overwrites: [],
        created_at: new Date(),
    }).save();
    const joined = await entities.ThreadMember.create({
        id: thread.id,
        member_idx: member.index,
        user_id: user.id,
        join_timestamp: new Date(),
        muted: false,
        flags: 0,
    }).save();
    assert.equal((await permission(thread.id)).has("VIEW_CHANNEL"), true);
    assert.deepEqual(snapshot(await permission(thread.id)), snapshot(await legacyFinders(() => permission(thread.id))));
    await entities.ThreadMember.update({ index: joined.index }, { user_id: null });
    assert.equal((await permission(thread.id)).has("VIEW_CHANNEL"), true);
    await entities.ThreadMember.delete({ index: joined.index });
    assert.equal((await permission(thread.id)).bitfield, 0n);
    await entities.Role.update(
        { id: guild.id },
        {
            permissions: new Permissions(["VIEW_CHANNEL", "SEND_MESSAGES", "MANAGE_THREADS"]).bitfield.toString(),
        },
    );
    assert.equal((await permission(thread.id)).has("VIEW_CHANNEL"), true);
    await entities.Role.update({ id: guild.id }, { permissions: Permissions.FLAGS.VIEW_CHANNEL.toString() });
    assert.equal((await permission(thread.id)).bitfield, 0n);
});

test("removed guild membership fails immediately without cached authorization", { skip: !enabled }, async () => {
    await entities.Member.delete({ index: member.index });
    await assert.rejects(permission(), { name: "EntityNotFoundError" });
});
