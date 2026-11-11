const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const enabled = process.env.APPLICATION_WIDGET_PRIVACY_TEST === "1";
let db, e, owner, subject, bot, original, apps, listUserIdentities, parseIdentityData, put, patch, get;
const dataField = (value) => ({ value_type: "data", presentation_type: "text", value });
const config = () => ({
    config_id: "123456789012345678",
    assets: [],
    updated_at: new Date().toISOString(),
    surfaces: {
        widget_top: {
            layout: "widget_top_hero",
            components: {
                title: {
                    fields: { text: { ...dataField("score"), fallback: dataField("fallback_score") } },
                },
            },
        },
        widget_bottom: {
            layout: "widget_bottom_stats",
            components: { stat_1: { fields: { value: dataField("score") } } },
        },
        add_widget_preview: {
            layout: "add_widget_preview_hero",
            components: {
                hero_image: {
                    fields: {
                        image: { value_type: "data", presentation_type: "image", value: "preview_asset" },
                    },
                },
            },
        },
    },
});

before(async () => {
    if (!enabled) return;
    assert.equal(new URL(process.env.DATABASE).pathname, "/fosscord_codex_admin");
    e = require("../../dist/database");
    db = await e.initDatabase();
    ({ listUserIdentities, parseIdentityData } = require("../../dist/api/util/handlers/ApplicationWidgets"));
    [owner, subject] = await e.User.find({ where: { bot: false }, select: { id: true }, take: 2 });
    assert.ok(owner && subject);
    original = (
        await e.User.findOneOrFail({
            where: { id: subject.id },
            select: { id: true, profile_widgets: true },
        })
    ).profile_widgets;
    bot = await e.User.create({
        username: "Disposable widget privacy bot",
        discriminator: "0000",
        bot: true,
        premium: false,
        premium_type: 0,
        verified: true,
        rights: "33554432",
        data: { valid_tokens_since: new Date() },
        created_at: new Date(),
    }).save();
    apps = await Promise.all(
        ["selected", "hidden"].map((name) =>
            e.Application.create({
                name: `Disposable widget privacy ${name}`,
                owner_id: owner.id,
                bot: name === "selected" ? bot : undefined,
                verify_key: "0".repeat(64),
                widget_config: config(),
                widget_public: false,
            }).save(),
        ),
    );
    await e.User.update(
        { id: subject.id },
        {
            profile_widgets: [{ id: "123456789012345679", data: { type: "application", application_id: apps[0].id } }],
        },
    );
    for (const app of apps)
        await e.ApplicationIdentity.create({
            application_id: app.id,
            user_id: subject.id,
            username: "Preserved identity",
            data: {
                score: 12,
                fallback_score: 4,
                internal_note: "Safe private marker",
                preview_asset: "Local preview marker",
            },
        }).save();
    const router = require("../../dist/api/routes/applications/#application_id/users/#user_id/widget-data").default;
    const handler = (method) => router.stack.find((layer) => layer.route?.methods[method]).route.stack.at(-1).handle;
    put = handler("put");
    patch = handler("patch");
    get = handler("get");
});

after(async () => {
    if (!enabled) return;
    if (subject) await e.User.update({ id: subject.id }, { profile_widgets: original });
    for (const app of apps ?? []) await e.Application.delete({ id: app.id });
    if (bot) await e.User.delete({ id: bot.id });
    if (db) await db.destroy();
});

const invoke = async (handler, actor, app, body) => {
    let result;
    await handler(
        { user_id: actor, params: { application_id: app.id, user_id: subject.id }, body },
        {
            json(value) {
                result = value;
                return this;
            },
        },
    );
    return result;
};
const fields = (identity) => Object.fromEntries(identity.profile.data.dynamic.map((field) => [field.name, field.value]));

test("other viewers receive only selected identities and keys used by public widget fields", { skip: !enabled }, async () => {
    const identities = await listUserIdentities(subject.id, owner.id);
    assert.equal(identities.length, 1);
    assert.equal(identities[0].application_id, apps[0].id);
    assert.equal(identities[0].username, "Preserved identity");
    assert.deepEqual(fields(identities[0]), { score: 12, fallback_score: 4 });
    assert.equal(
        (
            await e.ApplicationIdentity.findOneByOrFail({
                application_id: apps[0].id,
                user_id: subject.id,
            })
        ).data.internal_note,
        "Safe private marker",
    );
});

test("self viewers retain hidden picker candidates and preview values without unrelated internal data", { skip: !enabled }, async () => {
    const identities = await listUserIdentities(subject.id, subject.id);
    assert.equal(identities.length, 2);
    for (const identity of identities)
        assert.deepEqual(fields(identity), {
            score: 12,
            fallback_score: 4,
            preview_asset: "Local preview marker",
        });
});

test("removing all widgets stops exposing identities on the next public read", { skip: !enabled }, async () => {
    await e.User.update({ id: subject.id }, { profile_widgets: [] });
    assert.deepEqual(await listUserIdentities(subject.id, owner.id), []);
    await e.User.update(
        { id: subject.id },
        {
            profile_widgets: [{ id: "123456789012345679", data: { type: "application", application_id: apps[0].id } }],
        },
    );
});

test("the exact application owner or linked bot can manage full identity data; unrelated users and bots cannot", { skip: !enabled }, async () => {
    assert.equal((await invoke(get, owner.id, apps[0])).data.internal_note, "Safe private marker");
    assert.equal((await invoke(get, bot.id, apps[0])).data.internal_note, "Safe private marker");
    await assert.rejects(invoke(get, subject.id, apps[0]), { code: 20012 });
    await assert.rejects(invoke(patch, bot.id, apps[1], { data: { score: 100 } }), { code: 20012 });
    assert.equal((await invoke(patch, bot.id, apps[0], { data: { score: 13 } })).data.score, 13);
});

test("PUT and PATCH reject primitive/array/null data before merging and preserve existing records", { skip: !enabled }, async () => {
    for (const handler of [put, patch]) for (const data of [[], ["text"], "text", 4, true, null]) await assert.rejects(invoke(handler, owner.id, apps[0], { data }));
    for (const body of [[], "text", 4, true, null]) await assert.rejects(invoke(put, owner.id, apps[0], body));
    assert.equal((await invoke(get, owner.id, apps[0])).data.score, 13);
    assert.equal((await invoke(patch, owner.id, apps[0], { data: { fallback_score: null } })).data.fallback_score, undefined);
    const replaced = await invoke(put, owner.id, apps[0], { username: null, data: { score: 8 } });
    assert.deepEqual(replaced.data, { score: 8 });
    assert.equal(replaced.username, null);
});

test("identity data has bounded keys and values including null deletion keys", { skip: !enabled }, () => {
    assert.throws(() => parseIdentityData(Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`key_${i}`, null]))));
    assert.throws(() => parseIdentityData({ bad_key: "x".repeat(257) }));
    assert.throws(() => parseIdentityData({ "invalid-key": null }));
    assert.throws(() => parseIdentityData({ value: Infinity }));
    assert.throws(() => parseIdentityData({ value: {} }));
    assert.deepEqual(parseIdentityData({ score: 0, optional: null }), { score: 0 });
});
