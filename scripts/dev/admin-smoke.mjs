import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { chromiumPath } from "../util/chromium.cjs";
const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");
const origin = `http://fosscord.localhost:${process.env.PORT || 3290}`;
const account = Object.fromEntries(
    readFileSync(new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
);
const login = await fetch(`${origin}/api/v9/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: account.TEST_EMAIL, password: account.TEST_PASSWORD }),
});
assert.equal(login.status, 200);
const { token } = await login.json();
const browser = await chromium.launch({
    executablePath: chromiumPath(),
    headless: true,
});
try {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        colorScheme: "dark",
    });
    await context.addInitScript((token) => localStorage.setItem("token", JSON.stringify(token)), token);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/admin/#/overview`);
    await page.getByRole("heading", { name: "Instance", exact: true }).waitFor();
    for (const [tab, heading] of [
        ["settings", "Site settings"],
        ["users", "Users"],
        ["guilds", "Servers"],
        ["store", "Store"],
        ["performance", "Performance"],
        ["system", "System"],
    ]) {
        await page.locator(`#nav a[data-tab=${tab}]`).click();
        await page.getByRole("heading", { name: heading, exact: true }).first().waitFor();
        console.log(`PASS dashboard ${tab}`);
    }
    await page.locator("#nav a[data-tab=users]").click();
    await page.locator("#user-results tbody tr").first().click();
    await page.locator("#user-form").waitFor();
    assert.equal(await page.locator("[data-cosmetic-search]").count(), 4);
    await page.locator("#user-form input[name=pronouns]").fill("browser check");
    const rejectDiscard = (dialog) => dialog.dismiss();
    page.on("dialog", rejectDiscard);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(await page.locator("#drawer").isVisible(), true);
    page.off("dialog", rejectDiscard);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator("#user-results tbody tr").first().click();
    await page.locator("#user-form").waitFor();
    const saveUser = page.waitForResponse((r) => r.url().includes("/admin/users/") && r.request().method() === "PATCH");
    await page.getByRole("button", { name: "Save user", exact: true }).click();
    assert.equal((await saveUser).status(), 200);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.locator("#nav a[data-tab=guilds]").click();
    await page.locator("#guild-results tbody tr").first().click();
    await page.locator("#guild-form").waitFor();
    await page.locator("#server-resources summary").click();
    await page.locator("[data-edit-channel]").first().waitFor();
    await page.locator("[data-edit-channel]").first().click();
    await page.locator("#admin-channel-form").waitFor();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    console.log("PASS profile save, cosmetic selectors, dirty drawer protection and channel editor");
    await page.locator("#nav a[data-tab=performance]").click();
    await page.getByRole("heading", { name: "Slowest routes" }).waitFor();
    await page.screenshot({ path: "/tmp/fosscord-performance-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/fosscord-performance-mobile.png", fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, "mobile document overflow");
    assert.deepEqual(errors, []);
    console.log("PASS desktop/mobile dashboard render, no page errors");
} finally {
    await browser.close();
}
