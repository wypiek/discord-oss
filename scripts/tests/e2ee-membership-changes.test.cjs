const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("node:module");
const ts = require("typescript");
const { buildSync } = require("esbuild");

const { entity, In, IsNull, Not, load } = require("./fake-orm.cjs");

const author = "1400000000000000001";
const member = "1400000000000000002";
const former = "1400000000000000003";
const channelId = "1400000000000000100";
const b64 = (length) => crypto.randomBytes(length).toString("base64url");

class ApiError extends Error {
    constructor(message, code, status) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

function server() {
    const db = {
        Channel: { ensureDefaultPrivateEncryption: async () => {} },
        E2eeDevice: entity("E2eeDevice"),
        User: entity("User"),
    };
    db.User.rows.push({ id: author, federated_instance: null }, { id: member, federated_instance: null }, { id: former, federated_instance: null });
    db.E2eeDevice.rows.push(
        { id: "author-device", user_id: author, status: "active", prekey_id: 1, signing_key: b64(32), revoked_at: null },
        { id: "member-device", user_id: member, status: "active", prekey_id: 2, signing_key: b64(32), revoked_at: null },
        { id: "former-device", user_id: former, status: "active", prekey_id: 3, signing_key: b64(32), revoked_at: null },
    );
    const module = load("src/api/util/utility/e2ee.ts", {
        "node:crypto": crypto,
        typeorm: { In, IsNull, Not },
        "@spacebar/database": db,
        "@spacebar/util": {
            ApiError,
            CANONICAL: /^@\d{1,20}@[a-z0-9.:-]+$/,
            Config: { get: () => ({ limits: { e2ee: { maxEnvelopeDevices: 256, maxEnvelopeBytes: 65536 } } }) },
            MessageFlags: { FLAGS: { SUPPRESS_EMBEDS: 4n } },
            emitEvent: async () => {},
        },
        "@spacebar/schemas": { ChannelType: { DM: 1, GROUP_DM: 3 }, MessageType: { DEFAULT: 0, REPLY: 19 } },
        "../../middlewares/RateLimit": () => () => {},
        "./federationE2ee": { remoteE2eeKeys: async () => new Map() },
        "./federationIds": { canonicalOf: async (id) => id, localIds: async () => new Map() },
    });
    const key = (user_id, device_id, prekey_id) => ({ user_id, device_id, prekey_id, enc: b64(32), wrapped: b64(48) });
    const backup = (user_id) => ({ user_id, enc: b64(32), wrapped: b64(48) });
    const send = async (members, extra) => {
        const envelope = {
            v: 1,
            alg: "x25519-hpke-aes256gcm-ed25519",
            sender_device: "author-device",
            iv: b64(12),
            ct: b64(40),
            keys: [key(author, "author-device", 1), key(member, "member-device", 2)],
            sig: b64(64),
            ...extra,
        };
        const channel = { id: channelId, type: 3, e2ee_enabled_at: new Date(), recipients: members.map((user_id) => ({ user_id })) };
        const message = { mentions: [], flags: 0, attachments: [] };
        await module.applyE2eeToMessage({ author_id: author, content: "🔒 Encrypted message", encrypted: envelope }, channel, message);
        return message;
    };
    return { errors: module.E2eeErrors, send, key, backup };
}

test("an envelope written for a member who just left asks the client to reload the members", async () => {
    const { errors, send, key, backup } = server();
    const mismatch = (error) => error === errors.DEVICE_MISMATCH;
    await assert.rejects(send([author, member], { backup: [backup(author), backup(member), backup(former)] }), mismatch, "a backup key for the member who left");
    await assert.rejects(
        send([author, member], { keys: [key(author, "author-device", 1), key(member, "member-device", 2), key(former, "former-device", 3)] }),
        mismatch,
        "a device key for the member who left",
    );
    await assert.rejects(send([author, member], { mentions: [former] }), mismatch, "a mention of the member who left");
    await assert.rejects(send([author, member, former], {}), mismatch, "a member who joined is missing");
    await send([author, member], { backup: [backup(author), backup(member)] });
});

test("an envelope with a malformed backup list is still rejected as invalid", async () => {
    const { errors, send, backup } = server();
    await assert.rejects(send([author, member], { backup: [backup(member), backup(member)] }), (error) => error === errors.INVALID_ENVELOPE);
    await assert.rejects(send([author, member], { mentions: [author] }), (error) => error === errors.INVALID_ENVELOPE);
});

const root = path.resolve(__dirname, "../..");
const bundle = () => {
    const result = buildSync({
        stdin: { contents: 'export {Engine,E2eeError} from "./client/e2ee/src/engine"; export {createHooks} from "./client/e2ee/src/hooks";', resolveDir: root },
        bundle: true,
        write: false,
        platform: "node",
        format: "cjs",
    });
    const compiled = new Module(path.join(root, "scripts/tests/membership-e2ee-fixture.cjs"), module);
    compiled.filename = compiled.id;
    compiled.paths = module.paths;
    compiled._compile(result.outputFiles[0].text, compiled.filename);
    return compiled.exports;
};
const { Engine, E2eeError, createHooks } = bundle();
global.document ??= { documentElement: { lang: "en" } };

const hooksFixture = (engine) => {
    const errors = [];
    const states = new Map();
    const http = {};
    const hooks = createHooks({
        engine,
        ready: Promise.resolve(true),
        attachments: { sent: () => {}, apply: () => {} },
        states,
        sticker: () => null,
        failClosed: () => false,
        isReady: () => true,
        onState: () => {},
        updateRecord: () => {},
        onCredentials: () => {},
        onLogout: () => {},
        onError: (error, channel) => errors.push({ error, channel }),
        fetchEmbeds: async () => ({}),
        fetchSoundmoji: async () => [],
    });
    return { hooks, http, errors, states };
};

const sendingEngine = (encrypt) => {
    const engine = new Engine({ request: async () => ({}) }, (id) => id === channelId);
    engine.encrypt = encrypt;
    engine.invalidated = 0;
    engine.invalidateAll = () => engine.invalidated++;
    return engine;
};

const mismatch = () => Object.assign(new Error("409"), { status: 409, body: { code: 90001, message: "E2EE_DEVICE_MISMATCH" } });

const sendThrough = (http, callback) => http.post({ url: `/channels/${channelId}/messages`, body: { content: "hello", nonce: "1" } }, callback);

const settled = (promise, ms = 1000) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve("still waiting"), ms))]);

test("a send whose retry can't be encrypted still answers the client's message queue", async () => {
    let encrypted = 0;
    const engine = sendingEngine(async () => {
        encrypted++;
        if (encrypted === 2) throw new E2eeError("NO_DEVICES", "nobody can read it");
        return { ct: "sealed", sig: "sig" };
    });
    const { hooks, http, errors } = hooksFixture(engine);
    http.post = async () => {
        throw mismatch();
    };
    for (const method of ["get", "put", "patch", "del"]) http[method] = async () => ({ ok: true, status: 200, body: {} });
    hooks.wrapHttp(http);
    const answered = new Promise((resolve) => sendThrough(http, resolve).catch(() => {}));
    const response = await settled(answered);
    assert.notEqual(response, "still waiting", "the message queue got an answer");
    assert.equal(response.ok, false);
    assert.equal(response.hasErr, true);
    assert.equal(errors.length, 1, "the sender sees why it wasn't sent");
    assert.equal(errors[0].channel, channelId);
});

test("a send retries device mismatches with fresh keys and answers the queue once", async () => {
    let encrypted = 0;
    const engine = sendingEngine(async () => {
        encrypted++;
        return { ct: `sealed-${encrypted}`, sig: "sig" };
    });
    const { hooks, http } = hooksFixture(engine);
    let posted = 0;
    http.post = async (opts, callback) => {
        posted++;
        if (posted <= 2) throw mismatch();
        const response = { ok: true, status: 200, body: { id: "1", channel_id: channelId }, headers: {} };
        callback?.(response);
        return response;
    };
    for (const method of ["get", "put", "patch", "del"]) http[method] = async () => ({ ok: true, status: 200, body: {} });
    hooks.wrapHttp(http);
    const answers = [];
    await sendThrough(http, (response) => answers.push(response));
    assert.equal(posted, 3, "two membership changes in a row are retried");
    assert.equal(encrypted, 3);
    assert.equal(engine.invalidated, 2, "every retry reloads the key directory");
    assert.equal(answers.length, 1);
    assert.equal(answers[0].ok, true);
});

test("a send that the server rejects without answering the callback still answers the queue", async () => {
    const engine = sendingEngine(async () => ({ ct: "sealed", sig: "sig" }));
    const { hooks, http, errors } = hooksFixture(engine);
    http.post = async () => {
        throw Object.assign(new Error("400"), { status: 400, body: { code: 90003, message: "E2EE_INVALID_ENVELOPE" } });
    };
    for (const method of ["get", "put", "patch", "del"]) http[method] = async () => ({ ok: true, status: 200, body: {} });
    hooks.wrapHttp(http);
    const response = await settled(new Promise((resolve) => sendThrough(http, resolve).catch(() => {})));
    assert.notEqual(response, "still waiting");
    assert.equal(response.status, 400);
    assert.equal(errors.length, 1, "the sender sees the encryption error");
});

const message = (id, author) => ({
    id,
    channel_id: channelId,
    content: "🔒 Encrypted message",
    author: { id: author },
    encrypted: { v: 1, alg: "x", sender_device: "d", iv: "i", ct: "c", keys: [], sig: `sig-${id}` },
});

const readingEngine = (decrypt) => {
    const engine = new Engine({ request: async () => ({}) }, () => true);
    engine.decrypt = decrypt;
    return engine;
};

test("a message that couldn't be decrypted because its sender's new device wasn't known yet decrypts when that sender's keys change", async () => {
    let known = false;
    const engine = readingEngine(async () => {
        if (!known) throw new E2eeError("UNKNOWN_SENDER", "The sender's device couldn't be verified");
        return { content: "from a new device" };
    });
    const { hooks, states } = hooksFixture(engine);
    await hooks.decryptAll([message("7", member)]);
    assert.equal(states.get("7").state, "failed");
    known = true;
    hooks.retryFailed(author);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(states.get("7").state, "failed", "another sender's update doesn't touch it");
    hooks.retryFailed(member);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(states.get("7").state, "decrypted");
});

test("a message that couldn't be decrypted because a key lookup failed is tried again", async () => {
    let lookups = 0;
    const engine = readingEngine(async () => {
        lookups++;
        if (lookups === 1) throw Object.assign(new Error("offline"), { status: 0 });
        return { content: "after the network came back" };
    });
    const { hooks, states } = hooksFixture(engine);
    await hooks.decryptAll([message("8", member)]);
    assert.equal(states.get("8").state, "failed");
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(lookups, 2);
    assert.equal(states.get("8").state, "decrypted");
});

test("a bad signature is never retried", async () => {
    let calls = 0;
    const engine = readingEngine(async () => {
        calls++;
        throw new E2eeError("BAD_SIGNATURE", "Signature check failed");
    });
    const { hooks, states } = hooksFixture(engine);
    await hooks.decryptAll([message("9", member)]);
    hooks.retryFailed(member);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    assert.equal(states.get("9").state, "failed");
});

function decryptHarness(keysFor, envelope) {
    const source = ts.createSourceFile("engine.ts", fs.readFileSync("client/e2ee/src/engine.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const engine = source.statements.find((node) => ts.isClassDeclaration(node) && node.name.text === "Engine");
    const method = engine.members.find((node) => ts.isMethodDeclaration(node) && node.name.getText(source) === "decrypt");
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(`class Extracted { ${method.getText(source)} };module.exports=Extracted;`, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            ALGORITHM: "synthetic-envelope",
            E2eeError,
            t: (text) => text,
            snowflakeTime: () => 1000,
            binding: () => "synthetic-binding",
            signedPayload: () => "synthetic-signature-input",
            messageAad: () => "synthetic-message-aad",
            WRAP_INFO: "device",
            BACKUP_INFO: "backup",
            storedKeyAad: () => "synthetic-stored-aad",
            verify: async () => true,
            hpkeOpen: async () => {
                throw Error("no key");
            },
            aesDecrypt: async () => new Uint8Array(),
            fromB64u: () => new Uint8Array(),
            toB64u: () => "",
            fromUtf8: () => "{}",
            parsePayload: (value) => value,
        },
    );
    const instance = new module.exports();
    Object.assign(instance, {
        cached: () => undefined,
        plaintext: new Map(),
        contentKeys: new Map(),
        device: { deviceId: "receiving-device" },
        userId: "owner",
        linked: true,
        identityCreatedAt: null,
        prekeys: [{ id: 1, keyPair: {} }],
        backupKeyPair: { publicKey: "backup", keyPair: {} },
        keysFor,
        lookupStoredKey: async () => null,
        bindingFor: (channel, sender, mid) => ({ v: 1, channel, sender, mid, user: (id) => id }),
    });
    return {
        instance,
        message: {
            id: "1",
            channel_id: "channel",
            author: { id: "sender" },
            encrypted: { v: 1, alg: "synthetic-envelope", mid: "1", sig: "s", sender_device: "sending-device", iv: "i", ct: "c", keys: [], ...envelope },
        },
    };
}

const senderWith = (devices) => async () => [{ fetchedAt: Date.now(), identityCreatedAt: null, devices }];

test("a message from a device the reader doesn't know yet is marked as retryable", async () => {
    const h = decryptHarness(senderWith([]), {});
    await assert.rejects(h.instance.decrypt(h.message), (error) => error.code === "UNKNOWN_SENDER");
});

test("a message sent before the reader was in the conversation says so instead of blaming the browser", async () => {
    const sender = senderWith([{ deviceId: "sending-device", signingKey: "k", status: "active" }]);
    const outside = decryptHarness(sender, { keys: [{ user_id: "someone", device_id: "theirs", prekey_id: 1, enc: "e", wrapped: "w" }] });
    await assert.rejects(outside.instance.decrypt(outside.message), (error) => error.code === "NOT_RECIPIENT");
    const otherBrowser = decryptHarness(sender, { keys: [{ user_id: "owner", device_id: "older-browser", prekey_id: 1, enc: "e", wrapped: "w" }] });
    await assert.rejects(otherBrowser.instance.decrypt(otherBrowser.message), (error) => error.code === "NO_KEY");
});
