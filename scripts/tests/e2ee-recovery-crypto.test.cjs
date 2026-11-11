const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const crypto = require("node:crypto");
const ts = require("typescript");
const { buildSync } = require("esbuild");
const root = path.resolve(__dirname, "../..");
const source = ts.transpileModule(fs.readFileSync(path.join(root, "src/api/util/utility/e2eeRecovery.ts"), "utf8"), {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
    },
}).outputText;
const load = (env = {}, count = async () => 0) => {
    const module = { exports: {} };
    class HTTPError extends Error {
        constructor(message, status) {
            super(message);
            this.status = status;
        }
    }
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        Buffer,
        process: { env, pid: process.pid },
        require: (name) => {
            if (name === "@spacebar/database") return { E2eeRecovery: { count } };
            if (name === "lambert-server/HTTPError") return { HTTPError };
            return require(name);
        },
    });
    return module.exports;
};
const bundle = buildSync({
    stdin: {
        contents: 'export {generateExportable,importSigningJwk,backupKeyMessage,sign} from "./client/e2ee/src/crypto"; export {sealJwk} from "./client/e2ee/src/backup";',
        resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
});
const compiled = new Module(path.join(root, "scripts/tests/recovery-client-fixture.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const client = compiled.exports;
const userId = "123456789";
const unavailable = (error) => error.status === 503 && error.message === "Account recovery is temporarily unavailable";
const fixtures = async () => {
    const secret = crypto.randomBytes(32).toString("base64url");
    const identity = await client.generateExportable("Ed25519");
    const backupKey = await client.generateExportable("X25519");
    const signing = await client.importSigningJwk(identity);
    const backup = {
        identity_key: identity.x,
        backup_public_key: backupKey.x,
        backup_key_signature: await client.sign(signing, client.backupKeyMessage(userId, backupKey.x)),
        wrapped_identity: await client.sealJwk(new Uint8Array(Buffer.from(secret, "base64url")), "identity", userId, identity),
        wrapped_backup_key: await client.sealJwk(new Uint8Array(Buffer.from(secret, "base64url")), "backup-key", userId, backupKey),
    };
    return { secret, identity, backupKey, backup, signing };
};

const fixture = fixtures();

test("actual client HKDF sealed keys validate and recovery proof signs decoded-secret hash", async () => {
    const { secret, backup, signing } = await fixture;
    const helper = load();
    assert.equal(helper.validateBackupSecret(userId, backup, secret), true);
    const deviceId = crypto.randomBytes(16).toString("base64url");
    const proof = helper.recoveryProof(userId, backup.identity_key, 4, deviceId, secret);
    assert.equal(
        proof,
        [
            "fosscord-e2ee/v1/server-recovery",
            userId,
            backup.identity_key,
            "4",
            deviceId,
            crypto.createHash("sha256").update(Buffer.from(secret, "base64url")).digest("base64url"),
        ].join("\n"),
    );
    const signature = await client.sign(signing, proof);
    assert.equal(
        crypto.verify(
            null,
            Buffer.from(proof),
            crypto.createPublicKey({
                key: { kty: "OKP", crv: "Ed25519", x: backup.identity_key },
                format: "jwk",
            }),
            Buffer.from(signature, "base64url"),
        ),
        true,
    );
    assert.notEqual(helper.recoveryProof(userId, backup.identity_key, 5, deviceId, secret), proof);
    assert.notEqual(helper.recoveryProof(userId, backup.identity_key, 4, crypto.randomBytes(16).toString("base64url"), secret), proof);
});

test("secret validation rejects wrong user, secrets, signatures, malformed and noncanonical data", async () => {
    const { secret, backup } = await fixture;
    const helper = load();
    assert.equal(helper.validateBackupSecret("987654321", backup, secret), false);
    assert.equal(helper.validateBackupSecret(userId, backup, crypto.randomBytes(32).toString("base64url")), false);
    for (const bad of [secret + "=", "!", crypto.randomBytes(31).toString("base64url")]) assert.equal(helper.validateBackupSecret(userId, backup, bad), false);
    for (const field of ["wrapped_identity", "wrapped_backup_key", "backup_key_signature", "identity_key", "backup_public_key"]) {
        assert.equal(helper.validateBackupSecret(userId, { ...backup, [field]: "invalid" }), false);
    }
    const signature = Buffer.from(backup.backup_key_signature, "base64url");
    signature[0] ^= 1;
    assert.equal(helper.validateBackupSecret(userId, { ...backup, backup_key_signature: signature.toString("base64url") }, secret), false);
});

test("private seed derivation rejects a JWK that lies about either public key", async () => {
    const { secret, identity, backupKey, backup } = await fixture;
    const helper = load();
    const otherIdentity = await client.generateExportable("Ed25519");
    const otherBackup = await client.generateExportable("X25519");
    const bytes = new Uint8Array(Buffer.from(secret, "base64url"));
    const badIdentity = await client.sealJwk(bytes, "identity", userId, {
        ...identity,
        d: otherIdentity.d,
    });
    const badBackup = await client.sealJwk(bytes, "backup-key", userId, {
        ...backupKey,
        d: otherBackup.d,
    });
    assert.equal(helper.validateBackupSecret(userId, { ...backup, wrapped_identity: badIdentity }, secret), false);
    assert.equal(helper.validateBackupSecret(userId, { ...backup, wrapped_backup_key: badBackup }, secret), false);
    const wrongCurve = await client.sealJwk(bytes, "backup-key", userId, identity);
    assert.equal(helper.validateBackupSecret(userId, { ...backup, wrapped_backup_key: wrongCurve }, secret), false);
});

test("escrow AES-GCM roundtrip binds user, identity and backup key and rejects tampering", async () => {
    const { secret, backup } = await fixture;
    const env = { E2EE_RECOVERY_MASTER_KEY: crypto.randomBytes(32).toString("base64url") };
    const helper = load(env);
    const sealed = await helper.sealRecoverySecret(userId, backup.identity_key, backup.backup_public_key, secret);
    assert.equal(await helper.openRecoverySecret(userId, backup.identity_key, backup.backup_public_key, sealed), secret);
    const changed = Buffer.from(sealed.slice(3), "base64url");
    changed[15] ^= 1;
    for (const [id, identityKey, backupKey, box] of [
        ["999", backup.identity_key, backup.backup_public_key, sealed],
        [userId, crypto.randomBytes(32).toString("base64url"), backup.backup_public_key, sealed],
        [userId, backup.identity_key, crypto.randomBytes(32).toString("base64url"), sealed],
        [userId, backup.identity_key, backup.backup_public_key, "v1." + changed.toString("base64url")],
        [userId, backup.identity_key, backup.backup_public_key, sealed.replace("v1.", "v2.")],
    ])
        await assert.rejects(helper.openRecoverySecret(id, identityKey, backupKey, box), unavailable);
    const rotated = load({ E2EE_RECOVERY_MASTER_KEY: crypto.randomBytes(32).toString("base64url") });
    await assert.rejects(rotated.openRecoverySecret(userId, backup.identity_key, backup.backup_public_key, sealed), unavailable);
});

test("concurrent generation publishes one persistent mode0600 master and blank env falls back", async () => {
    const { secret, backup } = await fixture;
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "fosscord-recovery-test-"));
    const keyFile = path.join(directory, ".e2ee-recovery.key");
    const env = { CONFIG_PATH: path.join(directory, "config.json"), E2EE_RECOVERY_MASTER_KEY: "  " };
    try {
        const helpers = Array.from({ length: 4 }, () => load(env));
        const sealed = await Promise.all(helpers.map((helper) => helper.sealRecoverySecret(userId, backup.identity_key, backup.backup_public_key, secret)));
        assert.equal((await fsp.stat(keyFile)).mode & 0o777, 0o600);
        assert.deepEqual(await fsp.readdir(directory), [".e2ee-recovery.key"]);
        const restarted = load(env, async () => 4);
        for (const box of sealed) assert.equal(await restarted.openRecoverySecret(userId, backup.identity_key, backup.backup_public_key, box), secret);
    } finally {
        await fsp.rm(directory, { recursive: true, force: true });
    }
});

test("missing master with existing escrow rows returns safe503 and never generates replacement", async () => {
    const { secret, backup } = await fixture;
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "fosscord-recovery-test-"));
    try {
        const helper = load({ E2EE_RECOVERY_KEY_FILE: path.join(directory, "missing.key") }, async () => 1);
        await assert.rejects(helper.sealRecoverySecret(userId, backup.identity_key, backup.backup_public_key, secret), unavailable);
        assert.deepEqual(await fsp.readdir(directory), []);
    } finally {
        await fsp.rm(directory, { recursive: true, force: true });
    }
});

test("invalid, insecure and symlink master files fail safely without overwriting them", async () => {
    const { secret, backup } = await fixture;
    const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "fosscord-recovery-test-"));
    const keyFile = path.join(directory, "master.key");
    try {
        await fsp.writeFile(keyFile, "broken", { mode: 0o600 });
        await assert.rejects(load({ E2EE_RECOVERY_KEY_FILE: keyFile }).sealRecoverySecret(userId, backup.identity_key, backup.backup_public_key, secret), unavailable);
        assert.equal(await fsp.readFile(keyFile, "utf8"), "broken");
        await fsp.writeFile(keyFile, crypto.randomBytes(32).toString("base64url"));
        await fsp.chmod(keyFile, 0o644);
        await assert.rejects(load({ E2EE_RECOVERY_KEY_FILE: keyFile }).sealRecoverySecret(userId, backup.identity_key, backup.backup_public_key, secret), unavailable);
        await fsp.chmod(keyFile, 0o600);
        const before = await fsp.readFile(keyFile, "utf8");
        const alias = path.join(directory, "alias.key");
        await fsp.symlink(keyFile, alias);
        await assert.rejects(load({ E2EE_RECOVERY_KEY_FILE: alias }).sealRecoverySecret(userId, backup.identity_key, backup.backup_public_key, secret), unavailable);
        assert.equal(await fsp.readFile(keyFile, "utf8"), before);
        await assert.rejects(load({ E2EE_RECOVERY_MASTER_KEY: "not-a-master-key" }).sealRecoverySecret(userId, backup.identity_key, backup.backup_public_key, secret), unavailable);
    } finally {
        await fsp.rm(directory, { recursive: true, force: true });
    }
});
