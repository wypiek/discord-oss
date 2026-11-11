const { test } = require("node:test");
const assert = require("node:assert/strict");
const { StubError, loadModule } = require("./helpers/route-harness.cjs");

const FLAGS = { OPERATOR: 1n, SUPPORT_USERS: 2n, VIEW_USERS: 4n, VIEW_AUDIT_LOG: 8n, SEND_MESSAGES: 16n };
const roles = new Map([
    ["support", 2n | 4n],
    ["auditor", 8n],
]);

function adminUsers({ protectedTarget = false } = {}) {
    return loadModule("src/api/routes/admin/users/index.ts", {
        "@spacebar/database/Sql": { sqlLike: () => "" },
        express: { Router: () => ({ get: () => undefined }) },
        typeorm: { Brackets: class {} },
        "lambert-server/HTTPError": { HTTPError: StubError },
        "@spacebar/api/middlewares": { route: () => () => undefined },
        "@spacebar/database": { User: {} },
        "@spacebar/schemas": { AdminUserTag: {}, UserFlags: { FLAGS: {} } },
        "@spacebar/api/util": { ipVariants: () => [], isProtectedStaffTarget: () => protectedTarget, parseIp: () => null },
        "@spacebar/util": {
            Rights: { FLAGS },
            STAFF_RIGHTS: ["OPERATOR", "SUPPORT_USERS", "VIEW_USERS", "VIEW_AUDIT_LOG"],
            effectiveRightsSync: (id, rights) => ({ bitfield: BigInt(rights ?? 0) | (roles.get(id) ?? 0n) }),
            loadStaffRoles: async () => ({}),
        },
        "@spacebar/api/util/utility/federatedAdmin": { originClause: () => "", parseOrigin: () => null },
    });
}

const request = (user_id, bitfield) => ({ user_id, rights: { bitfield } });

test("support staff can't reset sign-in for a lower role that holds rights they lack", async () => {
    const { assertCanTakeOver } = adminUsers();
    await assert.rejects(assertCanTakeOver(request("support", 2n | 4n | 16n), { id: "auditor", rights: 16n }), /staff rights you don't have/);
});

test("support staff can still reset sign-in for regular accounts and operators for anyone", async () => {
    const { assertCanTakeOver } = adminUsers();
    await assertCanTakeOver(request("support", 2n | 4n | 16n), { id: "member", rights: 16n });
    await assertCanTakeOver(request("operator", 1n | 16n), { id: "auditor", rights: 16n });
});

test("the hierarchy check still runs first", async () => {
    const { assertCanTakeOver } = adminUsers({ protectedTarget: true });
    await assert.rejects(assertCanTakeOver(request("support", 2n | 4n), { id: "member", rights: 16n }), /Only operators/);
});

test("password reset links and two factor removal use the takeover check", () => {
    const fs = require("node:fs");
    for (const file of ["src/api/routes/admin/users/#user_id/password-reset.ts", "src/api/routes/admin/users/#user_id/mfa.ts"])
        assert.match(fs.readFileSync(file, "utf8"), /await assertCanTakeOver\(req, user\)/, file);
});
