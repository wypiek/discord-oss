const fs = require("node:fs"),
    vm = require("node:vm"),
    ts = require("typescript"),
    assert = require("node:assert/strict");
function load(file) {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
            },
        }).outputText,
        {
            module,
            exports: module.exports,
            Buffer,
            AbortSignal,
            process: { env: {}, pid: process.pid },
            console,
            setInterval,
            require(id) {
                if (id === "./Constants") return { ASSETS_FOLDER: "/tmp" };
                if (id === "./Config") return { Config: { get: () => ({ cdn: { endpointPublic: "http://local" } }) } };
                if (id === "./Branding") return { instanceName: () => "Local" };
                return require(id);
            },
        },
    );
    return module.exports.Collectibles;
}
const categories = Array.from({ length: 100 }, (_, i) => ({
    sku_id: String(i + 1),
    name: "Pack " + i,
    products: [],
}));
for (let i = 0; i < 100000; i++)
    categories[i % 100].products.push({
        sku_id: String(100000000000000000n + BigInt(i)),
        type: i % 4,
        name: "Decoration " + (100000 - i),
        summary: "Decorative artwork " + i,
        items: [{ label: "Image label " + i, type: i % 4 }],
        is_first_party: i % 5 !== 0,
    });
const snapshot = { categories, products: new Map(), items: new Map() };
const options = [
    { sort_type: "recency", limit: 50 },
    { search: "artwork 123", sort_type: "relevance", limit: 50 },
    { item_types: ["NAMEPLATE"], sort_type: "alphabetical", first_party: false, limit: 50 },
    { sort_type: "popularity", sort_direction: "asc", offset: 100, limit: 50 },
];
async function run(file) {
    const c = load(file);
    c.get = () => Promise.resolve(snapshot);
    const results = [];
    for (const option of options) {
        const coldStart = performance.now();
        const expected = await c.search(option);
        const first_ms = performance.now() - coldStart;
        const times = [];
        for (let i = 0; i < 5; i++) {
            const start = performance.now();
            assert.deepEqual(await c.search(option), expected);
            times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        results.push({
            options: option,
            first_ms,
            median_ms: times[2],
            result: JSON.parse(JSON.stringify(expected)),
        });
    }
    return results;
}
(async () => {
    const results = await run(process.argv[2] || "src/util/util/Collectibles.ts");
    console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
