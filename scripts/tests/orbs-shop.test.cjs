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

const orbs = (amount) => ({ country_prices: { country_code: "US", prices: [{ amount, currency: "discord_orb", exponent: 0 }] } });
const usd = (amount) => ({ country_prices: { country_code: "US", prices: [{ amount, currency: "usd", exponent: 2 }] } });
const both = { country_prices: { country_code: "US", prices: [usd(499).country_prices.prices[0], orbs(600).country_prices.prices[0]] } };
const decoration = (sku_id, name, prices) => ({ sku_id, name, type: 0, prices: { 0: prices, 4: prices }, items: [{ sku_id, type: 0, asset: `a_${sku_id}` }] });
const mirrored = [
    {
        sku_id: "200",
        name: "Regular pack",
        products: [decoration("201", "Paid", usd(499)), decoration("202", "Either", both)],
    },
    {
        sku_id: "300",
        name: "Orb pack",
        products: [decoration("301", "Orb only", orbs(700)), { sku_id: "1333912750274904064", name: "3-Day Nitro Credit", type: 3000, prices: { 0: orbs(1400) }, items: [] }],
    },
];

test("the Orbs tab lists orb priced products for free and drops Nitro credit", async (t) => {
    const directory = await fixture(t);
    await fs.writeFile(path.join(directory, "collectibles.json"), JSON.stringify(mirrored));
    const { Collectibles, ORB_PROFILE_BADGE_SKU, ORBS_CATEGORY_SKU, CollectibleItemType } = await load("src/util/util/Collectibles.ts", directory);
    Collectibles.setCustomSource(async () => ({ categories: [], hidden: [] }));

    assert.equal(CollectibleItemType.VARIANTS_GROUP, 2000);
    assert.equal(CollectibleItemType.EXTERNAL_SKU, 3000);
    assert.equal(await Collectibles.product("1333912750274904064"), undefined);
    assert.deepEqual(Array.from(await Collectibles.grantable("1333912750274904064")), []);

    const orbOnly = await Collectibles.product("301");
    assert.deepEqual(JSON.parse(JSON.stringify(orbOnly.prices["0"].country_prices.prices)), [{ amount: 0, currency: "discord_orb", exponent: 0 }]);
    assert.equal(orbOnly.hide_badge, false);
    assert.equal((await Collectibles.product("202")).hide_badge, true);

    const badge = await Collectibles.product(ORB_PROFILE_BADGE_SKU);
    assert.equal(badge.type, 3000);
    assert.equal(badge.name, "Orbs Apprentice Badge");
    assert.equal(badge.prices["0"].country_prices.prices[0].currency, "discord_orb");
    assert.deepEqual(Array.from(await Collectibles.grantable(ORB_PROFILE_BADGE_SKU)), [ORB_PROFILE_BADGE_SKU]);

    const tab = await Collectibles.shop("orbs");
    assert.deepEqual(JSON.parse(JSON.stringify(tab.shop_blocks)), [
        { type: 4, name: "Orb pack", category_sku_id: "300", ranked_sku_ids: ["301"], show_button: false },
        { type: 4, name: "Orbs Exclusives", category_sku_id: ORBS_CATEGORY_SKU, ranked_sku_ids: [ORB_PROFILE_BADGE_SKU], show_button: false },
        { type: 2, ranked_sku_ids: ["202"], sorted_sku_ids: { recommended: null, popular: ["202"] } },
    ]);
    assert.deepEqual(
        Array.from(tab.shop_blocks.flatMap((block) => block.ranked_sku_ids)).filter((sku) => sku === "201"),
        [],
    );

    const home = await Collectibles.shop();
    assert.equal(home.shop_blocks[0].category_sku_id, "200");
    assert.deepEqual(Array.from(home.shop_blocks[2].ranked_sku_ids), ["201", "202"]);
    assert.deepEqual(Array.from((await Collectibles.search({ orbs_eligible: true, sort_type: "alphabetical", sort_direction: "asc" })).skus), ["202", "301"]);
});

test("a mirrored Orbs Apprentice badge is not added a second time", async (t) => {
    const directory = await fixture(t);
    const withBadge = [
        {
            sku_id: "400",
            name: "Discord orbs",
            products: [{ sku_id: "1342211853484429445", name: "Orbs Apprentice", type: 3000, prices: { 0: orbs(1200) }, items: [] }],
        },
    ];
    await fs.writeFile(path.join(directory, "collectibles.json"), JSON.stringify(withBadge));
    const { Collectibles } = await load("src/util/util/Collectibles.ts", directory);
    Collectibles.setCustomSource(async () => ({ categories: [], hidden: [] }));
    assert.deepEqual(
        Array.from(await Collectibles.categories(), (pack) => pack.sku_id),
        ["400"],
    );
    assert.equal((await Collectibles.product("1342211853484429445")).prices["0"].country_prices.prices[0].amount, 0);
});
