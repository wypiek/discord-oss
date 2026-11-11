const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { validateStickerAsset, digest } = require("../lib/sticker-assets.cjs");
const animation = { w: 320, h: 320, fr: 60, layers: [], assets: [] };
const json = (value) => Buffer.from(JSON.stringify(value));
test("self-contained Lottie validates and pins deterministic bytes", () => {
    assert.deepEqual(validateStickerAsset(json(animation), 3), {
        format: "lottie",
        externalReferences: 0,
    });
    assert.equal(digest(json(animation)).length, 64);
    assert.equal(digest(json(animation)), digest(json(animation)));
});
test("malformed and remote or unresolved Lottie artwork fails closed", () => {
    for (const value of [
        {},
        { ...animation, w: 0 },
        { ...animation, assets: [{ u: "https://cdn.example/", p: "a.png" }] },
        { ...animation, assets: [{ p: "relative.png" }] },
        { ...animation, assets: [{ p: "data:image/svg+xml;base64,PHN2Zz4=" }] },
        { ...animation, nm: "//external.example/path" },
    ])
        assert.throws(() => validateStickerAsset(json(value), 3));
    assert.throws(() => validateStickerAsset(Buffer.from("invalid json"), 3));
});
test("embedded image data is local and PNG metadata rejects empty images", () => {
    assert.equal(validateStickerAsset(json({ ...animation, assets: [{ p: "data:image/png;base64,AA==" }] }), 3).externalReferences, 0);
    const png = Buffer.alloc(33);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.write("IHDR", 12);
    png.writeUInt32BE(320, 16);
    png.writeUInt32BE(320, 20);
    assert.equal(validateStickerAsset(png, 2).format, "apng");
    png.writeUInt32BE(0, 16);
    assert.throws(() => validateStickerAsset(png, 2));
});
test("canonical sticker fallback requires its own explicit policy", () => {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/util/config/types/ExternalRequestConfiguration.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        { exports: module.exports, module, URL },
    );
    const { ExternalRequestConfiguration, allowsCdnUpstream } = module.exports;
    const policy = new ExternalRequestConfiguration();
    policy.discordStickerPacks = false;
    const url = "https://cdn.discordapp.com/stickers/749054660769218631.json";
    assert.equal(allowsCdnUpstream(policy, url), false);
    policy.discordAssetFallback = true;
    assert.equal(allowsCdnUpstream(policy, url), false);
    policy.discordStickerPacks = true;
    assert.equal(allowsCdnUpstream(policy, url), true);
    for (const unsafe of [
        "http://cdn.discordapp.com/stickers/1.png",
        "https://cdn.discordapp.com:8443/stickers/1.png",
        "https://user@cdn.discordapp.com/stickers/1.png",
        "https://cdn.discordapp.com/stickers/1%2f.png",
        "https://evil.example/stickers/1.png",
    ])
        assert.equal(allowsCdnUpstream(policy, unsafe), false);
});
