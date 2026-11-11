const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const walk = (dir) =>
    fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(rel) : [rel];
    });

test("the pride plugin cannot be turned off by users", () => {
    const plugin = read("client/plugins/fosscordPride/index.tsx");
    assert.match(plugin, /required:\s*true/);
    assert.doesNotMatch(read("client/vencord.json"), /fosscordPride[^\n]*enabled"?\s*:\s*false/i);
});

test("no config, env or admin setting can disable pride badges", () => {
    const sources = [...walk("src/util/config"), ...walk("src/api/routes/admin"), "assets/public/admin/admin.js", ".env.example"].filter((file) =>
        fs.existsSync(path.join(root, file)),
    );
    for (const file of sources) {
        const text = read(file);
        assert.doesNotMatch(text, /(disable|hide|enable|allow|show)[_\s-]?pride|pride[_\s-]?(enabled|disabled|hidden|toggle|off)/i, `${file} has a switch for pride badges`);
    }
    assert.doesNotMatch(read("src/api/util/utility/prideBadges.ts"), /Config\.get\(\)|process\.env/, "the pride catalog must not depend on config or environment");
});

test("the catalog is never empty and never has heterosexual or cisgender flags", () => {
    const catalog = read("src/api/util/utility/prideBadges.ts");
    assert.ok((catalog.match(/slug:\s*"/g) ?? []).length >= 49);
    assert.doesNotMatch(catalog, /slug:\s*"(heterosexual|hetero|straight|cisgender|cis)"/i);
});

test("flags can always be picked at signup", () => {
    assert.ok(fs.existsSync(path.join(root, "src/api/routes/auth/pride-badges.ts")), "the signup flag catalog route must exist");
    assert.match(read("client/plugins/fosscordPride/index.tsx"), /signup/, "the pride plugin must load the signup picker");
    assert.match(read("src/schemas/uncategorised/RegisterSchema.ts"), /pride_badges/, "register must accept pride badges");
});
