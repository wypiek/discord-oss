const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const zlib = require("node:zlib");
const ts = require("typescript");
const jimp = require("jimp");

function transpile(file) {
    return ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
}

function load(file, imports) {
    const module = { exports: {} };
    vm.runInNewContext(transpile(file), {
        module,
        exports: module.exports,
        Buffer,
        console,
        require: (name) => imports[name] ?? require(name),
    });
    return module.exports;
}

function pngHeader(width, height) {
    const chunk = (type, data) => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(zlib.crc32(body));
        return Buffer.concat([length, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.alloc(1))), chunk("IEND", Buffer.alloc(0))]);
}

async function render(icon) {
    const reads = [];
    const Jimp = new Proxy(jimp.Jimp, {
        get(target, key) {
            if (key !== "read") return Reflect.get(target, key);
            return async (input) => {
                if (input !== icon) return target.read(input);
                reads.push(input);
                if (input.readUInt32BE(16) > 4096) throw new Error("refusing to decode the oversized test icon");
                return target.read(input);
            };
        },
    });
    let handler;
    const BrandAssetRequest = load("src/util/util/BrandAssetRequest.ts", {});
    load("src/api/routes/guilds/#guild_id/widget.png.ts", {
        express: { Router: () => ({ get: (_, ...steps) => (handler = steps.at(-1)) }) },
        "lambert-server/HTTPError": { HTTPError: class extends Error {} },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/cdn/util/Storage": { storage: { get: async () => icon } },
        "@spacebar/database": { Guild: { findOneOrFail: async () => ({ id: "guild", name: "Guild", icon: "hash", widget_enabled: true }), countPresences: async () => 1 } },
        "@spacebar/util": { DiscordApiErrors: {} },
        "@spacebar/util/util/BrandAssetRequest": BrandAssetRequest,
        jimp: { ...jimp, Jimp },
    });
    let sent;
    await handler({ params: { guild_id: "guild" }, query: { style: "banner2" } }, { set() {}, send: (body) => (sent = body) });
    assert.ok(Buffer.isBuffer(sent) && sent.length > 0);
    return reads.length;
}

test("a guild icon that declares 20000x20000 pixels is not decoded for the widget image", async () => {
    assert.equal(await render(pngHeader(20000, 20000)), 0);
});

test("a normal guild icon is still drawn on the widget image", async () => {
    const icon = await new jimp.Jimp({ width: 64, height: 64, color: 0xff0000ff }).getBuffer("image/png");
    assert.equal(await render(icon), 1);
});
