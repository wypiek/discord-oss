import assert from "node:assert/strict";
import { test } from "node:test";
import { discordAccountName } from "./accountName";

test("accounts on the new username system are named by username alone", () => {
    assert.equal(discordAccountName({ username: "m5rcel", discriminator: "0" }), "m5rcel");
    assert.equal(discordAccountName({ username: "m5rcel", discriminator: null }), "m5rcel");
});

test("legacy accounts keep their discriminator", () => {
    assert.equal(discordAccountName({ username: "Clyde", discriminator: "0042" }), "Clyde#0042");
});
