const { test } = require("node:test");
const assert = require("node:assert/strict");
const { StubError, loadModule, loadRoutes, response } = require("./helpers/route-harness.cjs");

const json = (value) => JSON.parse(JSON.stringify(value));

test("restartOtherSessions ends every other session and keeps the current one with a fresh token", async () => {
    const updates = [];
    const deleted = [];
    const events = [];
    const generated = [];
    const sessions = [{ session_id: "current" }, { session_id: "phone" }, { session_id: "laptop" }];
    const before = Date.now();
    const { restartOtherSessions } = loadModule("src/api/util/utility/mfa.ts", {
        bcrypt: {},
        jsonwebtoken: {},
        "node-2fa": { verifyToken: () => null },
        typeorm: { In: (value) => value },
        "@spacebar/database": {
            BackupCode: {},
            RateLimit: {},
            SecurityKey: {},
            getDatabase: () => undefined,
            generateMfaBackupCodes: () => [],
            Session: {
                find: async ({ where }) => {
                    assert.equal(where.user_id, "user");
                    return sessions;
                },
                delete: async ({ session_id }) => deleted.push(session_id),
            },
            User: {
                findOneOrFail: async () => ({ id: "user", data: { hash: "hash", valid_tokens_since: new Date(0) } }),
                update: async (where, values) => updates.push([where, values]),
            },
        },
        "@spacebar/util": {
            EVENT: {},
            JwtKeypairManager: {},
            emitEvent: async (event) => events.push(event),
            generateToken: async (...args) => {
                generated.push(args);
                return "fresh-token";
            },
        },
        "@spacebar/schemas": { PrivateUserProjection: [], UserFlags: { FLAGS: {} } },
        "./e2ee": { revokeStaleE2eeDevices: async () => undefined },
        "./phoneVerification": { PhoneVerification: {} },
        "./mfaAttempt": { consumeMfaTicket: async () => undefined, reserveMfaAttempt: async () => undefined },
    });
    const session = { session_id: "current" };
    const token = await restartOtherSessions({ user_id: "user", session });
    assert.equal(token, "fresh-token");
    assert.deepEqual(json(deleted), ["phone", "laptop"]);
    assert.deepEqual(json(events.map((event) => [event.session_id, event.event])), [
        ["phone", "SB_SESSION_REMOVE"],
        ["laptop", "SB_SESSION_REMOVE"],
    ]);
    assert.equal(updates.length, 1);
    assert.equal(updates[0][1].data.hash, "hash");
    assert.ok(updates[0][1].data.valid_tokens_since.getTime() >= before);
    assert.equal(generated[0][0], "user");
    assert.equal(generated[0][3], session);
});

test("enabling TOTP ends the other sessions and returns the fresh token", async () => {
    const calls = [];
    const routes = loadRoutes("src/api/routes/users/@me/mfa/totp/enable.ts", {
        "@spacebar/api/util": {
            MfaInvalidCode: () => new StubError("Invalid two-factor code"),
            ResponseError: StubError,
            currentToken: () => "old-token",
            emitUserUpdate: async () => undefined,
            freshBackupCodes: async () => [],
            requireMfa: async () => undefined,
            restartOtherSessions: async (req) => {
                calls.push(req.session.session_id);
                return "fresh-token";
            },
            serializeBackupCodes: () => [],
            verifyTotp: () => true,
        },
        "@spacebar/database": {
            User: {
                findOneOrFail: async () => ({ id: "user", mfa_enabled: false, totp_secret: null }),
                update: async () => undefined,
            },
        },
    });
    const res = response();
    await routes["POST /"]({ user_id: "user", session: { session_id: "current" }, body: { password: "pw", secret: "JBSWY3DPEHPK3PXP", code: "123456" } }, res);
    assert.deepEqual(calls, ["current"]);
    assert.equal(res.body.token, "fresh-token");
});

test("registering the first security key ends the other sessions, later keys don't", async () => {
    for (const [mfa_enabled, expected] of [
        [false, ["current"]],
        [true, []],
    ]) {
        const revoked = [];
        const routes = loadRoutes("src/api/routes/users/@me/mfa/webauthn/credentials/index.ts", {
            "@spacebar/api/util": {
                MfaInvalidTicket: () => new StubError("Invalid ticket"),
                ResponseError: StubError,
                creationOptions: async () => ({}),
                emitUserEvent: async () => undefined,
                emitUserUpdate: async () => undefined,
                freshBackupCodes: async () => [],
                readTicket: () => ({ uid: "user", ch: "challenge", origin: "http://localhost" }),
                requestOrigin: () => "http://localhost",
                requireMfa: async () => undefined,
                revokeSessions: async (user_id, except) => revoked.push(except),
                serializeBackupCodes: () => [],
                signTicket: () => "ticket",
                verifyAttestation: () => ({ key_id: "a2V5", public_key: "key", counter: 0 }),
            },
            "@spacebar/database": {
                BackupCode: { find: async () => [{ code: "1" }] },
                SecurityKey: { create: (value) => ({ ...value, id: "key", save: async () => undefined }) },
                User: { findOneOrFail: async () => ({ id: "user", mfa_enabled }), update: async () => undefined },
            },
        });
        await routes["POST /"]({ user_id: "user", session: { session_id: "current" }, body: { name: "key", ticket: "ticket", credential: "credential" } }, response());
        assert.deepEqual(revoked, expected);
    }
});
