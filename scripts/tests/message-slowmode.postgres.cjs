const assert = require("node:assert/strict");
const { test, before, after, mock } = require("node:test");
const { EntityManager } = require("typeorm");
const { Client } = require("pg");
const { randomUUID } = require("node:crypto");
const enabled = process.env.MESSAGE_SLOWMODE_TEST === "1";
let config, db, entities, owner, user, Permissions, getPermission, publishUserMessage, handleMessage, assertMessageSlowmode;
const emitted = [];
let admin;
let databaseName;
let createdDatabase = false;

before(async () => {
    if (!enabled) return;
    assert.ok(process.env.DATABASE_TEST_ADMIN_URL, "Provide a PostgreSQL connection with database creation permission");
    admin = new Client({ connectionString: process.env.DATABASE_TEST_ADMIN_URL });
    await admin.connect();
    databaseName = `meowcord_slowmode_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    createdDatabase = true;
    const url = new URL(process.env.DATABASE_TEST_ADMIN_URL);
    url.protocol = "postgres:";
    url.pathname = `/${databaseName}`;
    process.env.DATABASE = url.toString();
    process.env.APPLY_DB_MIGRATIONS = "true";
    process.env.DB_POOL_SIZE = "4";
    delete process.env.DB_SYNC;
    delete process.env.DB_LOGGING;
    entities = require("../../dist/database");
    db = await entities.initDatabase();
    ({ Permissions, getPermission } = require("../../dist/util/util/Permissions"));
    ({ publishUserMessage } = require("../../dist/api/util/handlers/UserMessage"));
    ({ handleMessage } = require("../../dist/api/util/handlers/Message"));
    ({ assertMessageSlowmode } = require("../../dist/api/util/handlers/Slowmode"));
    const { ConfigValue } = require("../../dist/util/config");
    config = new ConfigValue();
    mock.method(require("../../dist/util/util/Config").Config, "get", () => config);
    mock.method(require("../../dist/util/util/ipc/Event"), "emitEvent", async (event) => emitted.push(event));
    mock.method(require("../../dist/api/util/handlers/Message"), "postHandleMessage", async () => undefined);
    owner = await entities.User.register({ username: "slowmode_owner" });
    user = await entities.User.register({ username: "slowmode_member" });
});

after(async () => {
    if (!enabled) return;
    mock.restoreAll();
    try {
        if (db?.isInitialized) await db.destroy();
        if (createdDatabase) {
            const began = Date.now();
            let connections;
            do {
                const result = await admin.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1", [databaseName]);
                connections = result.rows[0].count;
                if (connections) await new Promise((resolve) => setTimeout(resolve, 25));
            } while (connections && Date.now() - began < 5000);
            assert.equal(connections, 0, "The disposable slowmode database must have no remaining connections");
            await admin.query(`DROP DATABASE "${databaseName}"`);
        }
    } finally {
        await admin?.end();
    }
});

async function fixture(rate = 2) {
    const guild = await entities.Guild.createGuild({
        name: "Disposable slowmode transaction test",
        owner_id: owner.id,
        source_guild_id: null,
    });
    await entities.Member.create({
        id: owner.id,
        guild_id: guild.id,
        joined_at: new Date(),
        deaf: false,
        mute: false,
        pending: false,
        bio: "",
        settings: {},
        roles: [entities.Role.create({ id: guild.id })],
    }).save();
    const member = await entities.Member.create({
        id: user.id,
        guild_id: guild.id,
        joined_at: new Date(),
        deaf: false,
        mute: false,
        pending: false,
        bio: "",
        settings: {},
        roles: [entities.Role.create({ id: guild.id })],
    }).save();
    const channel = await entities.Channel.findOneOrFail({
        where: { guild_id: guild.id, type: 0 },
        relations: { recipients: true },
    });
    const result = { guild, member, channel };
    await entities.Channel.update({ id: channel.id }, { rate_limit_per_user: rate });
    channel.rate_limit_per_user = rate;
    return result;
}

async function send(fixture, content = "Slowmode test", override, message_id) {
    const channel = await entities.Channel.findOneOrFail({
        where: { id: fixture.channel.id },
        relations: { recipients: true },
    });
    const permission = override ?? (await getPermission(user.id, fixture.guild.id, channel, { user }));
    return publishUserMessage({
        channel,
        user_id: user.id,
        body: { content },
        message_id: message_id ?? require("../../dist/util/util/Snowflake").Snowflake.generate(),
        attachments: [],
        permission,
    });
}
const isLimited = (error) => error.httpStatus === 429 && error.code === 20016 && error.retry_after > 0 && error.retry_after <= 21600;

test("sequential sends return the remaining cooldown, then accept after expiry", { skip: !enabled }, async () => {
    const item = await fixture(1);
    const first = await send(item);
    await assert.rejects(send(item), isLimited);
    assert.equal((await entities.Channel.findOneByOrFail({ id: item.channel.id })).last_message_id, first.id);
    await new Promise((resolve) => setTimeout(resolve, 1050));
    const second = await send(item);
    assert.notEqual(second.id, first.id);
    assert.equal((await entities.Channel.findOneByOrFail({ id: item.channel.id })).last_message_id, second.id);
});

test("concurrent sends persist exactly one message and consistent channel/read/member state", { skip: !enabled }, async () => {
    const item = await fixture();
    const results = await Promise.allSettled(Array.from({ length: 16 }, (_, i) => send(item, `Concurrent ${i}`)));
    const accepted = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 15);
    assert.ok(rejected.every((result) => isLimited(result.reason)));
    assert.equal(await entities.Message.countBy({ channel_id: item.channel.id, author_id: user.id }), 1);
    const message = accepted[0].value;
    assert.equal((await entities.Channel.findOneByOrFail({ id: item.channel.id })).last_message_id, message.id);
    assert.equal((await entities.Member.findOneByOrFail({ index: item.member.index })).last_message_id, message.id);
    assert.equal((await entities.ReadState.findOneByOrFail({ channel_id: item.channel.id, user_id: user.id })).last_message_id, message.id);
    assert.equal(emitted.filter((event) => event.event === "MESSAGE_CREATE" && event.channel_id === item.channel.id).length, 1);
});

test("failed save rolls back channel/read state and consumes no cooldown", { skip: !enabled }, async () => {
    const item = await fixture();
    const before = (await entities.Channel.findOneByOrFail({ id: item.channel.id })).last_message_id;
    const original = EntityManager.prototype.save;
    const injected = mock.method(EntityManager.prototype, "save", function (target, ...args) {
        if (target instanceof entities.Message) return Promise.reject(new Error("Injected persistence failure"));
        return original.call(this, target, ...args);
    });
    try {
        await assert.rejects(send(item), /Injected persistence failure/);
    } finally {
        injected.mock.restore();
    }
    assert.equal(await entities.Message.countBy({ channel_id: item.channel.id }), 0);
    assert.equal(await entities.RateLimit.countBy({ id: `message-slowmode:${item.channel.id}:${user.id}` }), 0);
    assert.equal(await entities.ReadState.countBy({ channel_id: item.channel.id, user_id: user.id }), 0);
    assert.equal((await entities.Channel.findOneByOrFail({ id: item.channel.id })).last_message_id, before);
    assert.ok((await send(item)).id);
});

test("deleting a successful message cannot reset its cooldown", { skip: !enabled }, async () => {
    const item = await fixture();
    const message = await send(item);
    await entities.Message.delete({ id: message.id });
    await assert.rejects(send(item), isLimited);
    const marker = await entities.RateLimit.findOneByOrFail({
        id: `message-slowmode:${item.channel.id}:${user.id}`,
    });
    assert.equal(marker.hits, 21600);
    assert.ok(marker.expires_at.getTime() - Date.now() <= 21600000);
    assert.ok(marker.expires_at.getTime() - Date.now() > 21590000);
});

test("duration changes use the last successful send; disabling allows sends and re-enabling applies the latest send", { skip: !enabled }, async () => {
    const item = await fixture(10);
    await send(item);
    await entities.Channel.update({ id: item.channel.id }, { rate_limit_per_user: 20 });
    await assert.rejects(send(item), (error) => isLimited(error) && error.retry_after > 19);
    await entities.Channel.update({ id: item.channel.id }, { rate_limit_per_user: 1 });
    await assert.rejects(send(item), (error) => isLimited(error) && error.retry_after <= 1);
    await entities.Channel.update({ id: item.channel.id }, { rate_limit_per_user: 0 });
    assert.ok((await send(item)).id);
    await entities.Channel.update({ id: item.channel.id }, { rate_limit_per_user: 2 });
    await assert.rejects(send(item), isLimited);
    await entities.RateLimit.delete({ id: `message-slowmode:${item.channel.id}:${user.id}` });
    await assert.rejects(send(item), isLimited);
});

test("moderator and explicit bypass permissions obey slowmode by default", { skip: !enabled }, async () => {
    assert.equal(config.limits.channel.allowSlowmodeBypass, false);
    for (const flag of ["MANAGE_MESSAGES", "MANAGE_CHANNELS", "BYPASS_SLOWMODE", "ADMINISTRATOR"]) {
        const item = await fixture();
        const permission = new Permissions(["VIEW_CHANNEL", "SEND_MESSAGES", flag]);
        assert.ok((await send(item, flag, permission)).id);
        await assert.rejects(send(item, flag, permission), isLimited);
        assert.equal(await entities.RateLimit.countBy({ id: `message-slowmode:${item.channel.id}:${user.id}` }), 1);
    }
});

test("guild owner concurrent sends admit exactly one message by default", { skip: !enabled }, async () => {
    const item = await fixture();
    const channel = await entities.Channel.findOneOrFail({
        where: { id: item.channel.id },
        relations: { recipients: true },
    });
    const permission = await getPermission(owner.id, item.guild.id, channel, { user: owner });
    const results = await Promise.allSettled(
        Array.from({ length: 16 }, () =>
            publishUserMessage({
                channel,
                user_id: owner.id,
                body: { content: "Owner obeys slowmode" },
                message_id: require("../../dist/util/util/Snowflake").Snowflake.generate(),
                attachments: [],
                permission,
            }),
        ),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected" && isLimited(result.reason)).length, 15);
    assert.equal(await entities.Message.countBy({ channel_id: channel.id, author_id: owner.id }), 1);
});

test("explicit instance opt-in restores moderator bypass while ordinary users remain limited", { skip: !enabled }, async () => {
    config.limits.channel.allowSlowmodeBypass = true;
    try {
        for (const flag of ["MANAGE_MESSAGES", "MANAGE_CHANNELS", "BYPASS_SLOWMODE", "ADMINISTRATOR"]) {
            const item = await fixture();
            const permission = new Permissions(["VIEW_CHANNEL", "SEND_MESSAGES", flag]);
            assert.ok((await send(item, flag, permission)).id);
            assert.ok((await send(item, flag, permission)).id);
            assert.equal(
                await entities.RateLimit.countBy({
                    id: `message-slowmode:${item.channel.id}:${user.id}`,
                }),
                0,
            );
        }
        const item = await fixture();
        const channel = await entities.Channel.findOneOrFail({
            where: { id: item.channel.id },
            relations: { recipients: true },
        });
        const permission = await getPermission(owner.id, item.guild.id, channel, { user: owner });
        for (let i = 0; i < 2; i++)
            await publishUserMessage({
                channel,
                user_id: owner.id,
                body: { content: "Owner explicit bypass" },
                message_id: require("../../dist/util/util/Snowflake").Snowflake.generate(),
                attachments: [],
                permission,
            });
        assert.ok((await send(item)).id);
        await assert.rejects(send(item), isLimited);
    } finally {
        config.limits.channel.allowSlowmodeBypass = false;
    }
});

test("message edits and webhook messages bypass user slowmode while the user's cooldown remains", { skip: !enabled }, async () => {
    const item = await fixture();
    const first = await send(item);
    const channel = await entities.Channel.findOneOrFail({
        where: { id: item.channel.id },
        relations: { recipients: true },
    });
    const permission = await getPermission(user.id, item.guild.id, channel, { user });
    const edited = await handleMessage(
        {
            id: first.id,
            author_id: user.id,
            channel_id: channel.id,
            content: "Edited during cooldown",
            timestamp: first.timestamp,
            edited_timestamp: new Date(),
        },
        { channel, permission },
    );
    assert.equal(edited.content, "Edited during cooldown");
    const webhook = await entities.Webhook.create({
        guild_id: item.guild.id,
        channel_id: channel.id,
        user_id: owner.id,
        type: 1,
        name: "Disposable slowmode webhook",
    }).save();

    for (let i = 0; i < 2; i++) {
        const message = await handleMessage({
            id: require("../../dist/util/util/Snowflake").Snowflake.generate(),
            webhook_id: webhook.id,
            channel_id: channel.id,
            content: "Webhook exempt",
            timestamp: new Date(),
        });
        await message.save();
    }
    await assert.rejects(assertMessageSlowmode(channel, user.id, permission), isLimited);
});

test("disabled slowmode keeps user messages working without an additional permission read", { skip: !enabled }, async () => {
    const item = await fixture(0);
    const module = require("../../dist/util/util/Permissions");
    const original = module.getPermission;
    let reads = 0;
    const counted = mock.method(module, "getPermission", (...args) => {
        reads++;
        return original(...args);
    });
    try {
        const channel = await entities.Channel.findOneOrFail({
            where: { id: item.channel.id },
            relations: { recipients: true },
        });
        for (let i = 0; i < 2; i++)
            await publishUserMessage({
                channel,
                user_id: user.id,
                body: { content: "Disabled slowmode send" },
                message_id: require("../../dist/util/util/Snowflake").Snowflake.generate(),
                attachments: [],
            });
        assert.equal(reads, 2);
        assert.equal(await entities.Message.countBy({ channel_id: channel.id }), 2);
    } finally {
        counted.mock.restore();
    }
});

test("deferred channel updates preserve ephemeral message counter and last-message exclusions", { skip: !enabled }, async () => {
    const item = await fixture(0);
    const parent = item.channel;
    const thread = await entities.Channel.create({
        guild_id: item.guild.id,
        parent_id: parent.id,
        name: "Disposable ephemeral thread",
        type: 11,
        created_at: new Date(),
        permission_overwrites: [],
        message_count: 0,
        total_message_sent: 0,
        thread_metadata: {
            archived: false,
            locked: false,
            archive_timestamp: new Date().toISOString(),
            create_timestamp: new Date().toISOString(),
            auto_archive_duration: 1440,
        },
    }).save();
    const channel = await entities.Channel.findOneOrFail({
        where: { id: thread.id },
        relations: { recipients: true },
    });
    const before = channel.last_message_id;
    const permission = await getPermission(user.id, item.guild.id, channel, { user });
    await publishUserMessage({
        channel,
        user_id: user.id,
        body: { content: "Ephemeral exclusions", flags: 64 },
        message_id: require("../../dist/util/util/Snowflake").Snowflake.generate(),
        attachments: [],
        permission,
    });
    const stored = await entities.Channel.findOneByOrFail({ id: channel.id });
    assert.equal(stored.last_message_id, before);
    assert.equal(stored.message_count, 0);
    assert.equal(stored.total_message_sent, 0);
});

test("concurrent disabled and exempt sends create one readstate while preserving its ID and acknowledgement fields", { skip: !enabled }, async () => {
    config.limits.channel.allowSlowmodeBypass = true;
    try {
        for (const mode of ["disabled", "exempt"]) {
            const item = await fixture(mode === "disabled" ? 0 : 2);
            const permission = mode === "exempt" ? new Permissions(["VIEW_CHANNEL", "SEND_MESSAGES", "MANAGE_MESSAGES"]) : undefined;
            const sent = await Promise.all(Array.from({ length: 16 }, (_, i) => send(item, `${mode} concurrent ${i}`, permission)));
            assert.equal(sent.length, 16);
            assert.equal(await entities.Message.countBy({ channel_id: item.channel.id }), 16);
            assert.equal(await entities.ReadState.countBy({ channel_id: item.channel.id, user_id: user.id }), 1);
            const state = await entities.ReadState.findOneByOrFail({
                channel_id: item.channel.id,
                user_id: user.id,
            });
            await entities.ReadState.update(
                { id: state.id },
                {
                    flags: 3,
                    last_acked_id: sent[0].id,
                    notifications_cursor: sent[1].id,
                    badge_count: 7,
                    mention_count: 4,
                },
            );
            await Promise.all([send(item, `${mode} subsequent one`, permission), send(item, `${mode} subsequent two`, permission)]);
            const preserved = await entities.ReadState.findOneByOrFail({
                channel_id: item.channel.id,
                user_id: user.id,
            });
            assert.equal(preserved.id, state.id);
            assert.equal(preserved.flags, 3);
            assert.equal(preserved.last_acked_id, sent[0].id);
            assert.equal(preserved.notifications_cursor, sent[1].id);
            assert.equal(preserved.badge_count, 7);
            assert.equal(preserved.mention_count, 0);
        }
    } finally {
        config.limits.channel.allowSlowmodeBypass = false;
    }
});

test("an older concurrent send cannot rewind the sender's readstate", { skip: !enabled }, async () => {
    const item = await fixture(0);
    const older = require("../../dist/util/util/Snowflake").Snowflake.generate();
    const newer = (BigInt(older) + 1n).toString();
    await send(item, "Newer send completes first", undefined, newer);
    await send(item, "Older send completes last", undefined, older);
    const state = await entities.ReadState.findOneByOrFail({
        channel_id: item.channel.id,
        user_id: user.id,
    });
    assert.equal(state.last_message_id, newer);
});

async function sendWithNonce(item, nonce) {
    const channel = await entities.Channel.findOneOrFail({
        where: { id: item.channel.id },
        relations: { recipients: true },
    });
    return publishUserMessage({
        channel,
        user_id: user.id,
        body: { content: "Nonce test", nonce },
        message_id: require("../../dist/util/util/Snowflake").Snowflake.generate(),
        attachments: [],
        permission: await getPermission(user.id, item.guild.id, channel, { user }),
    });
}

test("a send that commits after a newer one leaves the channel and member on the newer message", { skip: !enabled }, async () => {
    const item = await fixture(0);
    const { Snowflake } = require("../../dist/util/util/Snowflake");
    const older = Snowflake.generate();
    const newer = Snowflake.generate();
    assert.ok(BigInt(older) < BigInt(newer));
    await send(item, "newer", undefined, newer);
    await send(item, "older", undefined, older);
    assert.equal(String((await entities.Channel.findOneByOrFail({ id: item.channel.id })).last_message_id), newer);
    assert.equal(String((await entities.Member.findOneByOrFail({ id: user.id, guild_id: item.guild.id })).last_message_id), newer);
});

test("concurrent sends with the same nonce store and announce one message", { skip: !enabled }, async () => {
    for (const rate of [0, 2]) {
        const item = await fixture(rate);
        const nonce = `nonce-${rate}-${Date.now()}`;
        const before = emitted.length;
        const results = await Promise.all(Array.from({ length: 8 }, () => sendWithNonce(item, nonce)));
        assert.equal(new Set(results.map((message) => message.id)).size, 1);
        assert.equal(await entities.Message.countBy({ channel_id: item.channel.id, nonce }), 1);
        assert.equal(emitted.slice(before).filter((event) => event.event === "MESSAGE_CREATE").length, 1);
        assert.equal(String((await entities.Channel.findOneByOrFail({ id: item.channel.id })).last_message_id), results[0].id);
    }
});
