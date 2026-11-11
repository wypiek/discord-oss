const assert = require("node:assert/strict");
const test = require("node:test");
const { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } = require("@hpke/core");
const { createWebCrypto, restoreKey, storeKey } = require("../../client/mobile/src/e2ee/subtle.ts");
const { decodeValue, encodeValue } = require("../../client/mobile/src/e2ee/store.ts");

const native = globalThis.crypto;
const shim = createWebCrypto((length) => native.getRandomValues(new Uint8Array(length)));
const text = (value) => new TextEncoder().encode(value);
const hex = (buffer) => Buffer.from(buffer).toString("hex");

const withCrypto = async (provider, task) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: provider, configurable: true, writable: true });
    try {
        return await task();
    } finally {
        Object.defineProperty(globalThis, "crypto", descriptor);
    }
};

const suite = () => new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });

test("ed25519 signatures verify across the shim and webcrypto", async () => {
    for (const [signer, checker] of [
        [shim, native],
        [native, shim],
    ]) {
        const pair = await signer.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
        const raw = await signer.subtle.exportKey("raw", pair.publicKey);
        const signature = await signer.subtle.sign({ name: "Ed25519" }, pair.privateKey, text("hello"));
        const key = await checker.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
        assert.equal(await checker.subtle.verify({ name: "Ed25519" }, key, signature, text("hello")), true);
        assert.equal(await checker.subtle.verify({ name: "Ed25519" }, key, signature, text("hellO")), false);
    }
});

test("ed25519 jwk export from webcrypto imports into the shim with the same signatures", async () => {
    const pair = await native.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const jwk = await native.subtle.exportKey("jwk", pair.privateKey);
    const imported = await shim.subtle.importKey("jwk", { ...jwk, key_ops: ["sign"] }, { name: "Ed25519" }, false, ["sign"]);
    const nativeSig = await native.subtle.sign({ name: "Ed25519" }, pair.privateKey, text("same"));
    assert.equal(hex(await shim.subtle.sign({ name: "Ed25519" }, imported, text("same"))), hex(nativeSig));
    await assert.rejects(shim.subtle.importKey("jwk", { ...jwk, x: jwk.x.replace(/^./, jwk.x[0] === "A" ? "B" : "A") }, { name: "Ed25519" }, false, ["sign"]));
    await assert.rejects(shim.subtle.exportKey("jwk", imported));
});

test("x25519 shared secrets match webcrypto", async () => {
    const mine = await shim.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    const theirs = await native.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    const minePublic = await native.subtle.importKey("raw", await shim.subtle.exportKey("raw", mine.publicKey), { name: "X25519" }, true, []);
    const theirsPublic = await shim.subtle.importKey("raw", await native.subtle.exportKey("raw", theirs.publicKey), { name: "X25519" }, true, []);
    const a = await shim.subtle.deriveBits({ name: "X25519", public: theirsPublic }, mine.privateKey, 256);
    const b = await native.subtle.deriveBits({ name: "X25519", public: minePublic }, theirs.privateKey, 256);
    assert.equal(hex(a), hex(b));
    const jwk = await shim.subtle.exportKey("jwk", mine.privateKey);
    const nativeMine = await native.subtle.importKey("jwk", jwk, { name: "X25519" }, false, ["deriveBits"]);
    assert.equal(hex(await native.subtle.deriveBits({ name: "X25519", public: theirs.publicKey }, nativeMine, 256)), hex(b));
    const zero = await shim.subtle.importKey("raw", new Uint8Array(32), { name: "X25519" }, true, []);
    await assert.rejects(shim.subtle.deriveBits({ name: "X25519", public: zero }, mine.privateKey, 256));
});

test("aes-gcm, hkdf, hmac and digests match webcrypto", async () => {
    const raw = native.getRandomValues(new Uint8Array(32));
    const iv = native.getRandomValues(new Uint8Array(12));
    const params = { name: "AES-GCM", iv, additionalData: text("aad") };
    const nativeKey = await native.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    const shimKey = await shim.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    const sealed = await native.subtle.encrypt(params, nativeKey, text("secret"));
    assert.equal(hex(await shim.subtle.encrypt(params, shimKey, text("secret"))), hex(sealed));
    assert.equal(new TextDecoder().decode(await shim.subtle.decrypt(params, shimKey, sealed)), "secret");
    const tampered = new Uint8Array(sealed);
    tampered[0] ^= 1;
    await assert.rejects(shim.subtle.decrypt(params, shimKey, tampered));
    await assert.rejects(shim.subtle.decrypt({ ...params, additionalData: text("other") }, shimKey, sealed));

    const hkdf = { name: "HKDF", hash: "SHA-256", salt: text("salt"), info: text("info") };
    const nativeBase = await native.subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]);
    const shimBase = await shim.subtle.importKey("raw", raw, "HKDF", false, ["deriveBits"]);
    assert.equal(hex(await shim.subtle.deriveBits(hkdf, shimBase, 256)), hex(await native.subtle.deriveBits(hkdf, nativeBase, 256)));

    const hmacAlg = { name: "HMAC", hash: { name: "SHA-256" } };
    const nativeMac = await native.subtle.importKey("raw", raw, hmacAlg, false, ["sign"]);
    const shimMac = await shim.subtle.importKey("raw", raw, hmacAlg, false, ["sign", "verify"]);
    const mac = await native.subtle.sign("HMAC", nativeMac, text("data"));
    assert.equal(hex(await shim.subtle.sign("HMAC", shimMac, text("data"))), hex(mac));
    assert.equal(await shim.subtle.verify("HMAC", shimMac, mac, text("data")), true);

    for (const name of ["SHA-256", "SHA-512"]) assert.equal(hex(await shim.subtle.digest(name, text("abc"))), hex(await native.subtle.digest(name, text("abc"))));
});

test("hpke seals from webcrypto open with the shim and the other way round", async () => {
    const recipient = await withCrypto(shim, () => suite().kem.generateKeyPair());
    const recipientPublic = new Uint8Array(await shim.subtle.exportKey("raw", recipient.publicKey));
    const sealed = await suite().seal({ recipientPublicKey: await suite().kem.deserializePublicKey(recipientPublic), info: text("info") }, text("content key"), text("aad"));
    const opened = await withCrypto(shim, () => suite().open({ recipientKey: recipient, enc: sealed.enc, info: text("info") }, sealed.ct, text("aad")));
    assert.equal(new TextDecoder().decode(opened), "content key");

    const nativeRecipient = await suite().kem.generateKeyPair();
    const nativePublic = new Uint8Array(await native.subtle.exportKey("raw", nativeRecipient.publicKey));
    const back = await withCrypto(shim, async () => {
        const s = suite();
        return s.seal({ recipientPublicKey: await s.kem.deserializePublicKey(nativePublic), info: text("info") }, text("other key"), text("aad"));
    });
    assert.equal(new TextDecoder().decode(await suite().open({ recipientKey: nativeRecipient, enc: back.enc, info: text("info") }, back.ct, text("aad"))), "other key");
});

test("stored keys and bytes survive the mobile key store encoding", async () => {
    const pair = await shim.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);
    const value = { keyPair: pair, secret: new Uint8Array([1, 2, 3]), id: 4 };
    const restored = decodeValue(encodeValue(value));
    assert.equal(restored.id, 4);
    assert.deepEqual([...restored.secret], [1, 2, 3]);
    assert.equal(restored.keyPair.privateKey.extractable, false);
    const peer = await shim.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
    const a = await shim.subtle.deriveBits({ name: "X25519", public: peer.publicKey }, restored.keyPair.privateKey, 256);
    const b = await shim.subtle.deriveBits({ name: "X25519", public: restored.keyPair.publicKey }, peer.privateKey, 256);
    assert.equal(hex(a), hex(b));
    assert.throws(() => restoreKey({ ...storeKey(pair.privateKey), public: storeKey(peer.publicKey).public }));
});

test("getRandomValues refuses float arrays and oversized requests", () => {
    assert.throws(() => shim.getRandomValues(new Float64Array(2)));
    assert.throws(() => shim.getRandomValues(new Uint8Array(65537)));
    assert.equal(shim.getRandomValues(new Uint32Array(4)).length, 4);
});
