const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRewriter, endpointsFromOrigin, rewriteValue } = require("../../client/mobile/src/rewrite.ts");

const BUNDLE = path.join(__dirname, "..", "..", "assets", "public", "mobile", "meowcord.js");
const endpoints = { api: "https://chat.example/api/v9", gateway: "wss://chat.example/", cdn: "https://chat.example/", media: "https://chat.example" };

test("rewrites the four discord hosts and leaves everything else", () => {
    const rewrite = createRewriter(endpoints);
    assert.equal(rewrite("https://discord.com/api/v9/users/@me"), "https://chat.example/api/v9/users/@me");
    assert.equal(rewrite("https://canary.discordapp.com/api/v10/gateway"), "https://chat.example/api/v10/gateway");
    assert.equal(rewrite("https://discord.com/api"), "https://chat.example/api");
    assert.equal(rewrite("wss://gateway.discord.gg/?encoding=etf&v=9&compress=zstd-stream"), "wss://chat.example/?encoding=etf&v=9&compress=zstd-stream");
    assert.equal(rewrite("wss://gateway-us-east1-b.discord.gg"), "wss://chat.example");
    assert.equal(rewrite("https://cdn.discordapp.com/avatars/1/a.webp?size=128"), "https://chat.example/avatars/1/a.webp?size=128");
    assert.equal(rewrite("https://media.discordapp.net/attachments/1/2/x.png"), "https://chat.example/attachments/1/2/x.png");
    assert.equal(rewrite("https://discord.com/channels/@me"), "https://discord.com/channels/@me");
    assert.equal(rewrite("https://discord.company/api"), "https://discord.company/api");
    assert.equal(rewrite("https://cdn.discordapp.com.evil.test/x"), "https://cdn.discordapp.com.evil.test/x");
});

test("rewrites discord urls embedded in serialized text", () => {
    const rewrite = createRewriter(endpoints);
    const rows = JSON.stringify([{ avatarURL: "https://cdn.discordapp.com/avatars/1/a.png?size=80", content: "see https://media.discordapp.net/x.png)" }]);
    assert.equal(rewrite(rows), JSON.stringify([{ avatarURL: "https://chat.example/avatars/1/a.png?size=80", content: "see https://chat.example/x.png)" }]));
    assert.equal(rewrite('"https://cdn.discordapp.com.evil.test/x"'), '"https://cdn.discordapp.com.evil.test/x"');
});

test("derives endpoints from an instance origin", () => {
    assert.deepEqual(endpointsFromOrigin("https://chat.example/"), {
        api: "https://chat.example/api",
        gateway: "wss://chat.example",
        cdn: "https://chat.example",
        media: "https://chat.example",
    });
});

test("rewriteValue copies only what changes and skips class instances", () => {
    const rewrite = createRewriter(endpoints);
    const untouched = { width: 10, source: [{ uri: "file:///x.png" }] };
    assert.equal(rewriteValue(untouched, rewrite, 4), untouched);
    const props = { width: 10, source: [{ uri: "https://cdn.discordapp.com/icons/1/2.png" }] };
    const next = rewriteValue(props, rewrite, 4);
    assert.notEqual(next, props);
    assert.equal(next.source[0].uri, "https://chat.example/icons/1/2.png");
    assert.equal(props.source[0].uri, "https://cdn.discordapp.com/icons/1/2.png");
    const buffer = new Uint8Array(4);
    assert.equal(rewriteValue([buffer], rewrite, 4)[0], buffer);
});

test("the built bundle patches TurboModuleRegistry, NativeModules and view configs", { skip: !fs.existsSync(BUNDLE) }, () => {
    const code = fs.readFileSync(BUNDLE, "utf8");
    assert.ok(code.includes('"__MEOWCORD_ENDPOINTS__"'));
    const calls = [];
    const logs = [];
    const webSocket = { connect: (...args) => calls.push(["connect", ...args]) };
    const networking = { sendRequest: (...args) => calls.push(["sendRequest", ...args]) };
    const sandbox = {
        nativeLoggingHook: (message) => logs.push(message),
        nativeModuleProxy: { Networking: networking },
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(code.replace('"__MEOWCORD_ENDPOINTS__"', JSON.stringify(JSON.stringify(endpoints))), sandbox);
    const modules = [];
    sandbox.__d = (factory, id) => modules.push({ factory, id });
    const run = (index, exports) => {
        const moduleObject = { exports };
        sandbox.__d((global, require, importDefault, importAll, module) => {
            module.exports = exports;
        }, index);
        modules[index].factory(sandbox, null, null, null, moduleObject, moduleObject.exports, []);
        return moduleObject.exports;
    };
    const registry = run(0, { get: (name) => (name === "WebSocketModule" ? webSocket : null), getEnforcing: () => webSocket });
    registry.get("WebSocketModule").connect("wss://gateway.discord.gg/?v=9", null, {}, 1);
    const nativeModules = run(1, sandbox.nativeModuleProxy);
    nativeModules.Networking.sendRequest("GET", "https://discord.com/api/v9/experiments", 1, [["Authorization", "token"]], {}, "text", false, 0, true);
    const viewRegistry = run(2, { customBubblingEventTypes: {}, register: () => {}, get: () => ({ validAttributes: { src: true, opacity: true } }) });
    const config = viewRegistry.get("RCTImageView");
    assert.equal(config.validAttributes.opacity, true);
    assert.equal(config.validAttributes.src.process(vm.runInContext(`[{ uri: "https://cdn.discordapp.com/a.png" }]`, sandbox))[0].uri, "https://chat.example/a.png");
    assert.deepEqual(
        calls.map((call) => call.slice(0, 3)),
        [
            ["connect", "wss://chat.example/?v=9", null],
            ["sendRequest", "GET", "https://chat.example/api/v9/experiments"],
        ],
    );
    assert.ok(logs.some((line) => line.includes("patched TurboModuleRegistry")));
});
