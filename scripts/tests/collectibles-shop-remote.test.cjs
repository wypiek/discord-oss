const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const express = require("express");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { COLLECTIBLE_ART_SLOTS } = require("../../src/util/util/federation/Media.ts");

const REMOTE = { "1560000000000000001": "1300000000000000777" };
const fallbacks = [];
const upstream = [];

const util = {
    storage: { get: async () => null, exists: async () => false, set: async () => {} },
    setCacheControl: (_req, _res, next) => next(),
    setCacheControlNotFound: (_req, res) => res.status(404).end(),
    validateServerAuth: (_req, _res, next) => next(),
    internalUpload: (handler) => handler,
    fetchUpstreamAsset: async (path, url) => {
        upstream.push(url);
        return null;
    },
    sendAsset: (res, file) => res.end(file),
    safeMediaType: (type) => type ?? "application/octet-stream",
};

const sendRemoteFallback = async (_req, res, localId, remotePath) => {
    const remote = REMOTE[localId];
    if (!remote) return false;
    fallbacks.push(remotePath(remote));
    res.status(200).send("remote");
    return true;
};

const loadRouter = () => {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync("src/cdn/routes/media/v1/collectibles-shop.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const modules = {
        express,
        "lambert-server/HTTPError": { HTTPError: Error },
        "file-type": { fileTypeFromBuffer: async () => undefined },
        "../../../util": util,
        "@spacebar/util": {
            COLLECTIBLE_ART_SLOTS,
            steamFrameBySku: () => undefined,
            steamFrameArtUrl: () => null,
            Config: { get: () => ({ cdn: { endpointPublic: "http://home.example/" } }) },
        },
        "../../../util/federationMedia": { sendRemoteFallback },
        "node:crypto": require("node:crypto"),
    };
    vm.runInNewContext(source, { module, exports: module.exports, require: (name) => modules[name] ?? require(name), Buffer, console });
    return module.exports.default;
};

const serve = async (run) => {
    const app = express();
    app.use("/media/v1/collectibles-shop", loadRouter());
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    try {
        await run(`http://127.0.0.1:${server.address().port}/media/v1/collectibles-shop`);
    } finally {
        server.close();
    }
};

test("art of a shop item from another instance comes from that instance for every slot the client asks for", async () => {
    fallbacks.length = 0;
    upstream.length = 0;
    await serve(async (base) => {
        for (const slot of ["static", "animated", "video", "effect", "thumbnail", "reduced"]) {
            const response = await fetch(`${base}/1560000000000000001/${slot}`);
            assert.equal(response.status, 200, slot);
            assert.equal(await response.text(), "remote", slot);
        }
    });
    assert.deepEqual(
        fallbacks,
        ["static", "animated", "video", "effect", "thumbnail", "reduced"].map((slot) => `/media/v1/collectibles-shop/1300000000000000777/${slot}`),
    );
    assert.deepEqual(upstream, []);
});

test("local SKUs and other paths go to Discord's CDN, never to another instance", async () => {
    fallbacks.length = 0;
    upstream.length = 0;
    await serve(async (base) => {
        assert.equal((await fetch(`${base}/1349849614198505602/video`)).status, 404);
        assert.equal((await fetch(`${base}/1560000000000000001/banner`)).status, 404);
        assert.equal((await fetch(`${base}/1560000000000000001/1300000000000000555/static`)).status, 404);
    });
    assert.deepEqual(fallbacks, []);
    assert.deepEqual(upstream, [
        "https://cdn.discordapp.com/media/v1/collectibles-shop/1349849614198505602/video",
        "https://cdn.discordapp.com/media/v1/collectibles-shop/1560000000000000001/banner",
        "https://cdn.discordapp.com/media/v1/collectibles-shop/1560000000000000001/1300000000000000555/static",
    ]);
});
