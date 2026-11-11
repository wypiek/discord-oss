const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test } = require("node:test");

const admin = fs.readFileSync("assets/public/admin/admin.js", "utf8");

test("page level empty lists explain what belongs there and offer one action", () => {
    const bare = [...admin.matchAll(/<div class="card empty">([^<$]*)/g)].map((match) => match[1].trim()).filter(Boolean);
    assert.deepEqual(bare, ["Results couldn't load. Retry your search."]);
    for (const [text, action] of [
        ["No accounts match this search and filter.", "Clear search and filter"],
        ["No servers match this search. Search by name or ID.", "Clear search"],
        ["No address bans match this search and filter.", "Show all address bans"],
        ["No invites match this search and filter.", "Show all invites"],
        ["No open reports. Reports people send from the client's Report menus show up here.", "Show all reports"],
        ["No badges yet. Create one with your own icon or a preset, then give it out from a user's page.", "Create badge"],
        ["No custom games yet. Add one so people can put it on their profile or server.", "Add game"],
    ])
        assert.ok(admin.includes(`emptyCard("${text}", "${action}")`), text);
});

test("every empty state action is bound where the card is rendered", () => {
    const cards = admin.match(/emptyCard\("[^"]+", "[^"]+"\)/g).length;
    assert.ok(cards >= 15);
    assert.ok(admin.match(/\$\("\[data-empty-action\]", (view|results)\)\?\.addEventListener\("click"/g).length >= 11);
});
