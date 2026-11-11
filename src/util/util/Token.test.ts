import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, beforeEach, mock, test } from "node:test";
import jwt from "jsonwebtoken";
import { InstanceBan, Session, User } from "@spacebar/database";
import { Config } from "./Config";
import { checkToken, JwtKeypairManager } from "./Token";

let keys: { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject };
let user: User;
let session: Session | null;
let clock: number;
let updates: Record<string, unknown>[];

beforeEach(() => {
    keys = crypto.generateKeyPairSync("ec", { namedCurve: "secp521r1" });
    clock = Date.now();
    user = Object.assign(new User(), {
        id: "100000000000000001",
        rights: "1",
        data: { valid_tokens_since: new Date(0) },
        disabled: false,
        deleted: false,
    });
    session = Object.assign(new Session(), {
        session_id: "TESTDEVICE",
        user_id: user.id,
        last_seen: new Date(clock),
        last_seen_ip: "127.0.0.1",
    });
    updates = [];
    mock.getter(JwtKeypairManager, "keypair", () => ({ ...keys, fingerprint: "test" }));
    mock.method(Config, "get", () => ({ security: { jwtSecret: null } }));
    mock.method(User, "findOne", async () => user);
    mock.method(Session, "findOne", async () => session);
    mock.method(InstanceBan, "hasInstanceBans", async () => false);
    mock.method(console, "error", () => undefined);
    mock.method(Date, "now", () => clock);
    const builder = {
        update: () => builder,
        set: (fields: Record<string, unknown>) => {
            updates.push(fields);
            return builder;
        },
        where: () => builder,
        andWhere: () => builder,
        execute: async () => ({ affected: 1 }),
    };
    mock.method(Session, "createQueryBuilder", () => builder);
});

afterEach(() => mock.restoreAll());

function token(extra: Record<string, unknown> = {}, compact = false) {
    const payload = { id: user.id, did: "TESTDEVICE", iat: Math.floor(clock / 1000), ...extra };
    if (compact) {
        const secret = crypto
            .createHash("sha256")
            .update("compact-token")
            .update(keys.privateKey.export({ format: "pem", type: "sec1" }))
            .digest();
        return jwt.sign(payload, secret, {
            algorithm: "HS256",
            header: { alg: "HS256", kid: "c", typ: undefined },
        });
    }
    return jwt.sign(payload, keys.privateKey, { algorithm: "ES512" });
}

test("compact signature cache hits while rights and revocation are re-read", async () => {
    const value = token({}, true);
    const verify = mock.method(jwt, "verify");
    await checkToken(value);
    user.rights = "128";
    assert.equal((await checkToken(value)).user.rights, "128");
    assert.equal(verify.mock.callCount(), 1);
    session = null;
    await assert.rejects(checkToken(value));
    assert.equal(verify.mock.callCount(), 1);
});

test("cached signatures still reject tokens at expiry", async () => {
    const exp = Math.floor(clock / 1000) + 10;
    const value = token({ exp });
    await checkToken(value);
    clock = exp * 1000;
    await assert.rejects(checkToken(value));
});

test("cache rechecks not-before after a clock rollback", async () => {
    const nbf = Math.floor(clock / 1000);
    const value = token({ nbf });
    await checkToken(value);
    clock = (nbf - 1) * 1000;
    await assert.rejects(checkToken(value));
});

test("compact key rotation invalidates cached signatures", async () => {
    const value = token({}, true);
    await checkToken(value);
    keys = crypto.generateKeyPairSync("ec", { namedCurve: "secp521r1" });
    await assert.rejects(checkToken(value));
    await checkToken(token({}, true));
});

test("database errors reject authentication instead of leaving its promise pending", async () => {
    const error = new Error("Database unavailable");
    mock.method(User, "findOne", async () => {
        throw error;
    });
    await assert.rejects(checkToken(token()), error);
});

test("device activity uses a partial update and never requests external geolocation", async () => {
    session!.last_seen = new Date(0);
    mock.method(session!, "save", async () => assert.fail("auth must not save a stale session entity"));
    mock.method(session!, "updateIpInfo", async () => assert.fail("auth must not depend on a third-party request"));
    await checkToken(token(), { ipAddress: "192.0.2.1" });
    assert.equal(updates.length, 1);
    assert.deepEqual(Object.keys(updates[0]).sort(), ["last_seen", "last_seen_ip"]);
});

test("disabled accounts reject a previously cached signature immediately", async () => {
    const value = token();
    await checkToken(value);
    user.disabled = true;
    await assert.rejects(checkToken(value));
});
