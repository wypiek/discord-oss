const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const ts = require("typescript");

async function load(relative, assets, overrides = {}) {
    const source = await fs.readFile(path.join(__dirname, "../..", relative), "utf8");
    const js = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
    }).outputText;
    const exported = { exports: {} };
    const context = vm.createContext({
        module: exported,
        exports: exported.exports,
        Buffer,
        AbortSignal,
        process: { env: overrides.env ?? {}, pid: process.pid },
        console: { error() {}, log() {} },
        fetch:
            overrides.fetch ??
            (() => {
                throw new Error("Unexpected network request");
            }),
        setInterval: () => ({
            unref() {
                return this;
            },
        }),
        require(id) {
            if (id.endsWith("/Constants") || id === "./Constants") return { ASSETS_FOLDER: assets };
            if (id.endsWith("/Config") || id === "./Config")
                return {
                    Config: {
                        get: () => ({
                            cdn: { endpointPublic: "http://local-cdn", endpointPrivate: "http://local-cdn" },
                        }),
                    },
                };
            if (id === "./ProcessLifecycle") return { ProcessLifecycle: { eventEmitter: new (require("node:events").EventEmitter)() } };
            if (id === "./Branding") return { instanceName: () => "Test instance" };
            if (id === "./SteamFrames") return { steamFrameCategory: () => ({ products: [] }), steamFrameRecency: () => undefined };
            if (id === "node:fs/promises" && overrides.fs) return overrides.fs;
            if (id === "jimp" && overrides.jimp) return overrides.jimp;
            return require(id);
        },
    });
    vm.runInContext(js, context, { filename: relative });
    return exported.exports;
}

test("local builtin metadata overrides remain offline, restore cleanly and preserve owned hidden products", async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spacebar-builtin-customization-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const original = [
        {
            sku_id: "30",
            name: "Vendor first",
            summary: "Original",
            products: [{ sku_id: "31", name: "Art", type: 0, items: [{ sku_id: "32", type: 0, asset: "art" }] }],
            catalog_banner_url: "vendor-banner",
            logo_url: "vendor-logo",
            hero_logo_url: "vendor-hero-logo",
            hero_banner_animated_url: "vendor-animation",
            hero_block_title: "Vendor title",
        },
        { sku_id: "20", name: "Vendor second", products: [] },
    ];
    const raw = JSON.stringify(original);
    await fs.writeFile(path.join(directory, "collectibles.json"), raw);
    const { Collectibles } = await load("src/util/util/Collectibles.ts", directory);
    let hidden = [],
        overrides = {};
    Collectibles.setCustomSource(async () => ({ categories: [], hidden, overrides }));
    const first = await Collectibles.get();
    overrides = {
        30: {
            name: "Local name",
            summary: "Local summary",
            position: 50,
            banner_url: "local-banner",
            logo_url: "local-logo",
        },
    };
    Collectibles.reload();
    const changed = await Collectibles.get();
    assert.notEqual(changed, first);
    assert.deepEqual(
        Array.from(changed.categories, (pack) => pack.sku_id),
        ["20", "30"],
    );
    const pack = changed.categories[1];
    assert.equal(pack.name, "Local name");
    assert.equal(pack.summary, "Local summary");
    assert.equal(pack.customized, true);
    for (const field of ["catalog_banner_url", "hero_banner_url", "featured_block_url", "mobile_banner_url"]) assert.equal(pack[field], "local-banner");
    assert.equal(pack.logo_url, "local-logo");
    assert.equal(pack.hero_logo_url, "local-logo");
    assert.equal(pack.hero_banner_animated_url, null);
    assert.equal(pack.hero_block_title, "Local name");
    const shop = await Collectibles.shop();
    assert.equal(shop.categories.find((item) => item.sku_id === "30").name, "Local name");
    assert.equal((await Collectibles.product("31")).name, "Art");
    hidden = ["30"];
    Collectibles.reload();
    assert.equal((await Collectibles.categories()).length, 1);
    assert.equal((await Collectibles.builtinCategories())[1].name, "Local name");
    assert.equal((await Collectibles.item("32", 0)).asset, "art");
    overrides = {};
    Collectibles.reload();
    const restored = (await Collectibles.builtinCategories())[0];
    assert.equal(restored.name, "Vendor first");
    assert.equal(restored.summary, "Original");
    assert.equal(restored.logo_url, "vendor-logo");
    assert.equal(restored.catalog_banner_url, "vendor-banner");
    assert.equal(restored.customized, false);
    assert.equal(await fs.readFile(path.join(directory, "collectibles.json"), "utf8"), raw);
});
