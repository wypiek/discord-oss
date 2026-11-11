const assert = require("node:assert/strict");
const { test, before, after, beforeEach, mock } = require("node:test");
const enabled = process.env.E2EE_PRIVATE_DEFAULT_TEST === "1";
const options = { skip: !enabled };
let entities, db, config, util, users;
const channels = new Set();
const events = [];

before(async () => {
    if (!enabled) return;
    assert.equal(new URL(process.env.DATABASE).pathname, "/fosscord_codex_admin");
    entities = require("../../dist/database");
    db = await entities.initDatabase();
    config = new (require("../../dist/util/config").ConfigValue)();
    mock.method(require("../../dist/util/util/Config").Config, "get", () => config);
    mock.method(require("../../dist/util/util/ipc/Event"), "emitEvent", async (event) => events.push(event));
    util = require("../../dist/api/util/utility/e2ee");
    users = await Promise.all(
        Array.from({ length: 3 }, (_, index) =>
            entities.User.create({
                username: `Disposable private encryption ${index}`,
                discriminator: "0000",
                bot: false,
                premium: false,
                premium_type: 0,
                verified: true,
                rights: "33554432",
                data: { valid_tokens_since: new Date() },
                created_at: new Date(),
            }).save(),
        ),
    );
});
beforeEach(() => {
    if (enabled) config.limits.e2ee.encryptPrivateByDefault = true;
});
after(async () => {
    if (!enabled) return;
    for (const id of channels) await entities.Channel.delete({ id });
    for (const user of users ?? []) await entities.User.delete({ id: user.id });
    mock.restoreAll();
    if (db) await db.destroy();
});
const create = async (recipients) => {
    const dto = await entities.Channel.createDMChannel(
        recipients.map((user) => user.id),
        users[0].id,
    );
    channels.add(dto.id);
    return dto;
};
const get = (id) => entities.Channel.findOneOrFail({ where: { id }, relations: { recipients: true } });
const isRequired = (error) => error.code === 90002 && error.httpStatus === 400;

test("new direct, group and self conversations are encrypted without waiting for device setup", options, async () => {
    assert.equal(config.limits.e2ee.trustServerByDefault, true);
    for (const recipients of [[users[1]], [users[1], users[2]], []]) {
        const dto = await create(recipients);
        assert.ok(dto.e2ee_enabled_at);
        const channel = await get(dto.id);
        assert.equal(channel.e2ee_enabled_at.toISOString(), dto.e2ee_enabled_at);
        await assert.rejects(util.applyE2eeToMessage({ author_id: users[0].id, content: "plaintext" }, channel, entities.Message.create({ content: "plaintext" })), isRequired);
    }
});

test("reopening historical conversations upgrades once and preserves plaintext history", options, async () => {
    config.limits.e2ee.encryptPrivateByDefault = false;
    const dto = await create([users[1]]);
    await entities.Channel.update({ id: dto.id }, { e2ee_enabled_at: null });
    const legacy = await entities.Message.create({
        channel_id: dto.id,
        author_id: users[0].id,
        content: "Preserved historical message",
        embeds: [],
        reactions: [],
        timestamp: new Date(),
        type: 0,
        flags: 0,
    }).save();
    config.limits.e2ee.encryptPrivateByDefault = true;
    events.length = 0;
    const reopened = await create([users[1]]);
    assert.equal(reopened.id, dto.id);
    assert.ok(reopened.e2ee_enabled_at);
    assert.equal(events.filter((event) => event.event === "CHANNEL_E2EE_UPDATE").length, 2);
    const again = await create([users[1]]);
    assert.equal(again.e2ee_enabled_at, reopened.e2ee_enabled_at);
    assert.equal(events.filter((event) => event.event === "CHANNEL_E2EE_UPDATE").length, 2);
    assert.equal((await entities.Message.findOneByOrFail({ id: legacy.id })).content, "Preserved historical message");
});

test("concurrent upgrades publish one enabled event per member", options, async () => {
    const dto = await create([users[1], users[2]]);
    await entities.Channel.update({ id: dto.id }, { e2ee_enabled_at: null });
    events.length = 0;
    const copies = await Promise.all(Array.from({ length: 16 }, () => get(dto.id)));
    await Promise.all(copies.map((channel) => entities.Channel.ensureDefaultPrivateEncryption(channel, users[0].id)));
    assert.equal(events.filter((event) => event.event === "CHANNEL_E2EE_UPDATE").length, 3);
    assert.equal(new Set(copies.map((channel) => channel.e2ee_enabled_at.toISOString())).size, 1);
});

test("initial encryption state includes unstamped historical private channels", options, async () => {
    const dto = await create([users[1]]);
    await entities.Channel.update({ id: dto.id }, { e2ee_enabled_at: null });
    assert.ok((await util.e2eeChannelIdsFor(users[0].id)).includes(dto.id));
    config.limits.e2ee.encryptPrivateByDefault = false;
    try {
        assert.equal((await util.e2eeChannelIdsFor(users[0].id)).includes(dto.id), true);
    } finally {
        config.limits.e2ee.encryptPrivateByDefault = true;
    }
});

test("server rejects plaintext historical private sends and persists their upgrade", options, async () => {
    const dto = await create([users[1]]);
    await entities.Channel.update({ id: dto.id }, { e2ee_enabled_at: null });
    await assert.rejects(
        util.applyE2eeToMessage({ author_id: users[0].id, content: "Must not persist" }, await get(dto.id), entities.Message.create({ content: "Must not persist" })),
        isRequired,
    );
    assert.ok((await get(dto.id)).e2ee_enabled_at);
    assert.equal(await entities.Message.countBy({ channel_id: dto.id, content: "Must not persist" }), 0);
});

test("legacy opt-out and application or webhook flags cannot admit plaintext private messages", options, async () => {
    config.limits.e2ee.encryptPrivateByDefault = false;
    const dto = await create([users[2]]);
    assert.ok(dto.e2ee_enabled_at);
    for (const flags of [{}, { application_id: "application" }, { webhook_id: "webhook" }]) {
        for (const type of [0, 19]) {
            await assert.rejects(
                util.applyE2eeToMessage({ author_id: users[0].id, content: "Legacy", type, ...flags }, await get(dto.id), entities.Message.create({ content: "Legacy" })),
                isRequired,
            );
        }
    }
});

test("channel status upgrade blocks attempts to disable enforced private encryption", options, async () => {
    const dto = await create([users[1]]);
    await entities.Channel.update({ id: dto.id }, { e2ee_enabled_at: null });
    const router = require("../../dist/api/routes/channels/#channel_id/e2ee").default;
    const handler = (method) => router.stack.find((layer) => layer.route?.methods[method]).route.stack.at(-1).handle;
    let response;
    await handler("get")({ params: { channel_id: dto.id }, user_id: users[0].id }, { json: (value) => (response = value) });
    assert.equal(response.enabled, true);
    await assert.rejects(
        handler("put")({ params: { channel_id: dto.id }, user_id: users[0].id, body: { enabled: false } }, { json() {} }),
        (error) => error.code === util.E2eeErrors.CANNOT_DISABLE.code,
    );
});
