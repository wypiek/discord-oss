const { test } = require("node:test");
const assert = require("node:assert/strict");
const { StubError, loadRoutes, response } = require("./helpers/route-harness.cjs");

const staffRequest = (user_id, extra = {}) => ({
    user_id,
    rights: { has: (right) => right !== "OPERATOR", bitfield: 0n },
    ...extra,
});

function violationRoutes() {
    const touched = [];
    const routes = loadRoutes("src/api/routes/admin/users/#user_id/violations/#violation_id.ts", {
        "lambert-server/HTTPError": { HTTPError: StubError },
        "@spacebar/database": {
            UserViolation: {
                findOneOrFail: async ({ where }) => {
                    touched.push(["find", where.id]);
                    return { id: where.id, user_id: where.user_id, save: async () => touched.push(["save"]) };
                },
                delete: async ({ id }) => touched.push(["delete", id]),
            },
        },
        "@spacebar/schemas": { AppealStatusValue: { CLASSIFICATION_INVALIDATED: 2 } },
        "@spacebar/api/util": { assertCanActOnUser: async () => undefined, resolveAppeal: async () => true },
        "./index": { describeStanding: async () => ({}) },
    });
    return { routes, touched };
}

test("staff can't resolve, move or delete their own violations", async () => {
    const { routes, touched } = violationRoutes();
    const params = { user_id: "mod", violation_id: "v1" };
    await assert.rejects(routes["PATCH /"](staffRequest("mod", { params, body: { appeal_status: 2 } }), response()), /your own violations/);
    await assert.rejects(routes["PATCH /"](staffRequest("mod", { params, body: { expires_at: "2020-01-01T00:00:00Z" } }), response()), /your own violations/);
    await assert.rejects(routes["DELETE /"](staffRequest("mod", { params }), response()), /your own violations/);
    assert.deepEqual(touched, []);
});

test("staff still remove violations of other accounts", async () => {
    const { routes, touched } = violationRoutes();
    await routes["DELETE /"](staffRequest("mod", { params: { user_id: "member", violation_id: "v1" } }), response());
    assert.deepEqual(touched, [
        ["find", "v1"],
        ["delete", "v1"],
    ]);
});

function userRoutes(user = { id: "mod", rights: "0", username: "mod", discriminator: "0", data: {} }) {
    const writes = [];
    const tagged = [];
    const routes = loadRoutes("src/api/routes/admin/users/#user_id/index.ts", {
        "@spacebar/util/util/IdentityModeration": { assertIdentityNameAllowed: () => undefined },
        "lambert-server/HTTPError": { HTTPError: StubError },
        "@spacebar/database": {
            Badge: {},
            FederatedObject: {},
            Guild: {},
            InstanceBan: {},
            Member: {},
            Session: {},
            User: { findOneOrFail: async () => ({ ...user }), update: async (...args) => writes.push(args) },
        },
        "@spacebar/util": {
            broadcastUserUpdate: async () => undefined,
            Collectibles: {},
            CollectibleItemType: {},
            emitEvent: async () => undefined,
            emitRequiredAction: async () => undefined,
            handleFile: async () => undefined,
            Rights: class {
                has() {
                    return false;
                }
            },
        },
        "@spacebar/schemas": { AccountStandingState: { SUSPENDED: 500 }, PrivateUserProjection: [] },
        typeorm: { In: (value) => value, Not: (value) => value },
        "@spacebar/api/util": {
            currentStanding: async () => 100,
            endUserSessions: async () => undefined,
            hasAdminPanelAccess: () => true,
            listIps: async () => [],
            normalizeIp: (ip) => ip,
            notifyStandingDrop: async () => undefined,
            syncStaffBadge: async () => undefined,
            withStaffDisabled: (flags) => flags,
        },
        "@spacebar/api/util/utility/federatedAdmin": { assertShadowUserEditable: () => undefined, SHADOW_USER_LOCAL_FIELDS: [] },
        "../index": {
            ADMIN_USER_COLUMNS: ["id"],
            applyUserTag: (_, tag) => tagged.push(tag),
            assertCanManage: () => undefined,
            pickAdminUser: (value) => value,
            userTag: (target) => (target.public_flags === 4 ? "official" : "none"),
        },
    });
    return { patch: routes["PATCH /"], writes, tagged };
}

test("staff can't change their own account standing or approval", async () => {
    for (const body of [{ account_standing: 100 }, { join_status: "approved" }]) {
        const { patch, writes } = userRoutes();
        await assert.rejects(patch(staffRequest("mod", { params: { user_id: "mod" }, body }), response()), /your own standing or approval/);
        assert.deepEqual(writes, []);
    }
});

test("only operators give or remove the official and system tags", async () => {
    for (const [tag, public_flags] of [
        ["official", 0],
        ["system", 0],
        ["none", 4],
    ]) {
        const { patch, writes, tagged } = userRoutes({ id: "member", rights: "0", username: "member", discriminator: "0", data: {}, public_flags });
        await assert.rejects(patch(staffRequest("admin", { params: { user_id: "member" }, body: { tag } }), response()), /Only operators/);
        assert.deepEqual(tagged, []);
        assert.deepEqual(writes, []);
    }
    const { patch, tagged } = userRoutes({ id: "member", rights: "0", username: "member", discriminator: "0", data: {}, public_flags: 0 });
    await patch(staffRequest("admin", { params: { user_id: "member" }, body: { tag: "verified_bot" } }), response()).catch(() => undefined);
    assert.deepEqual(tagged, ["verified_bot"]);
});
