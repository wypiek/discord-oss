const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const { buildSync } = require("esbuild");
const root = path.resolve(__dirname, "../..");
const result = buildSync({
    stdin: {
        contents: 'export {Engine,FALLBACK_CONTENT} from "./client/e2ee/src/engine"; export {createHooks} from "./client/e2ee/src/hooks";',
        resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
});
const compiled = new Module(path.join(root, "scripts/tests/e2ee-greet-fixture.cjs"), module);
compiled.filename = compiled.id;
compiled.paths = module.paths;
compiled._compile(result.outputFiles[0].text, compiled.filename);
const { Engine, FALLBACK_CONTENT, createHooks } = compiled.exports;
global.document = { documentElement: { lang: "en" } };

const WAVE = { id: "749054660769218631", name: "Wave", format_type: 3 };

const fixture = () => {
    const calls = [];
    const engine = new Engine(
        {
            request: async () => {
                throw new Error("Unexpected key API");
            },
        },
        (id) => id === "10",
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
        ready: Promise.resolve(true),
        attachments: { sent: () => {} },
        states: new Map(),
        sticker: (id) => (id === WAVE.id ? WAVE : null),
        failClosed: () => false,
        isReady: () => true,
        onState: () => {},
        updateRecord: () => {},
        onCredentials: () => {},
        onLogout: () => {},
        onError: () => {},
    });
    hooks.wrapHttp(http);
    return { calls, encryptedPayloads, http };
};

test("a wave in an encrypted DM goes out as an encrypted sticker message and never as a plaintext greet", async () => {
    const { http, calls, encryptedPayloads } = fixture();
    const reference = { channel_id: "10", message_id: "77" };
    await http.post({ url: "/channels/10/greet", body: { sticker_ids: [WAVE.id], message_reference: reference } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.url, "/channels/10/messages");
    assert.equal(calls[0].options.body.sticker_ids, undefined);
    assert.equal(calls[0].options.body.content, FALLBACK_CONTENT);
    assert.equal(calls[0].options.body.encrypted.ct, "sealed-fixture");
    assert.deepEqual(calls[0].options.body.message_reference, reference);
    assert.deepEqual(encryptedPayloads[0].payload.stickers, [WAVE]);
});

test("a wave on a server join message keeps using the greet endpoint", async () => {
    const { http, calls, encryptedPayloads } = fixture();
    await http.post({ url: "/channels/20/greet", body: { sticker_ids: [WAVE.id], message_reference: { channel_id: "20", message_id: "5" } } });
    assert.equal(calls[0].options.url, "/channels/20/greet");
    assert.deepEqual(calls[0].options.body.sticker_ids, [WAVE.id]);
    assert.equal(encryptedPayloads.length, 0);
});
