const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const enabled = process.env.ADMIN_CUSTOMIZATION_POSTGRES_TEST === "1";
let e, db, fixture, settings, update;
const privateFields = [
    "id",
    "mfa_enabled",
    "webauthn_enabled",
    "totp_secret",
    "totp_last_ticket",
    "desktop",
    "mobile",
    "nsfw_allowed",
    "pride_badges",
    "avatar",
    "banner",
    "rights",
    "data",
    "profile_widgets",
];
const snapshot = () =>
    e.User.findOneOrFail({
        where: { id: fixture.id },
        select: Object.fromEntries(privateFields.map((field) => [field, true])),
    });
before(async () => {
    if (!enabled) return;
    assert.equal(new URL(process.env.DATABASE).pathname, "/fosscord_codex_admin");
    e = require("../../dist/database");
    db = await e.initDatabase();
    require("../../dist/util").emitEvent = async () => {};
    ({ updateUserPreferenceSettings: update } = require("../../dist/api/util/handlers/UserPreferenceSettings"));
    settings = await e.UserSettings.create({ locale: "en-US", theme: "dark" }).save();
    fixture = await e.User.create({
        username: "Disposable customization security fixture",
        discriminator: "0",
        bot: false,
        premium: false,
        premium_type: 0,
        verified: true,
        rights: "0",
        data: { hash: "disposable-fixture-hash", valid_tokens_since: new Date() },
        created_at: new Date(),
        settings,
        mfa_enabled: true,
        webauthn_enabled: true,
        totp_secret: "disposable-totp-fixture",
        totp_last_ticket: "disposable-ticket-fixture",
        desktop: true,
        mobile: true,
        nsfw_allowed: false,
        pride_badges: ["rainbow", "transgender"],
        avatar: "fixture-avatar",
        banner: "fixture-banner",
        profile_widgets: [{ id: "123456789012345678", data: { type: "empty" } }],
    }).save();
});
after(async () => {
    if (!enabled) return;
    if (fixture) {
        await e.UserSettingsProtos.delete({ user_id: fixture.id });
        await e.User.delete({ id: fixture.id });
    }
    if (settings) await e.UserSettings.delete({ index: settings.index });
    await db?.destroy();
});
test("real preference write preserves excluded MFA, privacy, pride and profile columns", { skip: !enabled }, async () => {
    const before = await snapshot();
    const result = await update(fixture.id, { theme: "light", locale: "fr", animate_emoji: false });
    const after = await snapshot();
    for (const field of privateFields) assert.deepEqual(after[field], before[field], `Preserve ${field}`);
    assert.equal(result.theme, "light");
    assert.equal(result.locale, "fr");
    assert.equal(result.animate_emoji, false);
    const legacy = await e.UserSettings.findOneOrFail({ where: { index: settings.index } });
    const proto = await e.UserSettingsProtos.getOrDefault(fixture.id);
    const combined = legacy.toLegacy(proto.userSettings);
    assert.equal(legacy.theme, "light");
    assert.equal(combined.theme, "light");
    assert.equal(combined.locale, "fr");
    assert.equal(combined.animate_emoji, false);
});
test("real missing-settings link changes only relation, preserving security/profile columns", { skip: !enabled }, async () => {
    await e.User.createQueryBuilder().relation(e.User, "settings").of(fixture.id).set(null);
    const before = await snapshot();
    await update(fixture.id, { theme: "midnight" });
    const linked = await e.User.findOneOrFail({
        where: { id: fixture.id },
        relations: { settings: true },
        select: { id: true, settings: { index: true, theme: true } },
    });
    const after = await snapshot();
    for (const field of privateFields) assert.deepEqual(after[field], before[field], `Preserve ${field}`);
    assert.ok(linked.settings.index);
    assert.equal(linked.settings.theme, "midnight");
    const replacement = linked.settings.index;
    await e.User.createQueryBuilder().relation(e.User, "settings").of(fixture.id).set(settings.index);
    await e.UserSettings.delete({ index: replacement });
});
test("a failed audit write rolls back the preference write", { skip: !enabled }, async () => {
    await update(fixture.id, { theme: "dark", locale: "en-US" });
    await assert.rejects(
        update(fixture.id, { theme: "light", locale: "de" }, async () => {
            throw new Error("audit failed");
        }),
        /audit failed/,
    );
    const legacy = await e.UserSettings.findOneOrFail({ where: { index: settings.index } });
    const proto = await e.UserSettingsProtos.getOrDefault(fixture.id);
    assert.equal(legacy.theme, "dark");
    assert.equal(legacy.toLegacy(proto.userSettings).locale, "en-US");
});
