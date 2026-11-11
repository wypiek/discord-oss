const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildSync } = require("esbuild");
const Module = require("node:module");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const result = buildSync({
    stdin: {
        contents: 'export {Engine} from "./client/e2ee/src/engine"; export {generateSigningKey,exportPublic} from "./client/e2ee/src/crypto";',
        resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
});
const compiled = new Module(__filename, module);
compiled.paths = module.paths;
compiled._compile(result.outputFiles[0].text, __filename);
const { Engine, generateSigningKey, exportPublic } = compiled.exports;
const fixture = async (api, device = "device") => {
    const signing = await generateSigningKey();
    const engine = new Engine(
        api,
        () => false,
        () => true,
    );
    engine.userId = "123";
    engine.linked = true;
    engine.identity = {
        publicKey: await exportPublic(signing.publicKey),
        privateKey: signing.privateKey,
    };
    engine.secret = new Uint8Array(32).fill(7);
    engine.device = { deviceId: device };
    engine.backup = {
        identity_key: engine.identity.publicKey,
        version: 1,
        backup_public_key: "backup",
    };
    return engine;
};

test("concurrent escrow publication uses one authenticated status and one signed upload", async () => {
    let puts = 0,
        gets = 0;
    const engine = await fixture({
        request: async (method) => {
            if (method === "get") {
                gets++;
                return { ready: false };
            }
            puts++;
        },
    });
    await Promise.all(Array.from({ length: 30 }, () => engine.publishServerRecovery()));
    assert.equal(puts, 1);
    assert.equal(gets, 1);
    assert.equal(engine.serverRecoveryReady, true);
});

test("thirty reloads and legitimate device changes reuse current durable escrow", async () => {
    let puts = 0;
    for (let i = 0; i < 30; i++) {
        let engine;
        engine = await fixture(
            {
                request: async (method) => {
                    if (method === "put") {
                        puts++;
                        return;
                    }
                    return {
                        ready: true,
                        identity_key: engine.backup.identity_key,
                        backup_public_key: "backup",
                        backup_version: 1,
                    };
                },
            },
            `device-${i}`,
        );
        await engine.publishServerRecovery();
        assert.equal(engine.serverRecoveryReady, true);
    }
    assert.equal(puts, 0);
});

test("missing and stale escrow still require signed upload", async () => {
    for (const state of [
        { ready: false },
        { ready: true, identity_key: "stale", backup_public_key: "backup", backup_version: 1 },
        { ready: true, identity_key: "unused", backup_public_key: "other", backup_version: 2 },
    ]) {
        let puts = 0;
        const engine = await fixture({
            request: async (method, _url, body) => {
                if (method === "get") return state;
                puts++;
                assert.equal(body.device_id, "device");
                assert.ok(body.signature);
                assert.ok(body.backup_secret);
            },
        });
        await engine.publishServerRecovery();
        assert.equal(puts, 1);
    }
});

test("failed publication releases its flight and never reports recovery ready", async () => {
    let calls = 0;
    const engine = await fixture({
        request: async (method) => {
            if (method === "get") return { ready: false };
            if (++calls === 1) throw { status: 429 };
        },
    });
    await assert.rejects(engine.publishServerRecovery());
    assert.equal(engine.serverRecoveryReady, false);
    assert.equal(engine.recoveryPublishing.size, 0);
    await engine.publishServerRecovery();
    assert.equal(calls, 2);
    assert.equal(engine.serverRecoveryReady, true);
});

test("status failures and account changes do not publish secrets", async () => {
    for (const changed of [false, true]) {
        let puts = 0,
            engine;
        engine = await fixture({
            request: async (method) => {
                if (method === "put") puts++;
                if (!changed) throw { status: 503 };
                engine.userId = "456";
                return { ready: false };
            },
        });
        if (changed) await engine.publishServerRecovery();
        else await assert.rejects(engine.publishServerRecovery());
        assert.equal(puts, 0);
        assert.equal(engine.serverRecoveryReady, false);
    }
});

test("synchronous transport failure clears the flight and zeroizes only the temporary secret", async () => {
    const engine = await fixture({
        request: () => {
            throw new Error("transport unavailable");
        },
    });
    let copy;
    const original = engine.secret;
    original.slice = () => (copy = new Uint8Array(original));
    await assert.rejects(engine.publishServerRecovery());
    assert.equal(engine.recoveryPublishing.size, 0);
    assert.ok(copy.every((byte) => byte === 0));
    assert.ok(original.every((byte) => byte === 7));
    await assert.rejects(engine.publishServerRecovery());
    assert.equal(engine.recoveryPublishing.size, 0);
});

test("context changes during signing prevent old-secret publication and zeroize the flight", async () => {
    for (const change of [
        (engine) => {
            engine.linked = false;
        },
        (engine) => {
            engine.userId = "456";
        },
        (engine) => {
            engine.trustDirectory = () => false;
        },
        (engine) => {
            engine.backup.version++;
        },
    ]) {
        let puts = 0,
            copy,
            release,
            entered;
        const signing = new Promise((resolve) => {
            entered = resolve;
        });
        const blocked = new Promise((resolve) => {
            release = resolve;
        });
        const engine = await fixture({
            request: async (method) => {
                if (method === "put") puts++;
                return { ready: false };
            },
        });
        const secret = engine.secret;
        secret.slice = () => (copy = new Uint8Array(secret));
        const originalSign = crypto.subtle.sign;
        crypto.subtle.sign = async function (...args) {
            entered();
            await blocked;
            return originalSign.apply(this, args);
        };
        try {
            const pending = engine.publishServerRecovery();
            await signing;
            change(engine);
            release();
            await pending;
            assert.equal(puts, 0);
            assert.equal(engine.serverRecoveryReady, false);
            assert.equal(engine.recoveryPublishing.size, 0);
            assert.ok(copy.every((byte) => byte === 0));
            assert.ok(secret.every((byte) => byte === 7));
        } finally {
            release();
            crypto.subtle.sign = originalSign;
        }
    }
});
