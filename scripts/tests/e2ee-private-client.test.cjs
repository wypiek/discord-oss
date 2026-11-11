const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const root = path.resolve(__dirname, "../..");
const result = buildSync({
    stdin: {
        contents:
            'export {Engine,FALLBACK_CONTENT} from "./client/e2ee/src/engine"; export {createHooks} from "./client/e2ee/src/hooks"; export {generateSigningKey,generateAgreementKey,exportPublic,sign,deviceIdFor,deviceMessage,prekeyMessage,generateExportable,importSigningJwk,backupKeyMessage,verify} from "./client/e2ee/src/crypto"; export {sealJwk} from "./client/e2ee/src/backup";',
        resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
});
const compiled = new Module(path.join(root, "scripts/tests/private-e2ee-fixture.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
compiled._compile(result.outputFiles[0].text, compiled.filename);
const {
    Engine,
    FALLBACK_CONTENT,
    createHooks,
    generateSigningKey,
    generateAgreementKey,
    exportPublic,
    sign,
    deviceIdFor,
    deviceMessage,
    prekeyMessage,
    generateExportable,
    importSigningJwk,
    backupKeyMessage,
    verify,
    sealJwk,
} = compiled.exports;
global.document = { documentElement: { lang: "en" } };

const fixture = (ready, encryptedChannel = "10") => {
    const calls = [];
    const engine = new Engine(
        {
            request: async () => {
                throw new Error("Unexpected key API");
            },
        },
        (id) => id === encryptedChannel,
    );
    const encryptedPayloads = [];
    engine.encrypt = async (id, payload) => {
        encryptedPayloads.push({ id, payload });
        return { ct: "sealed-fixture", sig: "fixture-signature" };
    };
    const http = Object.fromEntries(
        ["get", "post", "put", "patch", "del"].map((method) => [
            method,
            async (options) => {
                calls.push({ method, options });
                return { ok: true, status: 200, body: {} };
            },
        ]),
    );
    const hooks = createHooks({
        engine,
        ready,
        attachments: { sent: () => {} },
        states: new Map(),
        sticker: () => null,
        failClosed: () => false,
        isReady: () => true,
        onState: () => {},
        updateRecord: () => {},
        onCredentials: () => {},
        onLogout: () => {},
        onError: () => {},
    });
    hooks.wrapHttp(http);
    return { engine, calls, encryptedPayloads, http };
};

test("a first private message waits for bootstrap and reaches HTTP only as an encrypted envelope", async () => {
    let finish;
    const ready = new Promise((resolve) => {
        finish = resolve;
    });
    const { http, calls, encryptedPayloads, engine } = fixture(ready);
    assert.equal(engine.encryptedChannels.size, 0);
    const input = {
        url: "/channels/10/messages",
        body: { content: "private first draft", nonce: "123" },
    };
    const sending = http.post(input);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 0);
    finish(true);
    await sending;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.body.content, FALLBACK_CONTENT);
    assert.equal(calls[0].options.body.encrypted.ct, "sealed-fixture");
    assert.equal(encryptedPayloads[0].payload.content, "private first draft");
    assert.equal(input.body.content, "private first draft");
});

test("bootstrap failure never forwards a private draft to HTTP", async () => {
    const { http, calls } = fixture(Promise.resolve(false));
    await assert.rejects(http.post({ url: "/channels/10/messages", body: { content: "must stay private" } }), (error) => error.code === "NOT_READY");
    assert.equal(calls.length, 0);
});

test("a newly opened private channel encrypts immediately without waiting for an encryption update event", async () => {
    const { http, calls, engine } = fixture(Promise.resolve(true));
    assert.equal(engine.encryptedChannels.size, 0);
    await http.post({ url: "/channels/10/messages", body: { content: "new conversation" } });
    assert.equal(calls[0].options.body.content, FALLBACK_CONTENT);
    assert.ok(calls[0].options.body.encrypted);
});

test("ordinary guild messages retain their existing send behavior", async () => {
    const { http, calls, encryptedPayloads } = fixture(Promise.resolve(false));
    await http.post({ url: "/channels/20/messages", body: { content: "guild message" } });
    assert.equal(calls[0].options.body.content, "guild message");
    assert.equal(calls[0].options.body.encrypted, undefined);
    assert.equal(encryptedPayloads.length, 0);
});

test("explicit encrypted channels stay protected when native channel metadata is unavailable", () => {
    const engine = new Engine({ request: async () => {} }, () => false);
    engine.setChannelEncrypted("30");
    assert.equal(engine.isEncrypted("30"), true);
    assert.equal(engine.isEncrypted("40"), false);
});

const directoryFixture = async (trustsServer, corruptSignature = false) => {
    const previous = await generateSigningKey();
    const identity = await generateSigningKey();
    const deviceKey = await generateSigningKey();
    const agreement = await generateAgreementKey();
    const previousKey = await exportPublic(previous.publicKey);
    const identityKey = await exportPublic(identity.publicKey);
    const signingKey = await exportPublic(deviceKey.publicKey);
    const deviceId = await deviceIdFor(signingKey);
    const publicKey = await exportPublic(agreement.publicKey);
    const keys = {
        identity_key: identityKey,
        devices: [
            {
                device_id: deviceId,
                signing_key: signingKey,
                status: "active",
                name: "Signed-in browser",
                identity_signature: corruptSignature ? "invalid-signature" : await sign(identity.privateKey, deviceMessage("peer", deviceId, signingKey)),
                prekey: {
                    id: 1,
                    public_key: publicKey,
                    signature: await sign(deviceKey.privateKey, prekeyMessage(deviceId, 1, publicKey)),
                },
            },
        ],
    };
    const engine = new Engine(
        { request: async () => ({ users: { peer: keys } }) },
        () => true,
        () => trustsServer,
    );
    engine.userId = "local-user";
    engine.store = { set: async () => {}, get: async () => undefined, del: async () => {} };
    engine.contacts.peer = {
        identityKey: previousKey,
        verified: true,
        pendingKey: null,
        firstSeen: Date.now(),
    };
    return { engine, previousKey, identityKey };
};

test("trusted-server mode accepts a directory change and retains historical keys after validating device signatures", async () => {
    const { engine, previousKey, identityKey } = await directoryFixture(true);
    const [entry] = await engine.keysFor(["peer"]);
    assert.equal(entry.identityChanged, false);
    assert.equal(entry.devices.length, 1);
    assert.equal(engine.contacts.peer.identityKey, identityKey);
    assert.equal(engine.contacts.peer.pendingKey, null);
    assert.equal(engine.contacts.peer.verified, false);
    assert.deepEqual(engine.contacts.peer.previousKeys, [previousKey]);
});

test("advanced strict safety checks keep an unsigned directory change pending", async () => {
    const { engine, previousKey, identityKey } = await directoryFixture(false);
    const [entry] = await engine.keysFor(["peer"]);
    assert.equal(entry.identityChanged, true);
    assert.equal(engine.contacts.peer.identityKey, previousKey);
    assert.equal(engine.contacts.peer.pendingKey, identityKey);
});

test("trusted-server mode still rejects devices with invalid identity signatures", async () => {
    const { engine } = await directoryFixture(true, true);
    const [entry] = await engine.keysFor(["peer"]);
    assert.equal(entry.devices.length, 0);
});

const recoveryFixture = async (trusted = true, alterIdentity = (key) => key) => {
    const userId = "5";
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const identity = await generateExportable("Ed25519");
    const backupKey = await generateExportable("X25519");
    const privateKey = await importSigningJwk(identity);
    const backup = {
        identity_key: identity.x,
        backup_public_key: backupKey.x,
        backup_key_signature: await sign(privateKey, backupKeyMessage(userId, backupKey.x)),
        wrapped_identity: await sealJwk(secret, "identity", userId, await alterIdentity(identity)),
        wrapped_backup_key: await sealJwk(secret, "backup-key", userId, backupKey),
        version: 1,
        mode: "recovery",
    };
    const calls = [];
    const writes = [];
    const engine = new Engine(
        {
            request: async (method, path, body) => {
                calls.push({ method, path, body });
                if (method === "get" && path === "/users/@me/e2ee/backup") return backup;
                if (method === "get" && path === "/users/@me/e2ee/backup/escrow") return { ready: false };
                if (method === "post") return { backup_secret: Buffer.from(secret).toString("base64url") };
            },
        },
        () => true,
        () => trusted,
    );
    engine.userId = userId;
    engine.serverKey = backup.identity_key;
    engine.store = {
        set: async (...args) => writes.push(args),
        del: async () => {},
        get: async () => null,
    };
    engine.refresh = async () => {
        engine.linked = true;
    };
    return { engine, secret, backup, privateKey, calls, writes };
};

test("trusted password recovery restores a recovery-only backup after validating both sealed keys", async () => {
    const { engine, backup, calls, writes } = await recoveryFixture();
    assert.equal(await engine.recoverWithPassword("account-password-fixture"), true);
    assert.equal(engine.identity.publicKey, backup.identity_key);
    assert.equal(engine.backupKeyPair.publicKey, backup.backup_public_key);
    assert.ok(writes.some(([key]) => key === "backup-secret"));
    assert.equal(calls[0].path, "/users/@me/e2ee/backup/escrow/recover");
});

test("strict safety mode never requests a server recovery secret", async () => {
    const { engine, calls, writes } = await recoveryFixture(false);
    assert.equal(await engine.recoverWithPassword("account-password-fixture"), false);
    assert.equal(calls.length, 0);
    assert.equal(writes.length, 0);
});

test("server recovery rejects a forged identity private key without changing identity or storage", async () => {
    const { engine, writes } = await recoveryFixture(true, async (key) => ({
        ...key,
        d: (await generateExportable("Ed25519")).d,
    }));
    const previous = { publicKey: "existing-identity", privateKey: null };
    engine.identity = previous;
    await assert.rejects(engine.recoverWithPassword("account-password-fixture"));
    assert.equal(engine.identity, previous);
    assert.equal(writes.length, 0);
    assert.equal(engine.secret, null);
});

test("server recovery rejects an invalid backup signature before persisting any secret", async () => {
    const { engine, backup, writes } = await recoveryFixture();
    backup.backup_key_signature = "invalid";
    await assert.rejects(engine.recoverWithPassword("account-password-fixture"));
    assert.equal(writes.length, 0);
    assert.equal(engine.identity, null);
});

test("server recovery rejects malformed secret length without mutating storage", async () => {
    const { engine, writes } = await recoveryFixture();
    engine.api.request = async () => ({ backup_secret: Buffer.alloc(31).toString("base64url") });
    await assert.rejects(engine.recoverWithPassword("account-password-fixture"));
    assert.equal(writes.length, 0);
});

test("server recovery upload binds the decoded secret digest and current backup/device to its identity signature", async () => {
    const { engine, backup, secret, privateKey, calls } = await recoveryFixture();
    engine.identity = { publicKey: backup.identity_key, privateKey };
    engine.device = { deviceId: "device-fixture" };
    engine.secret = secret;
    engine.backup = backup;
    engine.linked = true;
    await engine.publishServerRecovery();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, "get");
    assert.equal(calls[1].method, "put");
    assert.equal(calls[1].path, "/users/@me/e2ee/backup/escrow");
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", secret)).toString("base64url");
    const message = `fosscord-e2ee/v1/server-recovery\n5\n${backup.identity_key}\n1\ndevice-fixture\n${digest}`;
    assert.equal(await verify(backup.identity_key, message, calls[1].body.signature), true);
    assert.equal(engine.serverRecoveryReady, true);
    await engine.publishServerRecovery();
    assert.equal(calls.length, 2, "unchanged backup is not repeatedly published");
});

test("server recovery rejects noncanonical secret encoding without changing storage", async () => {
    const { engine, secret, writes } = await recoveryFixture();
    engine.api.request = async () => ({
        backup_secret: Buffer.from(secret).toString("base64url") + "=",
    });
    await assert.rejects(engine.recoverWithPassword("account-password-fixture"));
    assert.equal(writes.length, 0);
});
