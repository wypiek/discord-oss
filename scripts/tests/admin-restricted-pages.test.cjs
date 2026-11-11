const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");

const admin = fs.readFileSync("assets/public/admin/admin.js", "utf8");
const index = fs.readFileSync("assets/public/admin/index.html", "utf8");
const overview = fs.readFileSync("src/api/routes/admin/index.ts", "utf8");

test("a direct link to a page you can't open names the right it needs", () => {
    const serverRights = Object.fromEntries([...overview.matchAll(/^\s+(\w+): rights\.has\("(\w+)"\),$/gm)].map(([, key, right]) => [key, right]));
    const block = admin.match(/const ACCESS_RIGHTS = \{([^}]+)\}/)[1];
    const clientRights = Object.fromEntries([...block.matchAll(/(\w+): "(\w+)"/g)].map(([, key, right]) => [key, right]));
    const navAccess = new Set([...index.matchAll(/data-access="(\w+)"/g)].map(([, key]) => key));
    for (const key of navAccess) {
        assert.ok(serverRights[key], `the overview route reports ${key}`);
        assert.equal(clientRights[key], serverRights[key], key);
    }
    assert.match(admin, /if \(!TABS\[tab\] \|\| !link\) tab = "overview";/);
    assert.match(admin, /const blocked = TABS\[tab\] && link\?\.dataset\.access && !state\.overview\.access\[link\.dataset\.access\] \? link : null;/);
    assert.match(admin, /Only the instance operator can open \$\{page\}/);
    assert.match(admin, /\$\{page\} needs the "\$\{label\}" right, which none of your staff roles has/);
});

test("the mobile layout keeps the sidebar at its content height on short pages", () => {
    const css = fs.readFileSync("assets/public/admin/admin.css", "utf8");
    assert.match(css, /\.app \{\n {4}grid-template-columns: 1fr;\n {4}grid-template-rows: auto 1fr;/);
});
