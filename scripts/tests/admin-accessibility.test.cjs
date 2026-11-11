const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");

const css = fs.readFileSync("assets/public/admin/admin.css", "utf8");
const admin = fs.readFileSync("assets/public/admin/admin.js", "utf8");
const guild = fs.readFileSync("assets/public/admin/guild-admin.js", "utf8");

test("the dashboard writes headings and table headers in sentence case", () => {
    assert.doesNotMatch(css, /text-transform:\s*uppercase/);
});

test("inputs without a visible label carry an accessible name", () => {
    assert.match(admin, /<select data-status style="width:auto" aria-label="Status of \$\{c\.name\}">/);
    assert.match(admin, /<input name="name" aria-label="Component name"/);
    assert.match(admin, /<input name="description" aria-label="Component description"/);
    assert.match(admin, /id="feature-input" aria-label="Feature flag"/);
});

test("repeated row buttons name the row they act on", () => {
    assert.match(guild, /aria-label="Revoke invite \$\{invite\.code\}">Revoke invite<\/button>/);
    assert.match(guild, /aria-label="Lift ban on \$\{userName\(ban\.user\)\}">Lift ban<\/button>/);
});

test("table rows open with Enter or Space and keep focus visible", () => {
    assert.match(admin, /row\.tabIndex = 0;/);
    assert.match(admin, /event\.key !== "Enter" && event\.key !== " "/);
    assert.match(css, /tbody tr\[tabindex\]:focus-visible/);
    assert.match(css, /\.table-wrap \{\n {2}overflow-x: auto;/);
});
