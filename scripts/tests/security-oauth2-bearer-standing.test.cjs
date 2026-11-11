const { test } = require("node:test");
const assert = require("node:assert/strict");
const { StubError, loadModule } = require("./helpers/route-harness.cjs");

const SUSPENDED = 500;

function loadToken(user) {
    return loadModule("src/util/util/Token.ts", {
        jsonwebtoken: {},
        "lambert-server/HTTPError": { HTTPError: StubError },
        typeorm: { MoreThan: (value) => value },
        "@spacebar/schemas": { AccountStandingState: { SUSPENDED } },
        "@spacebar/database": {
            InstanceBan: { hasInstanceBans: async () => false, findInstanceBans: async () => [] },
            OAuth2Token: {
                findOne: async () => ({
                    id: "token",
                    application_id: "app",
                    scopes: ["identify"],
                    created_at: new Date(),
                    expires_at: new Date(Date.now() + 60_000),
                    user: { ...user, suspended_until: undefined, join_status: undefined },
                }),
            },
            Session: {},
            User: {
                findOne: async ({ where, select }) => {
                    assert.equal(where.id, user.id);
                    assert.ok(select.suspended_until && select.join_status, "the standing columns are select: false and have to be asked for");
                    return { id: user.id, suspended_until: user.suspended_until, join_status: user.join_status };
                },
            },
        },
        "@spacebar/extensions": { Random: {} },
        "./Config": { Config: { get: () => ({ security: {} }) } },
        "@spacebar/util": { OrmUtils: {} },
        "@spacebar/util/util/ProcessLifecycle": { ProcessLifecycle: { onShutdown: () => undefined } },
        "./StaffRoles": { isStaffAccount: () => false, loadStaffRoles: async () => ({}) },
        "./JwtKeypairManager": { JwtKeypairManager: {} },
    });
}

const account = (overrides) => ({ id: "user", disabled: false, deleted: false, account_standing: 100, suspended_until: null, join_status: null, ...overrides });

test("an OAuth2 bearer token works for an account in good standing", async () => {
    const { checkOAuth2Token } = loadToken(account({}));
    const data = await checkOAuth2Token("Bearer abcdefghijklmnopqrstuvwxyz");
    assert.equal(data.user.id, "user");
});

for (const [label, overrides] of [
    ["a temporary suspension", { suspended_until: new Date(Date.now() + 86_400_000) }],
    ["an approval that is pending", { join_status: "pending" }],
    ["an approval that was rejected", { join_status: "rejected" }],
    ["a suspended standing", { account_standing: SUSPENDED }],
    ["a disabled account", { disabled: true }],
]) {
    test(`an OAuth2 bearer token is refused for ${label}`, async () => {
        const { checkOAuth2Token } = loadToken(account(overrides));
        await assert.rejects(checkOAuth2Token("Bearer abcdefghijklmnopqrstuvwxyz"), (error) => error.code === 401);
    });
}

test("an expired temporary suspension doesn't block an OAuth2 bearer token", async () => {
    const { checkOAuth2Token } = loadToken(account({ suspended_until: new Date(Date.now() - 1000) }));
    assert.equal((await checkOAuth2Token("Bearer abcdefghijklmnopqrstuvwxyz")).user.id, "user");
});
