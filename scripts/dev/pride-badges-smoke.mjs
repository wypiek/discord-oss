import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromiumPath } from "../util/chromium.cjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "package.json"));
const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const account = require("node:util").parseEnv(String(readFileSync(process.env.TEST_ACCOUNT_FILE || path.join(root, "scripts/dev/.test-account"))));
const origin = (process.env.ORIGIN || "http://fosscord.localhost:3290").replace(/\/$/, "");
const login = async (login, password) => {
    const response = await fetch(`${origin}/api/v9/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login, password }),
    });
    assert.equal(response.status, 200, "fixture login");
    return response.json();
};
const [self, friend] = await Promise.all([login(account.TEST_EMAIL, account.TEST_PASSWORD), login("friend@fosscord.test", account.FRIEND_PASSWORD)]);
const api = async (method, route, body) => {
    const response = await fetch(`${origin}/api/v9${route}`, {
        method,
        headers: { authorization: self.token, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(response.status, 200, `${method} ${route}`);
    return response.json();
};
const before = await api("GET", "/users/@me/pride-badges");
const profile = await api("GET", "/users/@me/profile");
const catalogIds = new Set(before.catalog.map((badge) => badge.id));
const assigned = profile.badges.filter((badge) => !catalogIds.has(badge.id));
const manifest = JSON.parse(readFileSync(path.join(root, "assets/badge-icons/twemoji-flags/manifest.json")));
const count = manifest.flags.length + manifest.supplementalSlugs.length;
assert.equal(before.catalog.length, count);
assert.equal(before.catalog.filter((badge) => badge.source === "twemoji-flags").length, manifest.flags.length);
const browser = await playwright.chromium.launch({
    executablePath: chromiumPath(),
    headless: true,
});
try {
    const open = async (token) => {
        const context = await browser.newContext();
        await context.addInitScript((value) => localStorage.setItem("token", JSON.stringify(value)), token);
        const page = await context.newPage();
        await page.goto(`${origin}/channels/@me`);
        await page.getByRole("button", { name: "User Settings", exact: true }).waitFor({ timeout: 45000 });
        return page;
    };
    const friendPage = await open(friend.token);
    await friendPage.getByText("All", { exact: true }).first().click();
    await friendPage
        .locator("[class*=peopleListItem]")
        .filter({ hasText: profile.user.global_name || profile.user.username })
        .first()
        .dblclick();
    const page = await open(self.token);
    await page.getByRole("button", { name: "User Settings", exact: true }).click();
    await page.getByText("Edit Profiles", { exact: true }).click();
    const picker = page.getByRole("region", { name: "Pride badges", exact: true });
    await picker.getByRole("checkbox").first().waitFor();
    assert.equal(await picker.getByRole("checkbox").count(), count);
    for (const checkbox of await picker.getByRole("checkbox").all()) await checkbox.check();
    await picker.getByRole("button", { name: "Save pride badges", exact: true }).click();
    await picker.getByText("Pride badges saved.", { exact: true }).waitFor();
    assert.equal((await api("GET", "/users/@me/pride-badges")).flags.length, count);
    const savedProfile = await api("GET", "/users/@me/profile");
    assert.equal(savedProfile.badges.filter((badge) => catalogIds.has(badge.id)).length, count);
    assert.deepEqual(
        savedProfile.badges.filter((badge) => !catalogIds.has(badge.id)),
        assigned,
    );
    await friendPage.waitForFunction(
        ({ id, count }) =>
            Vencord.Webpack.findStore("UserProfileStore")
                .getUserProfile(id)
                ?.badges?.filter((badge) => badge.icon?.startsWith("pride_")).length === count,
        { id: profile.user.id, count },
        { timeout: 15000 },
    );
    const icons = friendPage.locator('img[src*="badge-icons/pride_"]');
    assert.equal(await icons.count(), count, "ordinary friend profile renders every flag");
    assert.ok(await icons.evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), "flag images load locally");
    assert.ok(
        await icons.evaluateAll((images) =>
            images.every((image) => {
                const rect = image.getBoundingClientRect();
                return rect.left >= 0 && rect.right <= innerWidth;
            }),
        ),
        "all badges fit the viewport",
    );
    if (process.env.PRIDE_SMOKE_SCREENSHOT) await friendPage.screenshot({ path: process.env.PRIDE_SMOKE_SCREENSHOT });
    await picker.getByRole("button", { name: "Remove all", exact: true }).click();
    await picker.getByText("Pride badges removed.", { exact: true }).waitFor();
    assert.equal((await api("GET", "/users/@me/pride-badges")).flags.length, 0);
    await friendPage.waitForFunction(
        (id) =>
            Vencord.Webpack.findStore("UserProfileStore")
                .getUserProfile(id)
                ?.badges?.filter((badge) => badge.icon?.startsWith("pride_")).length === 0,
        profile.user.id,
        { timeout: 15000 },
    );
    await picker.getByRole("searchbox", { name: "Search flags", exact: true }).fill("transgender");
    assert.equal(await picker.getByRole("checkbox").count(), 1);
    await picker.getByRole("checkbox", { name: "Transgender", exact: true }).check();
    await picker.getByRole("button", { name: "Save pride badges", exact: true }).click();
    await picker.getByText("Pride badges saved.", { exact: true }).waitFor();
    assert.deepEqual((await api("GET", "/users/@me/pride-badges")).flags, ["transgender"]);
    console.log(
        JSON.stringify({
            catalog: count,
            upstreamFlags: manifest.flags.length,
            selectedAll: count,
            ordinaryProfileImages: count,
            cachedFriendUpdated: true,
            cleared: true,
            searchSubsetSaved: true,
            assignedBadgesPreserved: true,
        }),
    );
} finally {
    await api("PATCH", "/users/@me/pride-badges", { flags: before.flags });
    await browser.close();
}
