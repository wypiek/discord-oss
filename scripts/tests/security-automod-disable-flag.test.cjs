const { test } = require("node:test");
const assert = require("node:assert/strict");
const { StubError, loadModule, loadRoutes, response } = require("./helpers/route-harness.cjs");

const DISABLED = 1n << 47n;
const staffDisableColumns = () => ({ disabled: true, flags: () => `flags | ${DISABLED}` });
const anything = () =>
    new Proxy(
        {},
        {
            get: (_, key) => (key === "__esModule" ? false : function stub() {}),
        },
    );

const appliesDisabledFlag = (columns) => typeof columns.flags === "function" && columns.flags().includes(`| ${DISABLED}`);

test("automod spam disables set the staff disabled flag", async () => {
    const writes = [];
    const { applySpamAction } = loadModule("src/api/util/utility/spamGuard.ts", {
        typeorm: { In: (value) => value, Like: (value) => value, MoreThan: (value) => value },
        "@spacebar/database": { ...anything(), User: { update: async (where, columns) => writes.push([where, columns]) } },
        "@spacebar/util": { ...anything(), Config: { get: () => ({ automod: { spam: { timeoutMinutes: 10, suspendHours: 1 } } }) } },
        "@spacebar/util/config/types/AutomodConfiguration": {},
        "@spacebar/util/util/SpamDetector": { SpamDetector: class {}, escalateSpamAction: () => undefined, strongerSpamAction: () => undefined },
        "@spacebar/schemas": { UserFlags: { FLAGS: { DISABLED } } },
        "./instanceAutomod": { recordAutomodAction: async () => undefined, revokeUserSessions: async () => undefined },
        "./raidIncidents": { recordIncident: async () => undefined },
        "./scamGuard": anything(),
        "./automodReports": anything(),
        "./safety": anything(),
        "./automodPolicy": anything(),
        "./staffDisable": { staffDisableColumns },
        "@spacebar/util/util/AutomodPolicy": anything(),
    });
    await applySpamAction({ id: "spammer", federated_instance: null }, "disable", { guild_ids: [], reason: "spam" });
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1].disabled, true);
    assert.ok(appliesDisabledFlag(writes[0][1]));
});

test("disabling accounts from the name scan sets the staff disabled flag", async () => {
    const writes = [];
    const routes = loadRoutes("src/api/routes/admin/automod/names.ts", {
        typeorm: { In: (value) => value, IsNull: () => null, MoreThan: (value) => value },
        "lambert-server/HTTPError": { HTTPError: StubError },
        "@spacebar/database": {
            User: {
                find: async () => [{ id: "member", rights: "0" }],
                update: async (where, columns) => writes.push([where, columns]),
            },
        },
        "@spacebar/schemas": {},
        "@spacebar/api/util": { canActOn: () => true, revokeUserSessions: async () => undefined, staffDisableColumns },
        "@spacebar/util/util/IdentityModeration": { findIdentityNameBlock: () => null },
    });
    const res = response();
    await routes["POST /disable"]({ user_id: "mod", rights: { bitfield: 0n }, body: { user_ids: ["member"] } }, res);
    assert.equal(JSON.stringify(res.body), JSON.stringify({ disabled: ["member"] }));
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1].disabled, true);
    assert.ok(appliesDisabledFlag(writes[0][1]));
});
