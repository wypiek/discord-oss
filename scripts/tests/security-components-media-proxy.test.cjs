const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function remoteMedia(proxy) {
    const direct = [];
    const proxied = [];
    const connect = (url) => {
        direct.push(String(url));
        throw new Error("connected directly");
    };
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync("src/api/util/utility/remoteMedia.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const imports = {
        "node:dns/promises": {
            lookup: async () => {
                direct.push("dns");
                return [{ address: "93.184.216.34", family: 4 }];
            },
        },
        "node:http": { request: connect },
        "node:https": { request: connect },
        "node:net": require("node:net"),
        "node:buffer": require("node:buffer"),
        "@spacebar/util/util/networking/SocksTransport": { outboundProxy: () => proxy },
        "@spacebar/util/util/networking/PublicNetwork": {
            isPrivateAddress: () => false,
            fetchPublicUrl: async (url, init, redirects, limits) => {
                proxied.push({ url, redirects, limits });
                if (!proxy) throw new Error("PUBLIC_FETCH_PROXY is not set, so requests to user-chosen URLs are refused");
                return new Response("media", { headers: { "content-type": "image/png" } });
            },
        },
    };
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        URL,
        Response,
        AbortController,
        Buffer,
        setTimeout,
        clearTimeout,
        require: (name) => {
            assert.ok(name in imports, `missing mock for ${name}`);
            return imports[name];
        },
    });
    return { download: module.exports.downloadRemoteMedia, direct, proxied };
}

test("components media goes through the outbound proxy when one is configured", async () => {
    const { download, direct, proxied } = remoteMedia({ host: "127.0.0.1", port: 1080 });
    const blob = await download("https://media.example/cat.png", 1024);
    assert.equal(await blob.text(), "media");
    assert.equal(blob.type, "image/png");
    assert.deepEqual(direct, []);
    assert.equal(proxied.length, 1);
    assert.equal(proxied[0].url, "https://media.example/cat.png");
    assert.equal(proxied[0].limits.maxBytes, 1024);
});

test("components media is refused instead of fetched directly when the outbound proxy is unset", async () => {
    const { download, direct } = remoteMedia(null);
    await assert.rejects(download("https://media.example/cat.png", 1024), /PUBLIC_FETCH_PROXY is not set/);
    assert.deepEqual(direct, []);
});
