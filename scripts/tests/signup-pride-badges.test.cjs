const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const load = (file, imports = {}) => {
    const module = { exports: {} };
    const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(js, {
        module,
        exports: module.exports,
        require: (name) => {
            if (!(name in imports)) throw Error(name);
            return imports[name];
        },
    });
    return module.exports;
};
const catalog = load("src/api/util/utility/prideBadges.ts");
const selection = load("src/api/util/utility/prideBadgeSelection.ts", {
    "@spacebar/api/util/utility/prideBadges": catalog,
    "@spacebar/util": {
        Config: { get: () => ({ cdn: { endpointPublic: "https://cdn.example.invalid/" } }) },
    },
});

test("signup selections accept catalog slugs up to the profile picker maximum", () => {
    assert.equal(selection.isPrideBadgeSelection([]), true);
    assert.equal(selection.isPrideBadgeSelection(["rainbow", "transgender", "rainbow"]), true);
    assert.equal(selection.isPrideBadgeSelection(catalog.PRIDE_BADGES.map((badge) => badge.slug)), true);
});

test("signup selections reject unknown slugs, badge IDs, wrong types and oversized arrays", () => {
    for (const flags of [["operator"], ["not-a-flag"], [catalog.PRIDE_BADGES[0].id], [null], [1], "rainbow", null, {}, Array(catalog.PRIDE_BADGES.length + 1).fill("rainbow")]) {
        assert.equal(selection.isPrideBadgeSelection(flags), false, JSON.stringify(flags));
    }
});

test("the public catalog lists every flag with its search aliases and CDN icon URL and nothing else", () => {
    const { max_selections, badges } = selection.publicPrideBadges();
    assert.equal(max_selections, catalog.PRIDE_BADGES.length);
    assert.equal(badges.length, catalog.PRIDE_BADGE_CATALOG.length);
    for (const [index, badge] of badges.entries()) {
        const source = catalog.PRIDE_BADGE_CATALOG[index];
        assert.deepEqual(Object.keys(badge).sort(), ["aliases", "description", "icon_url", "id", "slug", "source"]);
        assert.equal(badge.slug, source.slug);
        assert.equal(badge.id, source.id);
        assert.deepEqual(badge.aliases, source.aliases);
        assert.equal(badge.icon_url, `https://cdn.example.invalid/badge-icons/${source.icon}.png`);
    }
});
