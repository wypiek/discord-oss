const { test, before, after, mock } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const enabled = process.env.ANNOUNCEMENT_DELIVERY_TEST === "1";
const options = { skip: !enabled };
let entities, db, accounts, worker, e2ee, sender, route, temp;
const userIds = [],
    announcementIds = [],
    channelIds = [];
const originalKeys = process.env.E2EE_SYSTEM_KEY_DIR,
    originalSpool = process.env.ANNOUNCEMENT_SPOOL_DIR;
const keypair = (curve) => crypto.generateKeyPairSync(curve);
const pub = (pair) => pair.publicKey.export({ format: "jwk" }).x;
const sign = (key, value) => crypto.sign(null, Buffer.from(value), key).toString("base64url");
async function user(system = false) {
    const settings = await entities.UserSettings.create({ locale: "en-US" }).save();
    const row = await entities.User.create({
        username: system ? "official" : "Disposable announcement recipient",
        discriminator: "0",
        bot: false,
        system,
        premium: false,
        premium_type: 0,
        verified: true,
        rights: "33554432",
        flags: system ? Number(require("../../dist/schemas").UserFlags.FLAGS.SYSTEM) : 0,
        data: { valid_tokens_since: new Date() },
        created_at: new Date(),
        settings,
    }).save();
    userIds.push(row.id);
    return row;
}
async function keys(user) {
    const identity = keypair("ed25519"),
        signing = keypair("ed25519"),
        agreement = keypair("x25519"),
        id = e2ee.e2eeDeviceId(pub(signing));
    await entities.E2eeIdentity.create({
        user_id: user.id,
        public_key: pub(identity),
        created_at: new Date(),
        previous_key: null,
        rotation_signature: null,
    }).save();
    await entities.E2eeDevice.create({
        id,
        user_id: user.id,
        status: "active",
        signing_key: pub(signing),
        identity_signature: sign(identity.privateKey, e2ee.e2eeDeviceMessage(user.id, id, pub(signing))),
        prekey_id: 1,
        prekey_public: pub(agreement),
        prekey_signature: sign(signing.privateKey, e2ee.e2eePrekeyMessage(id, 1, pub(agreement))),
        created_at: new Date(),
        prekey_updated_at: new Date(),
        revoked_at: null,
        session_id: null,
    }).save();
    return agreement;
}
async function create(body) {
    let status, result;
    await route(
        { user_id: sender.id, body, files: [] },
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
    if (result) announcementIds.push(result.id);
    return { status, body: result };
}
before(async () => {
    if (!enabled) return;
    assert.equal(new URL(process.env.DATABASE).pathname, "/fosscord_codex_admin");
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "fosscord-announcement-pg-"));
    process.env.E2EE_SYSTEM_KEY_DIR = path.join(temp, "keys");
    process.env.ANNOUNCEMENT_SPOOL_DIR = path.join(temp, "spool");
    process.env.DB_POOL_SIZE = "1";
    process.env.APPLY_DB_MIGRATIONS = "false";
    delete process.env.DB_SYNC;
    const config = new (require("../../dist/util/config").ConfigValue)();
    mock.method(require("../../dist/util/util/Config").Config, "get", () => config);
    entities = require("../../dist/database");
    db = await entities.initDatabase();
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
        await runner.startTransaction();
        await new (require("../../dist/database/migration/postgres/1791805000427-AnnouncementDelivery").AnnouncementDelivery1791805000427)().up(runner);
        await runner.commitTransaction();
    } catch (error) {
        await runner.rollbackTransaction();
        throw error;
    } finally {
        await runner.release();
    }
    mock.method(require("../../dist/util/util/ipc/Event"), "emitEvent", async () => {});
    sender = await user(true);
    accounts = require("../../dist/api/util/utility/systemAccounts");
    mock.method(accounts, "getSystemAccount", async () => sender);
    const send = accounts.sendEncryptedSystemDM;
    mock.method(accounts, "sendSystemDM", async (_kind, id, message) => send(sender, id, message));
    e2ee = require("../../dist/api/util/utility/e2ee");
    worker = require("../../dist/api/util/utility/announcementDelivery");
    mock.method(worker, "runAnnouncementDeliveries", async () => {});
    const router = require("../../dist/api/routes/admin/announcements").default;
    route = router.stack.find((layer) => layer.route?.methods.post).route.stack.at(-1).handle;
});
after(async () => {
    if (!enabled) return;
    const { In } = require("typeorm");
    if (db?.isInitialized) {
        for (const id of announcementIds) {
            const messages = await entities.AnnouncementMessage.find({ where: { announcement_id: id } });
            channelIds.push(...messages.map((m) => m.channel_id));
            await entities.Announcement.delete({ id });
        }
        const recipients = await entities.Recipient.find({ where: { user_id: In(userIds) } });
        channelIds.push(...recipients.map((r) => r.channel_id));
        if (channelIds.length) await entities.Channel.delete({ id: In([...new Set(channelIds)]) });
        if (userIds.length) await entities.User.delete({ id: In(userIds) });
        await db.destroy();
    } else if (entities?.DataSourceOptions?.isInitialized) await entities.DataSourceOptions.destroy();
    mock.restoreAll();
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
    if (originalKeys === undefined) delete process.env.E2EE_SYSTEM_KEY_DIR;
    else process.env.E2EE_SYSTEM_KEY_DIR = originalKeys;
    if (originalSpool === undefined) delete process.env.ANNOUNCEMENT_SPOOL_DIR;
    else process.env.ANNOUNCEMENT_SPOOL_DIR = originalSpool;
});
test("selected announcement queues only synthetic recipients and missing keys retry without plaintext", options, async () => {
    const recipient = await user();
    const result = await create({
        body: "Isolated encrypted announcement fixture",
        audience: "selected",
        recipient_ids: [recipient.id],
    });
    assert.equal(result.status, 201);
    assert.equal(result.body.recipient_count, 1);
    const where = { announcement_id: result.body.id, user_id: recipient.id };
    const original = await entities.AnnouncementDelivery.findOneByOrFail(where);
    await worker.deliverAnnouncement(original);
    const queued = await entities.AnnouncementDelivery.findOneByOrFail(where);
    assert.equal(queued.status, "queued");
    assert.equal(queued.last_error, "encryption_not_ready");
    assert.equal(await entities.Message.countBy({ id: queued.message_id }), 0);
    const agreement = await keys(recipient);
    await entities.AnnouncementDelivery.update(where, { next_retry_at: new Date(0) });
    await worker.deliverAnnouncement(await entities.AnnouncementDelivery.findOneByOrFail(where));
    const delivered = await entities.AnnouncementDelivery.findOneByOrFail(where);
    assert.equal(delivered.status, "delivered");
    assert.equal(delivered.message_id, queued.message_id);
    const message = await entities.Message.findOneByOrFail({ id: delivered.message_id });
    assert.equal(message.content, e2ee.E2EE_FALLBACK_CONTENT);
    assert.ok(message.encrypted);
    assert.equal(message.nonce, message.id);
    assert.equal(JSON.stringify(message.encrypted).includes("Isolated encrypted announcement fixture"), false);
    const { CipherSuite, DhkemX25519HkdfSha256, HkdfSha256, Aes256Gcm } = require("@hpke/core");
    const suite = new CipherSuite({
        kem: new DhkemX25519HkdfSha256(),
        kdf: new HkdfSha256(),
        aead: new Aes256Gcm(),
    });
    const jwk = agreement.privateKey.export({ format: "jwk" });
    const privateKey = await crypto.webcrypto.subtle.importKey("jwk", { ...jwk, key_ops: ["deriveBits"] }, { name: "X25519" }, false, ["deriveBits"]);
    const publicKey = await crypto.webcrypto.subtle.importKey("raw", Buffer.from(jwk.x, "base64url"), { name: "X25519" }, true, []);
    const envelope = message.encrypted,
        target = envelope.keys.find((k) => k.user_id === recipient.id);
    const aad = `fosscord-e2ee/v1/msg\n${message.channel_id}\n${sender.id}\n${envelope.sender_device}\nn:${message.nonce}`;
    const key = await suite.open(
        {
            recipientKey: { privateKey, publicKey },
            enc: Buffer.from(target.enc, "base64url"),
            info: Buffer.from("fosscord-e2ee/v1/wrap"),
        },
        Buffer.from(target.wrapped, "base64url"),
        Buffer.from(`${aad}\n${target.device_id}`),
    );
    const clear = await crypto.webcrypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: Buffer.from(envelope.iv, "base64url"),
            additionalData: Buffer.from(aad),
        },
        await crypto.webcrypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["decrypt"]),
        Buffer.from(envelope.ct, "base64url"),
    );
    assert.equal(JSON.parse(Buffer.from(clear).toString()).content, "Isolated encrypted announcement fixture");
    await worker.deliverAnnouncement(delivered);
    assert.equal(await entities.Message.countBy({ id: message.id }), 1);
    assert.equal(await entities.AnnouncementMessage.countBy({ announcement_id: result.body.id }), 1);
    assert.deepEqual((await worker.announcementCounts([result.body.id]))[result.body.id], {
        queued: 0,
        delivering: 0,
        delivered: 1,
        failed: 0,
    });
});
test("selected audience rejects duplicates, nonexistent users, invalid ids and recipient ids on broadcast", options, async () => {
    const recipient = await user();
    for (const body of [
        { audience: "selected", recipient_ids: [recipient.id, recipient.id] },
        { audience: "selected", recipient_ids: ["9223372036854775807"] },
        { audience: "selected", recipient_ids: ["99999999999999999999"] },
        { audience: "selected", recipient_ids: [] },
        { audience: "everyone", recipient_ids: [recipient.id] },
    ])
        await assert.rejects(create({ body: "Never deliver invalid audience", ...body }), (error) => error.code === 400);
});
test("stale delivering claim is resumed with its original message id and deleted announcement cancels it", options, async () => {
    const recipient = await user();
    await keys(recipient);
    const announcement = await entities.Announcement.create({
        body: "Resume fixture",
        audience: "selected",
        durable: true,
        recipient_count: 1,
        sent_by: sender.id,
    }).save();
    announcementIds.push(announcement.id);
    const id = require("../../dist/util").Snowflake.generate();
    const delivery = await entities.AnnouncementDelivery.create({
        announcement_id: announcement.id,
        user_id: recipient.id,
        status: "delivering",
        attempts: 1,
        next_retry_at: new Date(0),
        message_id: id,
        last_error: null,
    }).save();
    await worker.deliverAnnouncement(delivery);
    assert.equal(
        (
            await entities.AnnouncementDelivery.findOneByOrFail({
                announcement_id: announcement.id,
                user_id: recipient.id,
            })
        ).status,
        "delivered",
    );
    assert.equal(await entities.Message.countBy({ id }), 1);
    await entities.Announcement.delete({ id: announcement.id });
    assert.equal(await entities.AnnouncementDelivery.countBy({ announcement_id: announcement.id }), 0);
    await worker.deliverAnnouncement(delivery);
    assert.equal(await entities.Message.countBy({ id }), 1);
});

test("two workers race with pool size one without duplicate messages or held-connection deadlock", options, async () => {
    const recipient = await user();
    await keys(recipient);
    const announcement = await entities.Announcement.create({
        body: "Concurrent selected fixture",
        audience: "selected",
        durable: true,
        recipient_count: 1,
        sent_by: sender.id,
    }).save();
    announcementIds.push(announcement.id);
    const delivery = await entities.AnnouncementDelivery.create({
        announcement_id: announcement.id,
        user_id: recipient.id,
        status: "queued",
        attempts: 0,
        next_retry_at: new Date(0),
    }).save();
    await Promise.all([worker.deliverAnnouncement(delivery), worker.deliverAnnouncement(delivery)]);
    const state = await entities.AnnouncementDelivery.findOneByOrFail({
        announcement_id: announcement.id,
        user_id: recipient.id,
    });
    assert.equal(state.status, "delivered");
    assert.equal(state.attempts, 1);
    assert.equal(await entities.Message.countBy({ id: state.message_id }), 1);
    assert.equal(await entities.AnnouncementMessage.countBy({ announcement_id: announcement.id }), 1);
});
test("transient delivery tracking failure cleans up and returns to queued backoff", options, async () => {
    const recipient = await user();
    await keys(recipient);
    const announcement = await entities.Announcement.create({
        body: "Tracking failure fixture",
        audience: "selected",
        durable: true,
        recipient_count: 1,
        sent_by: sender.id,
    }).save();
    announcementIds.push(announcement.id);
    const delivery = await entities.AnnouncementDelivery.create({
        announcement_id: announcement.id,
        user_id: recipient.id,
        status: "queued",
        attempts: 0,
        next_retry_at: new Date(0),
    }).save();
    const transaction = db.transaction.bind(db);
    const intercepted = mock.method(db, "transaction", async (...args) => {
        const fn = args.at(-1);
        if (String(fn).includes("Announcement deleted")) throw Error("Disposable injected tracking failure");
        return transaction(...args);
    });
    try {
        await worker.deliverAnnouncement(delivery);
    } finally {
        intercepted.mock.restore();
    }
    const state = await entities.AnnouncementDelivery.findOneByOrFail({
        announcement_id: announcement.id,
        user_id: recipient.id,
    });
    assert.equal(state.status, "queued");
    assert.equal(state.last_error, "delivery_error");
    assert.ok(state.next_retry_at > new Date());
    assert.equal(await entities.Message.countBy({ id: state.message_id }), 0);
});
