const { test } = require("node:test");
const assert = require("node:assert/strict");

const { entity, In, IsNull, load, Not } = require("./federation-fake-orm.cjs");
const ids = require("../../src/util/util/federation/Ids.ts");
const protocol = require("../../src/util/util/federation/Protocol.ts");
const decorations = require("../../src/util/util/federation/Decorations.ts");
const { JSONReplacer } = require("../../src/util/util/JSON.ts");
const { Snowflake } = require("../../src/util/util/Snowflake.ts");

const own = "home.example";
const rogue = "rogue.example";
const listed = "listed.example";
const unlisted = "unlisted.example";
const CATALOG = {
    "0:1144058522808614923": { asset: "a_0123456789abcdef0123456789abcdef" },
    "1:1139323098370424932": { type: 1 },
    "2:1349849614198505602": { asset: "nameplates/nameplates/twilight/" },
    "3:1300000000000000555": { type: 3 },
};

function harness(limits = {}) {
    const db = {
        FederatedObject: entity("FederatedObject", ["canonical"]),
        FederationInboxEvent: entity("FederationInboxEvent", ["sender", "event_id"]),
        FederationOutboxEvent: entity("FederationOutboxEvent"),
        Guild: entity("Guild"),
        User: entity("User"),
    };
    const config = { get: () => ({ federation: { limits } }) };
    const quota = load("src/api/util/utility/federationQuota.ts", {
        typeorm: { In, IsNull, Not },
        "@spacebar/database": db,
        "@spacebar/util": { Config: config, FederationRequestError: protocol.FederationRequestError },
    });
    const federationIds = load("src/api/util/utility/federationIds.ts", {
        typeorm: { In },
        "@spacebar/database": db,
        "@spacebar/schemas": { PublicUserProjection: ["id", "username", "discriminator", "global_name", "avatar"] },
        "@spacebar/util": {
            ...ids,
            ...protocol,
            ...decorations,
            JSONReplacer,
            Snowflake,
            CollectibleItemType: { AVATAR_DECORATION: 0 },
            Collectibles: { item: async (sku, type) => CATALOG[`${type}:${sku}`] },
        },
        "./federationMedia": { rewriteRemoteMedia: async (value) => value },
        "./federationNetwork": { ownInstance: () => own, trustFor: async (id) => (id === listed || id === rogue ? { source: "registry", public_key: "x" } : null) },
        "./federationQuota": quota,
    });
    return { db, quota, federationIds };
}

const instancesOf = (db) => [...new Set(db.FederatedObject.rows.map((row) => row.instance))].sort();

test("a sender can only mint ids for itself and instances this one trusts", async () => {
    const { db, federationIds } = harness();
    const out = await federationIds.fromWire({ channel_id: `@1@${rogue}`, guild_id: `@2@${listed}`, message_id: `@3@${unlisted}` }, rogue);
    assert.deepEqual(instancesOf(db), [listed, rogue]);
    assert.equal(out.message_id, null);
    assert.ok(ids.SNOWFLAKE.test(out.channel_id));
});

test("one request can't introduce more new ids than the cap", async () => {
    const { db, federationIds } = harness({ newObjectsPerRequest: 3 });
    const body = { recipient_ids: [1, 2, 3, 4, 5].map((n) => `@${n}@${rogue}`) };
    await assert.rejects(federationIds.fromWire(body, rogue), (error) => error.status === 507);
    assert.equal(db.FederatedObject.rows.length, 0);
    await federationIds.fromWire({ recipient_ids: body.recipient_ids.slice(0, 3) }, rogue);
    assert.equal(db.FederatedObject.rows.length, 3);
});

test("each instance stops at its object quota", async () => {
    const { db, quota, federationIds } = harness({ objectsPerInstance: 4 });
    await federationIds.fromWire({ recipient_ids: [1, 2, 3].map((n) => `@${n}@${rogue}`) }, rogue);
    await assert.rejects(federationIds.fromWire({ recipient_ids: [4, 5].map((n) => `@${n}@${rogue}`) }, rogue), (error) => error.code === "quota_exceeded");
    await federationIds.fromWire({ channel_id: `@6@${listed}` }, rogue);
    assert.equal(db.FederatedObject.rows.length, 4);
    await assert.rejects(quota.assertQuota("objects", rogue, 2));
    await quota.assertQuota("objects", rogue, 1);
});

test("guild and shadow quotas count rows per instance", async () => {
    const { db, quota } = harness({ guildsPerInstance: 1, shadowsPerInstance: 2 });
    db.Guild.rows.push({ id: "1", federated_instance: rogue });
    db.User.rows.push({ id: "2", federated_instance: rogue }, { id: "3", federated_instance: null });
    await assert.rejects(quota.assertQuota("guilds", rogue), (error) => error.status === 507);
    await quota.assertQuota("guilds", listed);
    await quota.assertQuota("shadows", rogue);
    quota.quotaAdded("shadows", rogue);
    await assert.rejects(quota.assertQuota("shadows", rogue));
});

test("remembered inbox event ids are trimmed per sender instead of growing", async () => {
    const { db, quota } = harness({ inboxEventsPerInstance: 20 });
    for (let i = 0; i < 20; i++) db.FederationInboxEvent.rows.push({ sender: rogue, event_id: `e${i}`, received_at: new Date(1000 + i) });
    db.FederationInboxEvent.rows.push({ sender: listed, event_id: "keep", received_at: new Date(0) });
    await quota.trimInboxEvents(rogue);
    const left = db.FederationInboxEvent.rows.filter((row) => row.sender === rogue).map((row) => row.event_id);
    assert.equal(left.length, 18);
    assert.ok(!left.includes("e0") && !left.includes("e1"));
    assert.ok(db.FederationInboxEvent.rows.some((row) => row.event_id === "keep"));
});

test("ids from the future or deeply nested bodies are refused or clamped", () => {
    const future = Snowflake.generateAt(Date.now() + 10 * 365 * 24 * 3600_000);
    assert.ok(Snowflake.timestampOf(future) <= Date.now());
    assert.ok(BigInt(Snowflake.generateAt(Number.MAX_SAFE_INTEGER)) < 2n ** 63n);
    let deep = {};
    for (let i = 0; i < 200; i++) deep = { inner: deep };
    assert.throws(
        () => ids.collectIncomingIds(deep),
        (error) => error.status === 400,
    );
    let fine = {};
    for (let i = 0; i < 20; i++) fine = { inner: fine };
    ids.collectIncomingIds(fine);
});

test("decoration SKUs a sender made get an id here, and shared shop SKUs stay as they are", async () => {
    const { db, federationIds } = harness();
    const asset = "a_0123456789abcdef0123456789abcdef";
    const out = await federationIds.fromWire(
        {
            author: { id: `@1@${rogue}`, username: "cat", avatar: null, avatar_decoration_data: { asset, sku_id: "1300000000000000777", expires_at: null } },
            member: { nick: null, avatar_decoration_data: { asset, sku_id: `@1300000000000000777@${rogue}`, expires_at: null } },
            referenced_message: {
                author: { id: `@3@${rogue}`, username: "fox", avatar: null, avatar_decoration_data: { asset, sku_id: "1144058522808614923", expires_at: null } },
            },
            mentions: [
                { id: `@2@${rogue}`, username: "dog", avatar: null, avatar_decoration_data: { asset, sku_id: `@1300000000000000778@${listed}`, expires_at: null } },
                { id: `@4@${rogue}`, username: "owl", avatar: null, avatar_decoration_data: { asset, sku_id: `@1300000000000000779@${unlisted}`, expires_at: null } },
            ],
        },
        rogue,
    );
    const mapped = db.FederatedObject.rows.find((row) => row.canonical === `@1300000000000000777@${rogue}`);
    const third = db.FederatedObject.rows.find((row) => row.canonical === `@1300000000000000778@${listed}`);
    assert.ok(mapped && third);
    assert.deepEqual(out.author.avatar_decoration_data, { asset, sku_id: mapped.local_id, expires_at: null });
    assert.deepEqual(out.member.avatar_decoration_data, { asset, sku_id: mapped.local_id, expires_at: null });
    assert.deepEqual(out.mentions[0].avatar_decoration_data, { asset, sku_id: third.local_id, expires_at: null });
    assert.equal(out.mentions[1].avatar_decoration_data, null);
    assert.deepEqual(out.referenced_message.author.avatar_decoration_data, { asset, sku_id: "1144058522808614923", expires_at: null });
    assert.equal(db.FederatedObject.rows.filter((row) => row.canonical.startsWith("@1144058522808614923@")).length, 0);
    assert.equal(db.FederatedObject.rows.filter((row) => row.canonical.startsWith("@1300000000000000779@")).length, 0);
});

test("a decoration the receiver made comes back as its own SKU, and one it doesn't have is dropped", async () => {
    const { db, federationIds } = harness();
    const asset = "a_0123456789abcdef0123456789abcdef";
    const out = await federationIds.fromWire(
        {
            member: { nick: null, avatar_decoration_data: { asset, sku_id: `@1144058522808614923@${own}`, expires_at: null } },
            other: { nick: null, avatar_decoration_data: { asset, sku_id: `@1300000000000000999@${own}`, expires_at: null } },
        },
        rogue,
    );
    assert.deepEqual(out.member.avatar_decoration_data, { asset, sku_id: "1144058522808614923", expires_at: null });
    assert.equal(out.other.avatar_decoration_data, null);
    assert.equal(db.FederatedObject.rows.length, 0);
});

test("outgoing decoration SKUs mapped from another instance carry that instance's canonical id", async () => {
    const { db, federationIds } = harness();
    const asset = "a_0123456789abcdef0123456789abcdef";
    db.FederatedObject.rows.push({ canonical: `@1300000000000000777@${listed}`, local_id: "1560000000000000001", instance: listed, created_at: new Date() });
    const out = await federationIds.toWire({
        member: {
            nick: null,
            avatar_decoration_data: { asset, sku_id: "1560000000000000001", expires_at: null },
            collectibles: { nameplate: { asset: "nameplates/custom/1560000000000000001/", sku_id: "1560000000000000001", label: "", palette: "violet", expires_at: null } },
        },
        own: { avatar_decoration_data: { asset, sku_id: "1144058522808614923", expires_at: null } },
    });
    assert.deepEqual(out.member.avatar_decoration_data, { asset, sku_id: `@1300000000000000777@${listed}`, expires_at: null });
    assert.deepEqual(out.member.collectibles.nameplate, {
        asset: "nameplates/custom/1300000000000000777/",
        sku_id: `@1300000000000000777@${listed}`,
        label: "",
        palette: "violet",
        expires_at: null,
    });
    assert.deepEqual(out.own.avatar_decoration_data, { asset, sku_id: "1144058522808614923", expires_at: null });
});

test("nameplate and profile effect SKUs a sender made get an id here, shared ones stay, unknown frames are dropped", async () => {
    const { db, federationIds } = harness();
    const nameplate = { asset: "nameplates/custom/1300000000000000777/", sku_id: "1300000000000000777", label: "cats", palette: "violet", expires_at: null };
    const twilight = { asset: "nameplates/nameplates/twilight/", sku_id: "1349849614198505602", label: "stars", palette: "cobalt", expires_at: null };
    const out = await federationIds.fromWire(
        {
            user: { id: `@1@${rogue}`, username: "cat", avatar: null, collectibles: { nameplate } },
            guild_member: { nick: null, collectibles: { nameplate: twilight } },
            user_profile: {
                profile_effect: { id: "1300000000000000888", expires_at: null },
                collectibles: [
                    { sku_id: "1300000000000000888", type: 1, expires_at: null },
                    { sku_id: "1300000000000000555", type: 3, expires_at: null },
                    { sku_id: "1300000000000000556", type: 3, expires_at: null },
                ],
            },
            guild_member_profile: { profile_effect: { id: "1139323098370424932", expires_at: null }, collectibles: [] },
        },
        rogue,
    );
    const plate = db.FederatedObject.rows.find((row) => row.canonical === `@1300000000000000777@${rogue}`);
    const effect = db.FederatedObject.rows.find((row) => row.canonical === `@1300000000000000888@${rogue}`);
    assert.ok(plate && effect);
    assert.deepEqual(out.user.collectibles, { nameplate: { ...nameplate, sku_id: plate.local_id, asset: `nameplates/custom/${plate.local_id}/` } });
    assert.deepEqual(out.guild_member.collectibles, { nameplate: twilight });
    assert.deepEqual(out.user_profile.profile_effect, { id: effect.local_id, expires_at: null });
    assert.deepEqual(out.user_profile.collectibles, [
        { sku_id: effect.local_id, type: 1, expires_at: null },
        { sku_id: "1300000000000000555", type: 3, expires_at: null },
    ]);
    assert.deepEqual(out.guild_member_profile.profile_effect, { id: "1139323098370424932", expires_at: null });
    for (const sku of ["1349849614198505602", "1300000000000000555", "1300000000000000556", "1139323098370424932"])
        assert.equal(db.FederatedObject.rows.filter((row) => row.canonical.startsWith(`@${sku}@`)).length, 0, sku);
});
