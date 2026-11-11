const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const crypto = require("node:crypto");
const hpke = require("@hpke/core");
const load = (file, imports) => {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
            },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) => imports[name] ?? require(name),
            process,
            Buffer,
            crypto: crypto.webcrypto,
            TextEncoder,
            TextDecoder,
            Uint8Array,
            ArrayBuffer,
            DataView,
            Blob,
            URL,
            location: { origin: "http://fosscord.test" },
            atob,
            btoa,
        },
    );
    return module.exports;
};
const bytes = load("client/e2ee/src/bytes.ts", {});
const client = load("client/e2ee/src/crypto.ts", { "./bytes": bytes });
const safetyNoticeText = load("client/e2ee/src/safetyNoticeText.ts", {});
const files = load("client/e2ee/src/files.ts", {
    "./bytes": bytes,
    "./safetyNoticeText": safetyNoticeText,
});
const attachmentUrl = load("client/e2ee/src/attachmentUrl.ts", {});
const attachments = load("client/e2ee/src/attachments.ts", {
    "./bytes": bytes,
    "./files": files,
    "./attachmentUrl": attachmentUrl,
});
const deviceId = (key) => crypto.createHash("sha256").update(Buffer.from(key, "base64url")).digest().subarray(0, 16).toString("base64url");
const deviceMessage = (u, d, k) => `fosscord-e2ee/v1/device\n${u}\n${d}\n${k}`;
const prekeyMessage = (d, i, k) => `fosscord-e2ee/v1/prekey\n${d}\n${i}\n${k}`;
const backupMessage = (u, k) => `fosscord-e2ee/v1/backup-key\n${u}\n${k}`;
const sign = (key, value) => crypto.sign(null, Buffer.from(value), key).toString("base64url");
async function harness() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fosscord-system-crypto-"));
    const original = process.env.E2EE_SYSTEM_KEY_DIR;
    process.env.E2EE_SYSTEM_KEY_DIR = dir;
    const identities = new Map(),
        devices = new Map();
    const identityRepo = {
        exists: async ({ where }) => identities.has(where.user_id),
        findOne: async ({ where }) => identities.get(where.user_id),
        insert: async (value) => identities.set(value.user_id, value),
    };
    const deviceRepo = {
        exists: async ({ where }) => [...devices.values()].some((d) => d.user_id === where.user_id),
        findOne: async ({ where }) => devices.get(where.id),
        insert: async (value) => devices.set(value.id, value),
    };
    const entities = {
        E2eeIdentity: identityRepo,
        E2eeDevice: deviceRepo,
        getDatabase: () => ({
            transaction: async (fn) => fn({ query: async () => [], getRepository: (entity) => entity }),
        }),
    };
    const directory = async (ids) =>
        Object.fromEntries(
            ids.map((id) => [
                id,
                {
                    identity_key: identities.get(id)?.public_key,
                    devices: [...devices.values()]
                        .filter((d) => d.user_id === id)
                        .map((d) => ({
                            device_id: d.id,
                            status: d.status,
                            signing_key: d.signing_key,
                            identity_signature: d.identity_signature,
                            prekey: {
                                id: d.prekey_id,
                                public_key: d.prekey_public,
                                signature: d.prekey_signature,
                            },
                        })),
                },
            ]),
        );
    const source = () =>
        load("src/api/util/utility/systemEncryption.ts", {
            "@spacebar/database": entities,
            "@spacebar/schemas": { UserFlags: { FLAGS: { SYSTEM: 8n } } },
            "./e2ee": {
                e2eeDeviceId: deviceId,
                e2eeDeviceMessage: deviceMessage,
                e2eePrekeyMessage: prekeyMessage,
                e2eeBackupKeyMessage: backupMessage,
                e2eeLimits: () => ({ maxEnvelopeDevices: 32 }),
                e2eeUserKeys: directory,
            },
        });
    const sender = { id: "1234567890", username: "official", flags: 8 };
    const recipient = "1234567891";
    const identity = crypto.generateKeyPairSync("ed25519"),
        signing = crypto.generateKeyPairSync("ed25519"),
        prekey = crypto.generateKeyPairSync("x25519");
    const pub = (pair) => pair.publicKey.export({ format: "jwk" }).x;
    const id = deviceId(pub(signing));
    identities.set(recipient, { user_id: recipient, public_key: pub(identity) });
    devices.set(id, {
        id,
        user_id: recipient,
        status: "active",
        signing_key: pub(signing),
        identity_signature: sign(identity.privateKey, deviceMessage(recipient, id, pub(signing))),
        prekey_id: 1,
        prekey_public: pub(prekey),
        prekey_signature: sign(signing.privateKey, prekeyMessage(id, 1, pub(prekey))),
    });
    return {
        helper: source(),
        source,
        sender,
        recipient,
        prekey,
        identities,
        devices,
        dir,
        cleanup() {
            fs.rmSync(dir, { recursive: true, force: true });
            if (original === undefined) delete process.env.E2EE_SYSTEM_KEY_DIR;
            else process.env.E2EE_SYSTEM_KEY_DIR = original;
        },
    };
}
test("system envelopes decrypt with the actual client HPKE/AES implementation and bind to channel/nonce", async () => {
    const h = await harness();
    try {
        const envelope = await h.helper.encryptSystemPayload(h.sender, [h.recipient], "1234567892", "1234567893", {
            content: "Only the encrypted payload contains this announcement",
        });
        const managed = await h.helper.ensureSystemSender(h.sender);
        const target = envelope.keys.find((entry) => entry.user_id === h.recipient);
        const pair = await client.importAgreementJwk(h.prekey.privateKey.export({ format: "jwk" }));
        const aad = `fosscord-e2ee/v1/msg\n1234567892\n${h.sender.id}\n${managed.deviceId}\nn:1234567893`;
        const key = await client.hpkeOpen(pair, target.enc, target.wrapped, "fosscord-e2ee/v1/wrap", `${aad}\n${target.device_id}`);
        const plain = await client.aesDecrypt(key, bytes.fromB64u(envelope.iv), bytes.fromB64u(envelope.ct), aad);
        assert.equal(JSON.parse(bytes.fromUtf8(plain)).content, "Only the encrypted payload contains this announcement");
        await assert.rejects(client.aesDecrypt(key, bytes.fromB64u(envelope.iv), bytes.fromB64u(envelope.ct), aad + "tampered"));
        const canonical = [
            "fosscord-e2ee/v1/sig",
            "1234567892",
            h.sender.id,
            "n:1234567893",
            1,
            envelope.alg,
            envelope.sender_device,
            null,
            envelope.iv,
            envelope.ct,
            [...envelope.keys].sort((a, b) => (a.device_id < b.device_id ? -1 : 1)).map((d) => [d.user_id, d.device_id, d.prekey_id, d.enc, d.wrapped]),
        ];
        assert.equal(await client.verify(managed.signingPublic, JSON.stringify(canonical), envelope.sig), true);
        assert.equal(envelope.keys.length, 2);
    } finally {
        h.cleanup();
    }
});
test("sender keys survive module restart and never silently reset missing, changed, or revoked identity", async () => {
    const h = await harness();
    try {
        const first = await h.helper.ensureSystemSender(h.sender);
        const second = await h.source().ensureSystemSender(h.sender);
        assert.equal(first.deviceId, second.deviceId);
        assert.equal(first.identityPublic, second.identityPublic);
        assert.equal(fs.statSync(path.join(h.dir, `${h.sender.id}.key`)).mode & 0o777, 0o600);
        h.devices.get(first.deviceId).status = "revoked";
        await assert.rejects(h.source().ensureSystemSender(h.sender), /unavailable/);
        h.devices.get(first.deviceId).status = "active";
        h.identities.get(h.sender.id).public_key = "changed";
        await assert.rejects(h.source().ensureSystemSender(h.sender), /unavailable/);
        fs.unlinkSync(path.join(h.dir, `${h.sender.id}.key`));
        await assert.rejects(h.source().ensureSystemSender(h.sender), /unavailable/);
        assert.equal(fs.existsSync(path.join(h.dir, `${h.sender.id}.key`)), false);
    } finally {
        h.cleanup();
    }
});
test("missing recipient keys queue instead of plaintext; invalid signed devices are rejected", async () => {
    const h = await harness();
    try {
        const recipientDevice = [...h.devices.values()][0];
        recipientDevice.identity_signature = "tampered";
        await assert.rejects(h.helper.encryptSystemPayload(h.sender, [h.recipient], "123", "456", { content: "test" }), /verified/);
        h.devices.delete(recipientDevice.id);
        await assert.rejects(h.helper.encryptSystemPayload(h.sender, [h.recipient], "123", "456", { content: "test" }), h.helper.SystemRecipientNotReady);
        await assert.rejects(h.helper.ensureSystemSender({ ...h.sender, flags: 0 }), /unavailable/);
    } finally {
        h.cleanup();
    }
});
test("encrypted system attachments round-trip through actual client chunk decrypt, including empty files", async () => {
    const h = await harness();
    try {
        for (const length of [0, 1, 65536, 65537, 150000]) {
            const plain = crypto.randomBytes(length);
            const [file] = h.helper.encryptSystemFiles([
                {
                    fieldname: "files[0]",
                    originalname: "private-name.txt",
                    mimetype: "text/plain",
                    buffer: plain,
                },
            ]);
            assert.match(file.originalname, /^[a-f0-9]{32}\.bin$/);
            assert.equal(file.mimetype, "application/octet-stream");
            const native = attachments.createAttachments();
            const message = {
                channel_id: "123",
                attachments: [{ id: "456", filename: file.originalname, url: "http://cdn.test/encrypted.bin" }],
            };
            native.apply(message, { content: "Encrypted attachment", attachments: [file.meta] });
            assert.equal(message.attachments[0].filename, "private-name.txt");
            assert.equal(message.attachments[0].content_type, "text/plain");
            assert.equal(message.attachments[0].url, "http://fosscord.test/e2ee/attachments/123/456/private-name.txt");
            assert.equal(native.nameOf("456"), file.originalname);
            const data = Uint8Array.from(file.buffer).buffer;
            const decoded = await files.decryptFile(data, file.meta.key, file.meta.iv);
            assert.deepEqual(Buffer.concat(decoded.map((part) => Buffer.from(part))), plain);
            file.buffer[0] ^= 1;
            await assert.rejects(files.decryptFile(Uint8Array.from(file.buffer).buffer, file.meta.key, file.meta.iv));
        }
    } finally {
        h.cleanup();
    }
});
test("private announcement spool is authenticated and scoped to announcement ID", async () => {
    const h = await harness();
    try {
        const sealed = await h.helper.sealSystemSpool(h.sender, "111", "sensitive-file-metadata");
        assert.equal(sealed.includes(Buffer.from("sensitive-file-metadata")), false);
        assert.equal(await h.helper.openSystemSpool(h.sender, "111", sealed), "sensitive-file-metadata");
        await assert.rejects(h.helper.openSystemSpool(h.sender, "112", sealed));
        sealed[13] ^= 1;
        await assert.rejects(h.helper.openSystemSpool(h.sender, "111", sealed));
    } finally {
        h.cleanup();
    }
});
