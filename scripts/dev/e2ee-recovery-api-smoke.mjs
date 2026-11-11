import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { solveCap } from "./cap-token.mjs";

const require = createRequire(import.meta.url);
const { buildSync } = require("esbuild");
const ts = require("typescript");
const { Client } = require("pg");
const { parseEnv } = require("node:util");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const origin = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3290}`;
assert.ok(["localhost", "fosscord.localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Recovery smoke only runs locally");
const cfg = parseEnv(String(readFileSync(process.env.DOTENV_CONFIG_PATH || path.join(root, ".env"))));
const database = process.env.DATABASE || cfg.DATABASE;
assert.equal(new URL(database).pathname, "/fosscord_codex_admin", "Recovery smoke uses the isolated demo database");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(database).hostname));
const db = new Client({ connectionString: database });
const bundled = buildSync({
    stdin: {
        contents:
            'export {generateExportable,importSigningJwk,sign,backupKeyMessage,deviceIdFor,deviceMessage,prekeyMessage} from "./client/e2ee/src/crypto"; export {sealJwk,wrapSecret} from "./client/e2ee/src/backup";',
        resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
});
const compiled = new Module(path.join(root, "scripts/dev/recovery-smoke-fixture.cjs"));
compiled.filename = compiled.id;
compiled.paths = require.resolve.paths("esbuild");
compiled._compile(bundled.outputFiles[0].text, compiled.filename);
const crypto = compiled.exports;
const helperModule = { exports: {} };
vm.runInNewContext(
    ts.transpileModule(readFileSync(path.join(root, "src/api/util/utility/e2eeRecovery.ts"), "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
    }).outputText,
    {
        module: helperModule,
        exports: helperModule.exports,
        Buffer,
        process,
        require: (name) => {
            if (name === "@spacebar/database")
                return {
                    E2eeRecovery: {
                        count: () => {
                            throw new Error("Smoke must not access a master key");
                        },
                    },
                };
            if (name === "lambert-server/HTTPError") return { HTTPError: class extends Error {} };
            return require(name);
        },
    },
);
const helper = helperModule.exports;
const suffix = randomBytes(6).toString("hex");
const email = `recovery-smoke-${suffix}@fosscord.test`;
const password = `Aa2!${randomBytes(18).toString("hex")}`;
const secret = randomBytes(32);
const call = async (method, route, token, body) => {
    const res = await fetch(`${origin}/api/v9${route}`, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
        status: res.status,
        body: await res.json().catch(() => null),
        noStore: res.headers.get("cache-control") === "no-store",
    };
};
const expect = (res, status, label) => {
    assert.equal(res.status, status, `${label}: status ${res.status}`);
    return res.body;
};
const results = {};
let userId;
let cleaned = false;
try {
    await db.connect();
    const captcha_key = await solveCap({ origin });
    const account = expect(
        await call("POST", "/auth/register", null, {
            email,
            username: `recovery${suffix}`,
            password,
            date_of_birth: "2000-01-01",
            consent: true,
            captcha_key,
        }),
        200,
        "fresh account signup",
    );
    const token = account.token;
    const self = expect(await call("GET", "/users/@me", token), 200, "fresh account self");
    userId = self.id;
    const sessions = expect(await call("GET", "/auth/sessions?extended=true", token), 200, "fresh account session");
    assert.equal(sessions.user_sessions.length, 1);
    const sessionId = sessions.user_sessions[0].id;
    assert.ok(typeof sessionId === "string" && sessionId.length > 0);
    const identity = await crypto.generateExportable("Ed25519");
    const backupKey = await crypto.generateExportable("X25519");
    const signingKey = await crypto.generateExportable("Ed25519");
    const prekey = await crypto.generateExportable("X25519");
    const identityPrivate = await crypto.importSigningJwk(identity);
    const devicePrivate = await crypto.importSigningJwk(signingKey);
    const deviceId = await crypto.deviceIdFor(signingKey.x);
    expect(await call("PUT", "/users/@me/e2ee/identity", token, { public_key: identity.x }), 200, "identity upload");
    const device = expect(
        await call("POST", "/users/@me/e2ee/devices", token, {
            device_id: deviceId,
            signing_key: signingKey.x,
            identity_signature: await crypto.sign(identityPrivate, crypto.deviceMessage(userId, deviceId, signingKey.x)),
            name: "Disposable recovery smoke",
            prekey: {
                id: 1,
                public_key: prekey.x,
                signature: await crypto.sign(devicePrivate, crypto.prekeyMessage(deviceId, 1, prekey.x)),
            },
        }),
        200,
        "device registration",
    );
    assert.equal(device.status, "active");
    const deviceSession = await db.query("SELECT session_id FROM e2ee_devices WHERE id = $1 AND user_id = $2", [deviceId, userId]);
    assert.equal(deviceSession.rows[0].session_id === sessionId, true, "Device is bound to the actual HTTP session");
    const backupBody = {
        version: 0,
        ...(await crypto.wrapSecret(userId, "password", password, new Uint8Array(secret))),
        identity_key: identity.x,
        wrapped_identity: await crypto.sealJwk(new Uint8Array(secret), "identity", userId, identity),
        backup_public_key: backupKey.x,
        backup_key_signature: await crypto.sign(identityPrivate, crypto.backupKeyMessage(userId, backupKey.x)),
        wrapped_backup_key: await crypto.sealJwk(new Uint8Array(secret), "backup-key", userId, backupKey),
    };
    const backup = expect(await call("PUT", "/users/@me/e2ee/backup", token, backupBody), 200, "backup upload");
    const encodedSecret = secret.toString("base64url");
    assert.equal(helper.validateBackupSecret(userId, backup, encodedSecret), true);
    const escrowPath = "/users/@me/e2ee/backup/escrow";
    expect(await call("POST", `${escrowPath}/recover`, token, { password }), 404, "recovery before escrow");
    const upload = {
        identity_key: identity.x,
        backup_version: backup.version,
        device_id: deviceId,
        backup_secret: encodedSecret,
        signature: await crypto.sign(identityPrivate, helper.recoveryProof(userId, identity.x, backup.version, deviceId, encodedSecret)),
    };
    results.badSignature = (
        await call("PUT", escrowPath, token, {
            ...upload,
            signature: randomBytes(64).toString("base64url"),
        })
    ).status;
    assert.equal(results.badSignature, 400);
    results.staleVersion = (await call("PUT", escrowPath, token, { ...upload, backup_version: backup.version + 1 })).status;
    assert.equal(results.staleVersion, 409);
    const secondLogin = expect(await call("POST", "/auth/login", null, { login: email, password }), 200, "second own session");
    results.wrongSession = (await call("PUT", escrowPath, secondLogin.token, upload)).status;
    assert.equal(results.wrongSession, 403);
    const uploaded = await call("PUT", escrowPath, token, upload);
    expect(uploaded, 204, "valid recovery upload");
    assert.equal(uploaded.noStore, true);
    results.upload = uploaded.status;
    results.wrongPassword = (await call("POST", `${escrowPath}/recover`, token, { password: `wrong-${suffix}` })).status;
    assert.equal(results.wrongPassword, 400);
    results.wrongAuth = (await call("POST", `${escrowPath}/recover`, null, { password })).status;
    assert.equal(results.wrongAuth, 401);
    const recovered = await call("POST", `${escrowPath}/recover`, token, { password });
    expect(recovered, 200, "valid recovery");
    assert.equal(recovered.noStore, true);
    results.recover = recovered.status;
    results.matchingSecret = recovered.body.backup_secret === encodedSecret;
    assert.equal(results.matchingSecret, true);
    const escrow = await db.query("SELECT encrypted_secret FROM e2ee_recovery WHERE user_id = $1", [userId]);
    assert.equal(escrow.rows.length, 1);
    results.encryptedAtRest = escrow.rows[0].encrypted_secret.startsWith("v1.") && !escrow.rows[0].encrypted_secret.includes(encodedSecret);
    assert.equal(results.encryptedAtRest, true);
} finally {
    secret.fill(0);
    if (!userId) {
        const fallback = await db.query("SELECT id FROM users WHERE email = $1", [email]);
        if (fallback.rows.length === 1) userId = fallback.rows[0].id;
    }
    if (userId) {
        await db.query("BEGIN");
        try {
            const row = await db.query('SELECT "settingsIndex" FROM users WHERE id = $1 AND email = $2', [userId, email]);
            assert.equal(row.rows.length, 1, "Delete only the exact new disposable account");
            await db.query("DELETE FROM user_settings_protos WHERE user_id = $1", [userId]);
            const deleted = await db.query("DELETE FROM users WHERE id = $1 AND email = $2", [userId, email]);
            assert.equal(deleted.rowCount, 1);
            if (row.rows[0].settingsIndex != null) await db.query('DELETE FROM user_settings WHERE "index" = $1', [row.rows[0].settingsIndex]);
            const leftovers = await db.query("SELECT (SELECT count(*) FROM users WHERE id = $1) + (SELECT count(*) FROM e2ee_recovery WHERE user_id = $1) AS remaining", [userId]);
            assert.equal(Number(leftovers.rows[0].remaining), 0);
            await db.query("COMMIT");
            cleaned = true;
        } catch (error) {
            await db.query("ROLLBACK");
            throw error;
        }
    }
    await db.end();
}
assert.equal(cleaned, true);
console.log(JSON.stringify({ status: "pass", ...results, disposableAccountRemoved: cleaned }));
