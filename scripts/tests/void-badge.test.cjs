const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { StubError, loadModule, loadRoutes, response } = require("./helpers/route-harness.cjs");

const NOW = new Date("2026-11-13T12:00:00.000Z");
const LATER = new Date("2026-12-01T08:30:00.000Z");
const TIER_KEYS = ["eclipse", "stardust", "meteorite", "comet", "pulsar", "quasar", "aurora", "nebula", "nova", "supernova"];
const TIER_NAMES = ["Eclipse", "Stardust", "Meteorite", "Comet", "Pulsar", "Quasar", "Aurora", "Nebula", "Nova", "Supernova"];
const CDN = "https://cdn.example.test";

const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);

const voidBadge = loadModule("src/util/util/VoidBadge.ts", {});
const catalog = loadModule("src/util/util/BadgeCatalog.ts", {});

const fieldErrors = (fields) => new StubError(JSON.stringify(fields), 400);

const utilStub = {
    ...catalog,
    ...voidBadge,
    ACCOUNT_AGE_BADGE: 18,
    STREAMING_BADGE: 19,
    GAME_TIME_BADGE: 20,
    GAME_VARIETY_BADGE: 21,
    NITRO_TIER_ICONS: {},
    tierIconName: (id, key) => `${id}_${key}`,
    activityProgress: () => ({ 19: 0, 20: 0, 21: 0 }),
    instanceName: () => "Test Instance",
    Config: { get: () => ({ cdn: { endpointPublic: CDN }, api: {} }) },
    DiscordApiErrors: {},
    FieldErrors: fieldErrors,
    loadStaffRoles: async () => ({ roles: new Map(), members: new Map() }),
    moderatorBadgeRole: () => null,
    staffBadgeRole: () => null,
};

const profileBadges = (users) => {
    const badgeSettings = loadModule("src/api/util/utility/badgeSettings.ts", { "@spacebar/util": utilStub, "./staffBadge": { STAFF_BADGE_ID: "1" } });
    return loadModule("src/api/util/utility/profileBadges.ts", {
        typeorm: { In: (values) => values },
        "@spacebar/database": {
            Badge: { find: async () => [] },
            User: { findOne: async ({ where }) => users.get(where.id) ?? null },
            UserActivityStats: { findOne: async () => null },
        },
        "@spacebar/util": utilStub,
        "./badgeSettings": badgeSettings,
        "./profile": { isSubscriptionBadge: () => false },
        "./staffBadge": { STAFF_BADGE_ID: "1", ensureStaffBadge: async () => ({ id: "1", icon: "staff" }) },
        "./moderatorBadge": { isModeratorAlumniBadge: () => false, moderatorRoleBadgeRow: () => null },
    });
};

const owner = (id, the_void, account_preferences = {}) => ({ id, badge_ids: [], account_preferences, created_at: null, badge_overrides: the_void ? { the_void } : null });

test("The Void has ten levels from Eclipse to Supernova and accepts only those keys", () => {
    same(
        voidBadge.VOID_BADGE_TIERS.map((tier) => tier.key),
        TIER_KEYS,
    );
    same(
        voidBadge.VOID_BADGE_TIERS.map((tier) => tier.name),
        TIER_NAMES,
    );
    for (const key of TIER_KEYS) assert.equal(voidBadge.voidBadgeTier(key).key, key);
    for (const key of ["", "Nova", "NOVA", "void", "orbs", "supernova ", null, undefined, 9, "__proto__", "toString"])
        assert.equal(voidBadge.voidBadgeTier(key), undefined, String(key));
    assert.throws(
        () => voidBadge.grantVoidBadge(undefined, "hypernova", NOW),
        (error) => error.name === "RangeError" && /eclipse/.test(error.message),
    );
    assert.equal(voidBadge.grantVoidBadge({ tier: "nova", granted_at: NOW.toISOString(), tier_set_at: NOW.toISOString() }, null, LATER), undefined);
});

test("granting keeps the first grant date and records when the level changed", () => {
    const granted = voidBadge.grantVoidBadge(undefined, "nova", NOW);
    same(granted, { tier: "nova", granted_at: NOW.toISOString(), tier_set_at: NOW.toISOString() });
    const raised = voidBadge.grantVoidBadge(granted, "supernova", LATER);
    same(raised, { tier: "supernova", granted_at: NOW.toISOString(), tier_set_at: LATER.toISOString() });
    same(voidBadge.grantVoidBadge(raised, "supernova", new Date("2027-01-01T00:00:00.000Z")), raised);
    assert.equal(voidBadge.currentVoidGrant({ tier: "hypernova", granted_at: NOW.toISOString(), tier_set_at: NOW.toISOString() }), null);
    assert.equal(voidBadge.currentVoidGrant({ tier: "nova", granted_at: "not a date", tier_set_at: NOW.toISOString() }), null);
});

test("Void art paths only resolve for known levels", () => {
    assert.equal(voidBadge.voidBadgeArtFile("the_void_nova.png"), "badges/void/nova.png");
    assert.equal(voidBadge.voidBadgeArtFile("the_void_supernova.svg"), "badges/void/supernova.svg");
    for (const file of ["the_void_hypernova.png", "the_void_nova.gif", "the_void_../nova.png", "the_void_nova.png.svg", "nova.png"])
        assert.equal(voidBadge.voidBadgeArtFile(file), null, file);
    for (const key of TIER_KEYS) {
        for (const extension of ["svg", "png"]) assert.ok(fs.existsSync(path.join("assets/public", `badges/void/${key}.${extension}`)), `${key}.${extension}`);
        const svg = fs.readFileSync(path.join("assets/public", `badges/void/${key}.svg`), "utf8");
        assert.ok(svg.startsWith("<svg") && !/<script|href=|on\w+=/i.test(svg), key);
        assert.equal(
            fs
                .readFileSync(path.join("assets/public", `badges/void/${key}.png`))
                .subarray(1, 4)
                .toString(),
            "PNG",
            key,
        );
    }
});

test("the profile shows the current level's icon and name", async () => {
    const module = profileBadges(new Map());
    const grant = { tier: "nova", granted_at: NOW.toISOString(), tier_set_at: NOW.toISOString() };
    same(module.voidProfileBadge(grant), {
        id: "the_void",
        description: "The Void: Nova",
        icon: "the_void_nova",
        simple_icon_url: `${CDN}/badge-icons/the_void_nova.svg`,
        settings_id: "the_void",
    });
    assert.equal(module.voidProfileBadge(null), null);
    const badges = await module.localProfileBadges(owner("friend", grant));
    same(
        badges.map((badge) => [badge.id, badge.description, badge.icon]),
        [["the_void", "The Void: Nova", "the_void_nova"]],
    );
    const loaded = profileBadges(new Map([["friend", { created_at: null, badge_overrides: { the_void: grant } }]]));
    const fromDatabase = await loaded.localProfileBadges({ id: "friend", badge_ids: [], account_preferences: {} });
    assert.equal(fromDatabase.find((badge) => badge.id === "the_void")?.description, "The Void: Nova");
    same(await module.localProfileBadges(owner("nobody", null)), []);
});

test("the directory lists the ladder with the current level highlighted, higher levels locked and no Orb amounts", async () => {
    const module = profileBadges(new Map());
    const grant = { tier: "nova", granted_at: NOW.toISOString(), tier_set_at: LATER.toISOString() };
    for (const self of [true, false]) {
        const directory = await module.badgeDirectory(owner("friend", grant), self);
        assert.equal(directory.filter((badge) => badge.badge_id === "the_void").length, 1);
        const entry = directory.find((badge) => badge.badge_id === "the_void");
        assert.equal(entry.name, "The Void");
        assert.equal(entry.description, "Granted by Test Instance staff.");
        assert.equal(entry.leveling_instructions, "Only Test Instance staff can grant this badge or change its level.");
        assert.equal(entry.owned, true);
        assert.equal(entry.is_earnable, true);
        assert.equal(entry.current_tier, "nova");
        assert.equal(entry.next_tier, "supernova");
        assert.equal(entry.obtained_at, NOW.toISOString());
        assert.equal(entry.tier_obtained_at.nova, LATER.toISOString());
        assert.equal(entry.tier_obtained_at.eclipse, NOW.toISOString());
        assert.equal(entry.tier_obtained_at.supernova, undefined);
        assert.equal(entry.rarity, 5);
        assert.equal(entry.progress, null);
        assert.equal(entry.complex_icon_static_url, `${CDN}/badge-icons/the_void_nova.svg`);
        assert.equal(entry.simple_icon_raster_url, `${CDN}/badge-icons/the_void_nova.png`);
        same(
            entry.tiers.map((tier) => [tier.key, tier.name, tier.owned, tier.milestone_text]),
            TIER_KEYS.map((key, index) => [key, TIER_NAMES[index], index <= 8, index === 8 ? "Current level" : null]),
        );
        for (const tier of entry.tiers) {
            same(tier.requirements, []);
            assert.equal(tier.simple_icon_url, `${CDN}/badge-icons/the_void_${tier.key}.svg`);
        }
        assert.doesNotMatch(JSON.stringify(entry), /orb/i);
    }
    const top = (await module.badgeDirectory(owner("friend", { ...grant, tier: "supernova" }), true)).find((badge) => badge.badge_id === "the_void");
    assert.equal(top.next_tier, null);
    assert.equal(
        top.tiers.every((tier) => tier.owned),
        true,
    );
    const eclipse = (await module.badgeDirectory(owner("friend", { ...grant, tier: "eclipse" }), false)).find((badge) => badge.badge_id === "the_void");
    assert.equal(eclipse.rarity, 1);
    same(
        eclipse.tiers.filter((tier) => tier.owned).map((tier) => tier.key),
        ["eclipse"],
    );
    const hidden = owner("friend", grant, { badge_settings: { hidden_badges: ["the_void"] } });
    assert.equal(
        (await module.badgeDirectory(hidden, false)).some((badge) => badge.badge_id === "the_void"),
        false,
    );
    assert.equal((await module.badgeDirectory(hidden, true)).find((badge) => badge.badge_id === "the_void").hidden, true);
    const overridden = { ...owner("friend", grant), badge_overrides: { the_void: grant, rarity: { the_void: 2 } } };
    assert.equal((await module.badgeDirectory(overridden, false)).find((badge) => badge.badge_id === "the_void").rarity, 2);
    assert.equal(
        (await module.badgeDirectory(owner("nobody", null), true)).some((badge) => badge.badge_id === "the_void"),
        false,
    );
});

const adminRoute = (state) => {
    const options = [];
    const handlers = loadRoutes("src/api/routes/admin/users/#user_id/badge-overrides.ts", {
        "@spacebar/api/middlewares": {
            route: (value) => {
                options.push(value);
                return () => undefined;
            },
        },
        "@spacebar/api/util/handlers/AdminUserCustomization": {
            adminCustomizationTarget: async (req, editing) => {
                state.targets.push([req.params.user_id, editing]);
                if (state.refuse) throw new StubError("You can't edit staff at or above your own role", 403);
                return { id: req.params.user_id };
            },
            recordAdminCustomization: async (...args) => state.audits.push(args),
        },
        "@spacebar/api/util/utility/profileBadges": {
            BADGE_RARITIES: [1, 2, 3, 5],
            NITRO_BADGE_ID: 1,
            nitroProgress: () => ({ unlocked_at: {} }),
            tieredProgress: async () => new Map(),
            badgeDirectory: async () => [],
        },
        "@spacebar/database": {
            User: {
                findOneOrFail: async () => ({ id: "friend", badge_ids: [], account_preferences: {}, created_at: null, badge_overrides: state.overrides }),
            },
            UserActivityStats: { findOne: async () => null },
            getDatabase: () => ({
                transaction: async (work) =>
                    work({
                        update: async (_entity, _where, patch) => {
                            state.overrides = patch.badge_overrides;
                        },
                    }),
            }),
        },
        "@spacebar/util": { ...utilStub, broadcastUserUpdate: async (id) => state.broadcasts.push(id) },
        "@spacebar/schemas": {},
        "@spacebar/api/util/utility/moderatorBadge": { notifyUserUpdate: async (id) => state.userUpdates.push(id) },
    });
    return { handlers, options };
};

test("only staff with MANAGE_USERS change The Void, through the protected target check, with an audit entry and a live update", async () => {
    const state = { overrides: null, targets: [], audits: [], broadcasts: [], userUpdates: [] };
    const { handlers, options } = adminRoute(state);
    same(
        options.map((option) => [option.right, option.spacebarOnly, option.requestBody ?? null]),
        [
            ["VIEW_USERS", true, null],
            ["MANAGE_USERS", true, "AdminBadgeOverridesSchema"],
        ],
    );
    const schema = JSON.parse(fs.readFileSync("assets/schemas.json", "utf8")).AdminBadgeOverridesSchema;
    same(schema.properties.void_tier.type, ["null", "string"]);
    assert.equal(schema.properties.void_tier.maxLength, 32);
    const patch = (body) => {
        const res = response();
        return handlers["PATCH /"]({ params: { user_id: "friend" }, body, headers: {} }, res).then(() => res);
    };
    const granted = await patch({ void_tier: "nova" });
    assert.equal(granted.body.void_tier, "nova");
    assert.equal(state.overrides.the_void.tier, "nova");
    same(state.targets.at(-1), ["friend", "badges"]);
    same(state.audits.at(-1).slice(2, 4), ["badge_overrides", ["badge_overrides"]]);
    same(state.audits.at(-1)[5], [{ key: "the_void", new_value: "Nova" }]);
    same(state.broadcasts, ["friend"]);
    same(state.userUpdates, ["friend"]);
    same(
        granted.body.void_tiers.map((tier) => tier.key),
        TIER_KEYS,
    );
    const firstGrant = state.overrides.the_void.granted_at;
    const changed = await patch({ void_tier: "supernova" });
    assert.equal(changed.body.void_tier, "supernova");
    assert.equal(changed.body.void_granted_at, firstGrant);
    same(state.audits.at(-1)[5], [{ key: "the_void", old_value: "Nova", new_value: "Supernova" }]);
    await assert.rejects(patch({ void_tier: "hypernova" }), (error) => error.code === 400 && /void_tier/.test(error.message));
    assert.equal(state.overrides.the_void.tier, "supernova");
    const removed = await patch({ void_tier: null });
    assert.equal(removed.body.void_tier, null);
    assert.equal(state.overrides.the_void, undefined);
    same(state.audits.at(-1)[5], [{ key: "the_void", old_value: "Supernova" }]);
    const audits = state.audits.length;
    state.refuse = true;
    await assert.rejects(patch({ void_tier: "eclipse" }), (error) => error.code === 403);
    assert.equal(state.overrides.the_void, undefined);
    assert.equal(state.audits.length, audits);
});

test("the admin dashboard edits The Void from the badge levels card", () => {
    const admin = fs.readFileSync("assets/public/admin/admin.js", "utf8");
    assert.match(admin, /<select name="void_tier"/);
    assert.match(admin, /voidTier !== data\.void_tier \? \{ void_tier: voidTier \}/);
});
