const { test } = require("node:test");
const assert = require("node:assert/strict");
const { StubError, loadModule, loadRoutes, response } = require("./helpers/route-harness.cjs");
const { loadStaffModules } = require("./helpers/staff-roles.cjs");

const ROLES = [
    { id: "10", name: "Admin", color: null, rights: "142426338215592076", position: 4, show_badge: true },
    { id: "11", name: "Moderator", color: null, rights: "15762598695796744", position: 3, show_badge: true },
    { id: "12", name: "Support", color: null, rights: "29836347531329536", position: 2, show_badge: true },
    { id: "13", name: "Read-only audit", color: null, rights: "81064793292668928", position: 1, show_badge: false },
    { id: "14", name: "Quiet moderator", color: null, rights: "15762598695796744", position: 1, show_badge: false },
];
const MEMBERS = [
    { user_id: "admin", role_id: "10" },
    { user_id: "mod", role_id: "11" },
    { user_id: "admin-mod", role_id: "10" },
    { user_id: "admin-mod", role_id: "11" },
    { user_id: "support-mod", role_id: "12" },
    { user_id: "support-mod", role_id: "11" },
    { user_id: "quiet", role_id: "14" },
];
const FLAG = 1n << 18n;
const ALUMNI_ICON = "fee1624003e2fee35cb398e125dc479b";
const STAFF_ICON = "5e74e9b61934fc1f67c65515d1f7e60d";

const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);

const catalog = loadModule("src/util/util/BadgeCatalog.ts", {});

const staff = async (members = MEMBERS) => {
    const modules = loadStaffModules({ roles: ROLES, members });
    await modules.util.loadStaffRoles(true);
    return modules;
};

const moderatorBadgeModule = (util, database) =>
    loadModule("src/api/util/utility/moderatorBadge.ts", {
        typeorm: { In: (values) => values },
        "@spacebar/database/Sql": { sqlArrayIncludes: (value, array) => `${value} = ANY(${array})` },
        "@spacebar/database": database,
        "@spacebar/schemas": { UserFlags: { FLAGS: { CERTIFIED_MODERATOR: FLAG } } },
        "@spacebar/util": { ...util, ...catalog, emitEvent: database.emitEvent, broadcastUserUpdate: database.broadcastUserUpdate },
    });

const userStore = (users, badges = [{ id: "300", icon: ALUMNI_ICON }]) => {
    const events = [];
    const writes = [];
    const byId = new Map(users.map((user) => [user.id, user]));
    return {
        events,
        writes,
        users: byId,
        Badge: { find: async ({ where }) => badges.filter((badge) => badge.icon === where.icon) },
        User: {
            find: async ({ where }) => where.id.filter((id) => byId.has(id)).map((id) => ({ ...byId.get(id) })),
            update: async ({ id }, patch) => {
                writes.push([id, patch]);
                Object.assign(byId.get(id), patch);
            },
            findOneOrFail: async ({ where }) => ({ toPrivateUser: () => ({ ...byId.get(where.id) }) }),
            query: async (sql, params = []) => {
                if (sql.includes("public_flags"))
                    return [...byId.values()].filter((user) => (BigInt(user.public_flags ?? 0) & FLAG) !== 0n || (BigInt(user.flags ?? 0) & FLAG) !== 0n).map(({ id }) => ({ id }));
                return [...byId.values()].filter((user) => (user.badge_ids ?? []).includes(params[0])).map(({ id }) => ({ id }));
            },
        },
        emitEvent: async (event) => events.push(event),
        broadcastUserUpdate: async (id) => events.push({ event: "BROADCAST", user_id: id }),
    };
};

test("a moderator role holds a moderation right and no administration right", async () => {
    const { util, FLAGS } = await staff();
    const byName = Object.fromEntries(ROLES.map((role) => [role.name, role]));
    assert.equal(util.isModeratorRole(byName.Moderator), true);
    assert.equal(util.isModeratorRole(byName.Admin), false);
    assert.equal(util.isModeratorRole(byName.Support), false);
    assert.equal(util.isModeratorRole(byName["Read-only audit"]), false);
    assert.equal(util.isModeratorRole({ rights: FLAGS.MANAGE_MESSAGES | FLAGS.VIEW_MODERATION }), true);
    assert.equal(util.isModeratorRole({ rights: FLAGS.MODERATE_USERS | FLAGS.BYPASS_RATE_LIMITS }), false);
    assert.equal(util.isModeratorRole({ rights: FLAGS.MODERATE_USERS | FLAGS.MANAGE_STAFF }), false);
    assert.equal(util.roleBadge({ ...byName.Moderator, show_badge: true }), "moderator_alumni");
    assert.equal(util.roleBadge({ ...byName.Moderator, show_badge: false }), null);
    assert.equal(util.roleBadge(byName.Admin), "staff");
    assert.equal(util.roleBadge(byName["Read-only audit"]), null);
});

test("moderators get the alumni badge role and no staff badge role, higher staff keep the staff badge", async () => {
    const { util } = await staff();
    assert.equal(util.staffBadgeRole("mod"), null);
    assert.equal(util.moderatorBadgeRole("mod").name, "Moderator");
    assert.equal(util.staffBadgeRole("admin").name, "Admin");
    assert.equal(util.moderatorBadgeRole("admin"), null);
    assert.equal(util.staffBadgeRole("admin-mod").name, "Admin");
    assert.equal(util.moderatorBadgeRole("admin-mod").name, "Moderator");
    assert.equal(util.staffBadgeRole("support-mod").name, "Support");
    assert.equal(util.moderatorBadgeRole("quiet"), null, "a role with its badge turned off gives nothing");
    assert.equal(util.staffBadgeRole("quiet"), null);
    assert.equal(util.isStaffAccount({ id: "mod", rights: 0n }), true, "moderators keep their staff rights and access");
});

const profileBadgesFor = (util, database) => {
    const moderatorBadge = moderatorBadgeModule(util, database);
    const badgeSettings = loadModule("src/api/util/utility/badgeSettings.ts", { "@spacebar/util": {}, "./staffBadge": { STAFF_BADGE_ID: "1" } });
    return loadModule("src/api/util/utility/profileBadges.ts", {
        typeorm: { In: (values) => values },
        "@spacebar/database": {
            Badge: { find: async ({ where }) => database.storedBadges.filter((badge) => where.id.includes(badge.id)) },
            User: { findOne: async () => ({ created_at: null, badge_overrides: null }) },
            UserActivityStats: { findOne: async () => null },
        },
        "@spacebar/util": {
            ...util,
            ...catalog,
            ACCOUNT_AGE_BADGE: 18,
            STREAMING_BADGE: 19,
            GAME_TIME_BADGE: 20,
            GAME_VARIETY_BADGE: 21,
            NITRO_TIER_ICONS: {},
            activityProgress: () => ({ 19: 0, 20: 0, 21: 0 }),
            instanceName: () => "Meowcord",
            Config: { get: () => ({ cdn: {}, api: {} }) },
            DiscordApiErrors: {},
        },
        "./badgeSettings": badgeSettings,
        "./profile": { isSubscriptionBadge: () => false },
        "./staffBadge": { STAFF_BADGE_ID: "1", ensureStaffBadge: async () => ({ id: "1", icon: STAFF_ICON }) },
        "./moderatorBadge": moderatorBadge,
    });
};

const owner = (id, badge_ids = []) => ({ id, badge_ids, account_preferences: {}, created_at: null, badge_overrides: null });

test("a moderator's profile shows Moderator Programs Alumni and no staff badge", async () => {
    const { util } = await staff();
    const profile = profileBadgesFor(util, { storedBadges: [{ id: "300", icon: ALUMNI_ICON, description: "Moderator Programs Alumni" }] });
    const badges = await profile.localProfileBadges(owner("mod"));
    same(
        badges.map((badge) => [badge.id, badge.description, badge.settings_id]),
        [["certified_moderator", "Moderator Programs Alumni", "3"]],
    );
    const directory = await profile.badgeDirectory(owner("mod"), false);
    assert.equal(directory.length, 1);
    assert.equal(directory[0].badge_id, 3);
    assert.equal(directory[0].name, "Moderator Programs Alumni");
    assert.equal(directory[0].description, "Unlocked by completing the Meowcord Moderator Program.");
    assert.equal(directory[0].info_label, "Officially certified");
    assert.equal(directory[0].rarity, 5);
    assert.ok(directory[0].simple_icon_url.endsWith("/content-assets/40378bb73aae6b093f7a751fb3d6d5d85886036635c276ffad940818aa7b58ce.svg"));
});

test("an admin who is also a moderator shows the admin staff badge and keeps the alumni badge", async () => {
    const { util } = await staff();
    const profile = profileBadgesFor(util, { storedBadges: [] });
    const badges = await profile.localProfileBadges(owner("admin-mod"));
    same(
        badges.map((badge) => [badge.id, badge.description]),
        [
            ["staff-role-10", "Meowcord Admin"],
            ["certified_moderator", "Moderator Programs Alumni"],
        ],
    );
    same(
        (await profile.localProfileBadges(owner("admin"))).map((badge) => badge.id),
        ["staff-role-10"],
    );
});

test("a granted alumni badge is not shown twice and stays after the role goes", async () => {
    const { util } = await staff();
    const stored = { storedBadges: [{ id: "300", icon: ALUMNI_ICON, description: "Moderator Programs Alumni" }] };
    const withRole = await profileBadgesFor(util, stored).localProfileBadges(owner("mod", ["300"]));
    same(
        withRole.map((badge) => badge.id),
        ["certified_moderator"],
    );
    const { util: without } = await staff([]);
    const afterRemoval = await profileBadgesFor(without, stored).localProfileBadges(owner("mod", ["300"]));
    same(
        afterRemoval.map((badge) => badge.id),
        ["certified_moderator"],
    );
    same(await profileBadgesFor(without, stored).localProfileBadges(owner("mod")), []);
});

test("the sync sets CERTIFIED_MODERATOR for moderators, clears it when the role goes and keeps it for granted badges", async () => {
    const { util } = await staff();
    const store = userStore([
        { id: "mod", badge_ids: [], public_flags: 0, flags: 4 },
        { id: "admin", badge_ids: [], public_flags: 0, flags: 0 },
        { id: "granted", badge_ids: ["300"], public_flags: 0, flags: 0 },
    ]);
    const { syncModeratorAlumni } = moderatorBadgeModule(util, store);
    same(await syncModeratorAlumni(["mod", "admin", "granted"]), ["mod", "granted"]);
    assert.equal(BigInt(store.users.get("mod").public_flags), FLAG);
    assert.equal(BigInt(store.users.get("mod").flags), FLAG | 4n);
    assert.equal(store.users.get("admin").public_flags, 0, "staff above moderators don't get the flag");
    assert.equal(BigInt(store.users.get("granted").public_flags), FLAG);
    same(
        store.events.filter((event) => event.event === "USER_UPDATE").map((event) => event.user_id),
        ["mod", "granted"],
    );
    assert.ok(store.events.some((event) => event.event === "BROADCAST" && event.user_id === "mod"));

    same(await syncModeratorAlumni(["mod", "admin", "granted"]), [], "a second run changes nothing");

    const { util: without } = await staff([]);
    const after = moderatorBadgeModule(without, store);
    same(await after.syncModeratorAlumni(["mod", "granted"], { notify: "all" }), ["mod"]);
    assert.equal(store.users.get("mod").public_flags, 0);
    assert.equal(store.users.get("mod").flags, 4);
    assert.equal(BigInt(store.users.get("granted").public_flags), FLAG, "a granted alumni badge keeps the flag");
    same(
        store.events
            .slice(-4)
            .filter((event) => event.event === "USER_UPDATE")
            .map((event) => event.user_id),
        ["mod", "granted"],
        "notify all refreshes everyone whose roles changed",
    );
});

test("the startup sync migrates existing moderators and stale flags once, without events", async () => {
    const { util } = await staff();
    const store = userStore([
        { id: "mod", badge_ids: [], public_flags: 0, flags: 0 },
        { id: "admin-mod", badge_ids: [], public_flags: 0, flags: 0 },
        { id: "quiet", badge_ids: [], public_flags: Number(FLAG), flags: Number(FLAG) },
        { id: "stale", badge_ids: [], public_flags: Number(FLAG), flags: 0 },
        { id: "granted", badge_ids: ["300"], public_flags: 0, flags: 0 },
        { id: "member", badge_ids: [], public_flags: 0, flags: 0 },
    ]);
    const { syncAllModeratorAlumni } = moderatorBadgeModule(util, store);
    same([...(await syncAllModeratorAlumni())].sort(), ["admin-mod", "granted", "mod", "quiet", "stale"]);
    const flagged = [...store.users.values()].filter((user) => (BigInt(user.public_flags) & FLAG) !== 0n).map((user) => user.id);
    same(flagged.sort(), ["admin-mod", "granted", "mod"]);
    assert.equal(store.events.length, 0);
    same(await syncAllModeratorAlumni(), []);
});

test("assigning and removing a staff role refreshes the user's alumni badge", async () => {
    const modules = await staff();
    const { util } = modules;
    const syncs = [];
    const targets = loadModule("src/api/util/utility/adminTargets.ts", {
        "@spacebar/util": util,
        "@spacebar/database": {},
        "lambert-server/HTTPError": { HTTPError: StubError },
    });
    const rules = loadModule("src/api/util/utility/staffRoleRules.ts", { "@spacebar/util": util, "lambert-server/HTTPError": { HTTPError: StubError } });
    const routes = loadRoutes("src/api/routes/admin/users/#user_id/staff-roles.ts", {
        "lambert-server/HTTPError": { HTTPError: StubError },
        "@spacebar/database": {
            User: { findOneOrFail: async ({ where }) => ({ id: where.id, rights: "0", bot: false }) },
            StaffRoleMember: { insert: async () => undefined, delete: async () => undefined },
        },
        "@spacebar/util": util,
        "@spacebar/schemas": { AuditLogEvents: { ADMIN_STAFF_ROLE_ASSIGN: 2006, ADMIN_STAFF_ROLE_REMOVE: 2007 } },
        "@spacebar/api/util": {
            ...targets,
            ...rules,
            recordStaffAction: async () => undefined,
            syncModeratorAlumni: async (ids, options) => syncs.push([[...ids], options.notify]),
        },
        "../../staff/roles/index": { refreshStaffRoles: async () => util.staffRoleSnapshot() },
    });
    const put = async (user_id, role_ids) => {
        const res = response();
        res.locals = {};
        await routes["PUT /"]({ params: { user_id }, user_id: "op", rights: await util.effectiveRights("op", 1n), body: { role_ids } }, res);
    };
    await put("member", ["11"]);
    await put("mod", []);
    same(syncs, [
        [["member"], "all"],
        [["mod"], "all"],
    ]);
});
