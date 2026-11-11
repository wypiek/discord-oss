const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const ts = require("typescript");

// Execute the actual TypeScript modules with isolated config, assets, and network.
// No database, environment credentials, timers, or external services are required.
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
        clearInterval: overrides.clearInterval ?? (() => {}),
        setInterval:
            overrides.setInterval ??
            (() => ({
                unref() {
                    return this;
                },
            })),
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
            if (id === "./ProcessLifecycle")
                return {
                    ProcessLifecycle: {
                        eventEmitter: overrides.lifecycle ?? new (require("node:events").EventEmitter)(),
                    },
                };
            if (id === "./Branding") return { instanceName: () => "Test instance" };
            if (id === "./SteamFrames") return overrides.steamFrames ?? { steamFrameCategory: () => ({ products: [] }), steamFrameRecency: () => undefined };
            if (id === "node:fs/promises" && overrides.fs) return overrides.fs;
            if (id.endsWith("/BrandAssetRequest"))
                return (
                    overrides.imageRequest ?? {
                        readBrandAssetFile: (file) => (overrides.fs ?? fs).readFile(file),
                        withinBrandImageLimits: () => true,
                        fetchBrandAsset: async (url, _requireImageType, limits) => {
                            if (!overrides.fetch) throw Error("Unexpected image request");
                            const response = await overrides.fetch(url, {
                                signal: AbortSignal.timeout(limits.timeoutMs),
                            });
                            return response.ok ? { data: Buffer.from(await response.arrayBuffer()), type: "image/png" } : null;
                        },
                    }
                );
            if (id === "jimp" && overrides.jimp) return overrides.jimp;
            return require(id);
        },
    });
    vm.runInContext(js, context, { filename: relative });
    return exported.exports;
}

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "spacebar-local-catalog-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return directory;
}
const category = {
    sku_id: "10",
    name: "Discord pack",
    products: [
        {
            sku_id: "11",
            name: "Decoration",
            type: 0,
            items: [{ sku_id: "12", type: 0, asset: "image" }],
            prices: {
                0: {
                    country_prices: {
                        country_code: "US",
                        prices: [{ amount: 500, currency: "USD", exponent: 2 }],
                    },
                },
            },
        },
    ],
};

test("missing catalog is cached and custom packs remain available without network", async (t) => {
    const directory = await fixture(t);
    let reads = 0;
    const { Collectibles } = await load("src/util/util/Collectibles.ts", directory, {
        fs: {
            ...fs,
            stat: (...args) => {
                reads++;
                return fs.stat(...args);
            },
        },
    });
    Collectibles.setCustomSource(async () => ({ categories: [category], hidden: [] }));
    const first = await Collectibles.get();
    assert.equal(first.categories.length, 1);
    assert.equal(await Collectibles.get(), first);
    assert.equal(reads, 2);
    assert.equal((await Collectibles.refresh()).ok, true);
    assert.equal((await Collectibles.product("11")).name, "Decoration");
    assert.equal((await Collectibles.status()).catalog.external_refresh_enabled, false);
});

test("stale local catalog stays free and hidden packs preserve owned-item lookup", async (t) => {
    const directory = await fixture(t);
    await fs.writeFile(path.join(directory, "collectibles.json"), JSON.stringify([category]));
    await fs.utimes(path.join(directory, "collectibles.json"), new Date(0), new Date(0));
    const { Collectibles } = await load("src/util/util/Collectibles.ts", directory);
    Collectibles.setCustomSource(async () => ({ categories: [], hidden: ["10"] }));
    assert.equal((await Collectibles.categories()).length, 0);
    const product = await Collectibles.product("11");
    assert.equal(product.prices["0"].country_prices.prices[0].amount, 0);
    assert.equal((await Collectibles.builtinCategories())[0].name, "Test instance pack");
    assert.equal((await Collectibles.item("12", 0)).asset, "image");
});

test("a URL alone does not enable external refresh", async (t) => {
    const directory = await fixture(t);
    const { Collectibles } = await load("src/util/util/Collectibles.ts", directory, {
        env: { COLLECTIBLES_CATALOG_URL: "https://operator.example/catalog.json" },
    });
    assert.equal((await Collectibles.refresh()).ok, true);
    assert.equal((await Collectibles.status()).catalog.external_refresh_enabled, false);
});

test("opted-in refreshes are deduplicated and have a bounded abort signal", async (t) => {
    const directory = await fixture(t);
    let requests = 0;
    const { Collectibles } = await load("src/util/util/Collectibles.ts", directory, {
        env: {
            COLLECTIBLES_EXTERNAL_REFRESH: "true",
            COLLECTIBLES_CATALOG_URL: "https://operator.example/catalog.json",
        },
        fetch: async (_, options) => {
            requests++;
            assert.ok(options.signal instanceof AbortSignal);
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { ok: true, text: async () => JSON.stringify([category]) };
        },
    });
    const results = await Promise.all(Array.from({ length: 20 }, () => Collectibles.refresh()));
    assert.equal(requests, 1);
    assert.equal(results[0].ok, true);
    assert.equal((await Collectibles.product("11")).prices["0"].country_prices.prices[0].amount, 0);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "collectibles.json"), "utf8")), [category]);
});

test("invalid external catalog cannot overwrite a valid local snapshot", async (t) => {
    const directory = await fixture(t);
    const snapshot = JSON.stringify([category]);
    await fs.writeFile(path.join(directory, "collectibles.json"), snapshot);
    const { Collectibles } = await load("src/util/util/Collectibles.ts", directory, {
        env: {
            COLLECTIBLES_EXTERNAL_REFRESH: "true",
            COLLECTIBLES_CATALOG_URL: "https://operator.example/catalog.json",
        },
        fetch: async () => ({ ok: true, text: async () => '[{"sku_id":"not-a-snowflake"}]' }),
    });
    assert.equal((await Collectibles.refresh()).ok, false);
    assert.equal(await fs.readFile(path.join(directory, "collectibles.json"), "utf8"), snapshot);
});

test("unicode bursts dedupe local image reads and cache deterministic fallback without network", async (t) => {
    const directory = await fixture(t);
    let reads = 0;
    const { getBurstColors } = await load("src/api/util/utility/BurstColors.ts", directory, {
        fs: {
            ...fs,
            readFile: async (...args) => {
                reads++;
                return fs.readFile(...args);
            },
        },
    });
    const colors = await Promise.all(Array.from({ length: 30 }, () => getBurstColors({ name: "❤️" })));
    assert.equal(reads, 1);
    assert.equal(colors[0].length, 2);
    assert.ok(colors[0].every((color) => /^#[a-f0-9]{6}$/i.test(color)));
    assert.deepEqual(await getBurstColors({ name: "❤" }), colors[0]);
    colors[0][0] = "changed";
    assert.notEqual((await getBurstColors({ name: "❤" }))[0], "changed");
    assert.equal(reads, 1);
});

test("local Twemoji palette is used when present", async (t) => {
    const directory = await fixture(t);
    await fs.mkdir(path.join(directory, "twemoji", "72x72"), { recursive: true });
    await fs.writeFile(path.join(directory, "twemoji", "72x72", "2764.png"), "local fixture");
    const { getBurstColors } = await load("src/api/util/utility/BurstColors.ts", directory, {
        jimp: {
            Jimp: {
                read: async () => ({ bitmap: { data: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]) } }),
            },
        },
    });
    assert.deepEqual(Array.from(await getBurstColors({ name: "❤" })), ["#ff0000", "#00ff00"]);
});

test("unicode burst cache evicts old keys after 1024 entries", async (t) => {
    const directory = await fixture(t);
    let reads = 0;
    const { getBurstColors } = await load("src/api/util/utility/BurstColors.ts", directory, {
        fs: {
            ...fs,
            readFile: async () => {
                reads++;
                throw new Error("No local image");
            },
        },
    });
    for (let i = 0; i < 1025; i++) await getBurstColors({ name: String.fromCodePoint(0x1f300 + i) });
    await getBurstColors({ name: String.fromCodePoint(0x1f300) });
    assert.equal(reads, 1026);
});

test("a pending refresh cannot republish custom packs invalidated by reload", async (t) => {
    const directory = await fixture(t);
    const { Collectibles } = await load("src/util/util/Collectibles.ts", directory);
    let unblock;
    let started;
    const waiting = new Promise((resolve) => {
        started = resolve;
    });
    const gate = new Promise((resolve) => {
        unblock = resolve;
    });
    let calls = 0;
    Collectibles.setCustomSource(async () => {
        calls++;
        if (calls === 1) {
            started();
            await gate;
            return { categories: [category], hidden: [] };
        }
        return { categories: [], hidden: [] };
    });
    const pending = Collectibles.refresh();
    await waiting;
    Collectibles.reload();
    const current = await Collectibles.get();
    assert.equal(current.categories.length, 0);
    unblock();
    assert.equal((await pending).ok, true);
    assert.equal(await Collectibles.get(), current);
    assert.equal(calls, 2);
});

test("replacing the custom source during refresh keeps the new source published", async (t) => {
    const directory = await fixture(t);
    const { Collectibles } = await load("src/util/util/Collectibles.ts", directory);
    let unblock;
    let started;
    const waiting = new Promise((resolve) => {
        started = resolve;
    });
    const gate = new Promise((resolve) => {
        unblock = resolve;
    });
    Collectibles.setCustomSource(async () => {
        started();
        await gate;
        return { categories: [category], hidden: [] };
    });
    const pending = Collectibles.refresh();
    await waiting;
    Collectibles.setCustomSource(async () => ({ categories: [], hidden: [] }));
    const current = await Collectibles.get();
    unblock();
    await pending;
    assert.equal(await Collectibles.get(), current);
    assert.equal((await Collectibles.categories()).length, 0);
});

test("catalog shutdown cancels refresh timers and drains an atomic cache replacement", async (t) => {
    const directory = await fixture(t);
    await fs.writeFile(path.join(directory, "collectibles.json"), JSON.stringify([category]));
    await fs.writeFile(path.join(directory, "profile-effects.json"), "[]");
    const lifecycle = new (require("node:events").EventEmitter)();
    const next = [{ ...category, name: "Updated fixture pack" }];
    let downloads = 0;
    let finishRename;
    let renameStarted;
    const reachedRename = new Promise((resolve) => {
        renameStarted = resolve;
    });
    const barrier = new Promise((resolve) => {
        finishRename = resolve;
    });
    const timer = {
        cancelled: false,
        run: undefined,
        unref() {
            return this;
        },
    };
    const { Collectibles } = await load("src/util/util/Collectibles.ts", directory, {
        lifecycle,
        env: {
            COLLECTIBLES_EXTERNAL_REFRESH: "true",
            COLLECTIBLES_CATALOG_URL: "https://fixture.invalid/catalog.json",
        },
        fetch: async () => {
            downloads++;
            return { ok: true, text: async () => JSON.stringify(next) };
        },
        fs: {
            ...fs,
            rename: async (...args) => {
                renameStarted();
                await barrier;
                await fs.rename(...args);
            },
        },
        setInterval: (run) => {
            timer.run = run;
            return timer;
        },
        clearInterval: (value) => {
            if (value) value.cancelled = true;
        },
    });
    await Collectibles.get();
    timer.run();
    await reachedRename;
    let drained = false;
    const stopping = Promise.all(lifecycle.listeners("stopping").map((listener) => listener())).then(() => {
        drained = true;
    });
    await new Promise(setImmediate);
    assert.equal(timer.cancelled, true);
    assert.equal(drained, false);
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, "collectibles.json"), "utf8"))[0].name, category.name);
    finishRename();
    await stopping;
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, "collectibles.json"), "utf8"))[0].name, "Updated fixture pack");
    await Collectibles.refresh();
    timer.run();
    await new Promise(setImmediate);
    assert.equal(downloads, 1);
    const restarted = await load("src/util/util/Collectibles.ts", directory);
    assert.equal((await restarted.Collectibles.get()).categories[0].name, "Updated fixture pack");
});

test("catalog refresh cannot start after shutdown while cached free items remain available", async (t) => {
    const directory = await fixture(t);
    await fs.writeFile(path.join(directory, "collectibles.json"), JSON.stringify([category]));
    const lifecycle = new (require("node:events").EventEmitter)();
    let downloads = 0;
    const { Collectibles } = await load("src/util/util/Collectibles.ts", directory, {
        lifecycle,
        env: {
            COLLECTIBLES_EXTERNAL_REFRESH: "true",
            COLLECTIBLES_CATALOG_URL: "https://fixture.invalid/catalog.json",
        },
        fetch: async () => {
            downloads++;
            throw Error("must remain offline");
        },
    });
    await Promise.all(lifecycle.listeners("stopping").map((listener) => listener()));
    assert.equal((await Collectibles.refresh()).ok, false);
    const saved = await Collectibles.get();
    assert.equal(saved.categories[0].products[0].prices[0].country_prices.prices[0].amount, 0);
    assert.equal(downloads, 0);
});

test("catalog shutdown waits for an initial custom-pack read before cleanup", async (t) => {
    const directory = await fixture(t);
    await fs.writeFile(path.join(directory, "collectibles.json"), JSON.stringify([category]));
    const lifecycle = new (require("node:events").EventEmitter)();
    const { Collectibles } = await load("src/util/util/Collectibles.ts", directory, { lifecycle });
    let finish;
    let entered;
    const reachedCustom = new Promise((resolve) => {
        entered = resolve;
    });
    Collectibles.setCustomSource(
        () =>
            new Promise((resolve) => {
                finish = resolve;
                entered();
            }),
    );
    const pending = Collectibles.get();
    await reachedCustom;
    let drained = false;
    const stopping = Promise.all(lifecycle.listeners("stopping").map((listener) => listener())).then(() => {
        drained = true;
    });
    await new Promise(setImmediate);
    assert.equal(drained, false);
    finish({ categories: [], hidden: [] });
    await stopping;
    assert.equal((await pending).categories[0].sku_id, category.sku_id);
});

test("burst palettes bound blocked dependency jobs and preserve coalescing before resumed admission", async (t) => {
    const directory = await fixture(t);
    const blocked = [];
    const { getBurstColors } = await load("src/api/util/utility/BurstColors.ts", directory, {
        fs: { ...fs, readFile: () => new Promise((_resolve, reject) => blocked.push(reject)) },
    });
    const admitted = Array.from({ length: 32 }, (_, index) => getBurstColors({ name: String.fromCodePoint(0x1f300 + index) }));
    const repeat = getBurstColors({ name: String.fromCodePoint(0x1f300) });
    const overflow = await Promise.all(Array.from({ length: 1025 }, (_, index) => getBurstColors({ name: String.fromCodePoint(0x2000 + index) })));
    assert.equal(blocked.length, 32);
    assert.ok(overflow.every((colors) => colors.length === 2 && colors.every((color) => /^#[a-f0-9]{6}$/i.test(color))));
    blocked.forEach((reject) => reject(Error("Owned dependency failed")));
    const colors = await Promise.all([...admitted, repeat]);
    assert.deepEqual(colors[0], colors[32]);
    const resumed = getBurstColors({ name: String.fromCodePoint(0x2000) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(blocked.length, 33);
    blocked[32](Error("Owned resumed dependency failed"));
    assert.equal((await resumed).length, 2);
});

test("burst cache eviction preserves pending keys among completed least-recently-used entries", async (t) => {
    const directory = await fixture(t);
    let release;
    let reads = 0;
    const { getBurstColors } = await load("src/api/util/utility/BurstColors.ts", directory, {
        fs: {
            ...fs,
            readFile: (file) => {
                reads++;
                if (file.endsWith("/1f300.png")) return new Promise((_resolve, reject) => (release = reject));
                throw Error("Owned completed miss");
            },
        },
    });
    const pending = getBurstColors({ name: String.fromCodePoint(0x1f300) });
    for (let index = 1; index <= 1025; index++) await getBurstColors({ name: String.fromCodePoint(0x1f300 + index) });
    const repeated = getBurstColors({ name: String.fromCodePoint(0x1f300) });
    assert.equal(reads, 1026);
    release(Error("Owned pending miss"));
    assert.deepEqual(await repeated, await pending);
});

test("burst admission snapshots caller emoji fields before deferred dependency work", async (t) => {
    const directory = await fixture(t);
    const urls = [];
    const { getBurstColors } = await load("src/api/util/utility/BurstColors.ts", directory, {
        fetch: async (url) => {
            urls.push(url);
            return { ok: false };
        },
    });
    const emoji = { id: "123", name: "owned" };
    const result = getBurstColors(emoji);
    emoji.id = "456";
    emoji.name = "changed";
    await result;
    assert.deepEqual(urls, ["http://local-cdn/emojis/123.png?size=64"]);
});

test("burst palette input rejection bypasses decoding and shares strict limits across both source types", async (t) => {
    const directory = await fixture(t);
    const admissions = [];
    let decoded = 0;
    const { getBurstColors } = await load("src/api/util/utility/BurstColors.ts", directory, {
        imageRequest: {
            fetchBrandAsset: async (_url, _requireImageType, limits) => {
                admissions.push(limits);
                return { data: Buffer.from("remote"), type: "image/png" };
            },
            readBrandAssetFile: async (_file, limits) => {
                admissions.push(limits);
                return Buffer.from("local");
            },
            withinBrandImageLimits: (_data, limits) => {
                admissions.push(limits);
                return false;
            },
        },
        jimp: {
            Jimp: {
                read: async () => {
                    decoded++;
                    throw Error("Rejected image reached decoder");
                },
            },
        },
    });
    for (const emoji of [{ id: "123" }, { name: "❤" }]) assert.equal((await getBurstColors(emoji)).length, 2);
    assert.equal(decoded, 0);
    assert.equal(admissions.length, 4);
    assert.ok(admissions.every((limits) => limits.maxBytes === 1048576 && limits.timeoutMs === 1500 && limits.maxSide === 1024 && limits.maxPixels === 1048576));
});

const steamCatalog = {
    apps: { 730: "Counter-Strike 2" },
    frames: [
        { defid: 78765, appid: 730, name: "Akihabara Accept", animated: false, image: `${"a".repeat(40)}.png`, still: `${"a".repeat(40)}.png`, created: 1716924160 },
        { defid: 4104245, appid: 795040, name: "Pumping", animated: true, image: `${"b".repeat(40)}.png`, still: `${"c".repeat(40)}.png`, created: 1792429454 },
    ],
};

test("the steam frames are listed after the mirrored packs, work without a mirrored catalog and sort by their steam dates", async (t) => {
    const directory = await fixture(t);
    await fs.writeFile(path.join(directory, "steam-frames.json"), JSON.stringify(steamCatalog));
    const steamFrames = await load("src/util/util/SteamFrames.ts", directory);
    const alone = await load("src/util/util/Collectibles.ts", directory, { steamFrames });
    alone.Collectibles.setCustomSource(async () => ({ categories: [], hidden: [] }));
    assert.deepEqual(
        Array.from(await alone.Collectibles.categories(), (x) => [x.name, x.products.length]),
        [["Steam", 2]],
    );

    await fs.writeFile(path.join(directory, "collectibles.json"), JSON.stringify([category]));
    const { Collectibles } = await load("src/util/util/Collectibles.ts", directory, { steamFrames });
    Collectibles.setCustomSource(async () => ({ categories: [], hidden: [] }));
    assert.deepEqual(
        Array.from(await Collectibles.categories(), (x) => x.name),
        ["Test instance pack", "Steam"],
    );
    const pumping = await Collectibles.product("8000000000004104245");
    assert.equal(pumping.name, "Pumping");
    assert.equal(pumping.summary, "An avatar frame from Steam.");
    assert.equal(pumping.prices["0"].country_prices.prices[0].amount, 0);
    assert.match((await Collectibles.item("8000000000004104245", 0)).asset, /^a_[0-9a-f]{32}$/);
    assert.match((await Collectibles.item("8000000000000078765", 0)).asset, /^[0-9a-f]{32}$/);
    assert.deepEqual(Array.from(await Collectibles.grantable("8000000000004104245")), ["8000000000004104245"]);
    assert.deepEqual(Array.from((await Collectibles.search({ search: "counter-strike" })).skus), ["8000000000000078765"]);
    assert.deepEqual(Array.from((await Collectibles.search({ sort_type: "recency", item_types: ["AVATAR_DECORATION"] })).skus), [
        "8000000000004104245",
        "8000000000000078765",
        "11",
    ]);
    Collectibles.setCustomSource(async () => ({ categories: [], hidden: ["8000000000000000000"] }));
    assert.deepEqual(
        Array.from(await Collectibles.categories(), (x) => x.name),
        ["Test instance pack"],
    );
    assert.equal((await Collectibles.product("8000000000004104245")).name, "Pumping");
});
