const { test } = require("node:test");
const assert = require("node:assert/strict");
const { StubError, loadModule, response } = require("./helpers/route-harness.cjs");

const refused = new StubError("You can't view staff at or above your own role", 403);

function recordingModule(reads) {
    return new Proxy(
        {},
        {
            get: (_, key) => {
                if (key === "__esModule") return false;
                if (key === "then") return undefined;
                return new Proxy(function stub() {}, {
                    get: (_, member) =>
                        member === "then"
                            ? undefined
                            : async () => {
                                  reads.push(`${String(key)}.${String(member)}`);
                                  return { id: "admin", rights: "0" };
                              },
                    apply: () => undefined,
                });
            },
        },
    );
}

function readRoutes(file) {
    const reads = [];
    const viewed = [];
    const routes = {};
    const router = new Proxy(
        {},
        {
            get:
                (_, method) =>
                (path, ...args) => {
                    routes[`${String(method).toUpperCase()} ${path}`] = args.filter((arg) => typeof arg === "function").at(-1);
                    return router;
                },
        },
    );
    const overrides = {
        express: { Router: () => router },
        "@spacebar/api/middlewares": { route: () => () => undefined },
        "lambert-server/HTTPError": { HTTPError: StubError },
        "@spacebar/api/util": new Proxy(
            {},
            {
                get: (_, key) =>
                    key === "assertCanViewUser"
                        ? async (_req, user_id) => {
                              viewed.push(user_id);
                              throw refused;
                          }
                        : async () => {
                              reads.push(String(key));
                              return {};
                          },
            },
        ),
    };
    const stubs = new Proxy(overrides, {
        has: () => true,
        get: (target, name) => target[name] ?? recordingModule(reads),
    });
    loadModule(file, stubs);
    return { routes, reads, viewed };
}

const supportRequest = { user_id: "support", params: { user_id: "admin" }, rights: { bitfield: 0n, has: () => true }, query: {}, method: "GET" };

for (const file of ["index.ts", "mfa.ts", "sessions/index.ts", "invites/index.ts", "staff-roles.ts", "violations/index.ts"]) {
    test(`GET ${`/admin/users/:id/${file.replace(/(\/)?index\.ts$|\.ts$/, "")}`.replace(/\/$/, "")} refuses staff at or above the reader's role before reading`, async () => {
        const { routes, reads, viewed } = readRoutes(`src/api/routes/admin/users/#user_id/${file}`);
        await assert.rejects(routes["GET /"](supportRequest, response()), /view staff at or above/);
        assert.deepEqual(viewed, ["admin"]);
        assert.ok(!reads.some((read) => /^(Session|BackupCode|SecurityKey|Member|Guild|InstanceBan|InstanceInvite)\./.test(read)), reads.join(", "));
    });
}

test("customization reads such as settings, widgets and pride badges are hierarchy gated", async () => {
    const { adminCustomizationTarget } = loadModule("src/api/util/handlers/AdminUserCustomization.ts", {
        "@spacebar/database": { AuditLog: {}, User: { findOneOrFail: async () => ({ id: "admin", rights: "8", bot: false, federated_instance: null }) } },
        "@spacebar/util": { loadStaffRoles: async () => ({}) },
        "../utility/adminTargets": { canActOn: () => false },
        "lambert-server/HTTPError": { HTTPError: StubError },
        "@spacebar/schemas": { AuditLogEvents: { ADMIN_USER_CUSTOMIZATION: 1 } },
        typeorm: {},
        "../utility/federatedAdmin": { assertShadowUserEditable: () => undefined },
    });
    await assert.rejects(adminCustomizationTarget(supportRequest), /view staff at or above/);
    await assert.rejects(adminCustomizationTarget({ ...supportRequest, method: "PATCH" }), /edit staff at or above/);
});

test("assertCanViewUser lets staff read accounts below them and themselves", async () => {
    const { assertCanViewUser } = loadModule("src/api/util/utility/adminTargets.ts", {
        "lambert-server/HTTPError": { HTTPError: StubError },
        "@spacebar/database": { User: { findOneOrFail: async ({ where }) => ({ id: where.id, rights: where.id === "admin" ? "high" : "low" }) } },
        "@spacebar/util": {
            actorLevel: (actor) => (actor.rights === 1n ? 50 : 0),
            loadStaffRoles: async () => ({}),
            OPERATOR_LEVEL: 1000,
            staffLevel: (target) => (target.rights === "high" ? 80 : 0),
            staffRoleSnapshot: () => ({}),
        },
    });
    const support = { user_id: "support", rights: { bitfield: 1n } };
    await assert.rejects(assertCanViewUser(support, "admin"), /view staff at or above/);
    assert.equal((await assertCanViewUser(support, "member")).id, "member");
    assert.equal((await assertCanViewUser({ user_id: "admin", rights: { bitfield: 0n } }, "admin")).id, "admin");
});
