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
    await context.addInitScript((token) => localStorage.setItem("admin_token", token), token);
    const page = await context.newPage();
    const errors = [];
    const canceled = [];
    const queries = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname === "/api/v9/admin/guilds") queries.push(url.searchParams.get("q"));
    });
    page.on("requestfailed", (request) => canceled.push(new URL(request.url()).searchParams.get("q")));
    await page.goto(`${origin}/admin/#/users`);
    await page.locator("#user-results tbody tr").first().waitFor();
    await page.getByLabel("Find users", { exact: true }).waitFor();
    await page.getByLabel("Filter users", { exact: true }).waitFor();
    let fail = true;
    const holds = new Map();
    await page.route("**/api/v9/admin/users?**", async (route) => {
        const url = new URL(route.request().url());
        const q = url.searchParams.get("q");
        const offset = Number(url.searchParams.get("offset"));
        queries.push(q);
        if (q === "slow-old" || q === "leave-tab") await new Promise((resolve) => holds.set(q, resolve));
        if (q === "retry" && fail) {
            fail = false;
            await route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({ message: "Unavailable" }),
            });
            return;
        }
        await route
            .fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    total: 120,
                    users: [
                        {
                            id: "123456789012345678",
                            username: `Result ${q} ${offset}`,
                            discriminator: "0",
                            rights: "0",
                            verified: true,
                            created_at: "2026-01-01",
                        },
                    ],
                }),
            })
            .catch(() => {});
    });
    await page.getByLabel("Find users", { exact: true }).fill("slow-old");
    await page.waitForRequest((request) => new URL(request.url()).searchParams.get("q") === "slow-old");
    await page.getByLabel("Find users", { exact: true }).fill("newest");
    await page.getByText("Result newest 0", { exact: true }).waitFor();
    holds.get("slow-old")();
    await page.waitForFunction(() => document.querySelector("#user-results").getAttribute("aria-busy") === "false");
    assert.equal(await page.getByText("Result slow-old 0", { exact: true }).count(), 0);
    assert(canceled.includes("slow-old"), "old search network request was canceled");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByText("Result newest 50", { exact: true }).waitFor();
    await page.getByLabel("Filter users", { exact: true }).selectOption("bots");
    await page.getByText("Result newest 0", { exact: true }).waitFor();
    await page.getByLabel("Find users", { exact: true }).fill("retry");
    await page.getByRole("button", { name: "Retry search", exact: true }).waitFor();
    assert.equal(await page.getByText("Result newest 0", { exact: true }).isVisible(), true);
    await page.getByRole("button", { name: "Retry search", exact: true }).click();
    await page.getByText("Result retry 0", { exact: true }).waitFor();
    console.log("PASS latest search cancellation, paging/filter reset, retained rows and error retry");
    await page.getByLabel("Find users", { exact: true }).fill("leave-tab");
    await page.waitForRequest((request) => new URL(request.url()).searchParams.get("q") === "leave-tab");
    await page.locator("#nav a[data-tab=guilds]").click();
    await page.locator("#guild-results table, #guild-results .empty").waitFor();
    holds.get("leave-tab")();
    assert(canceled.includes("leave-tab"), "navigation canceled previous tab request");
    await page.route("**/api/v9/admin/guilds?**", async (route) => {
        const q = new URL(route.request().url()).searchParams.get("q");
        if (q === "server-old") await new Promise((resolve) => holds.set(q, resolve));
        await route
            .fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    total: 1,
                    guilds: [{ id: "123456789012345679", name: `Server ${q}`, features: [], member_count: 2 }],
                }),
            })
            .catch(() => {});
    });
    await page.getByLabel("Find servers", { exact: true }).fill("server-old");
    await page.waitForRequest((request) => new URL(request.url()).searchParams.get("q") === "server-old");
    await page.getByLabel("Find servers", { exact: true }).fill("server-newest");
    await page.getByText("Server server-newest", { exact: true }).waitFor();
    holds.get("server-old")();
    assert(canceled.includes("server-old"), "old server search was canceled");
    assert.equal(await page.getByText("Server server-old", { exact: true }).count(), 0);
    console.log("PASS server search cancels stale requests");
    await page.getByLabel("Find servers", { exact: true }).fill("pending-debounce");
    await page.locator("#nav a[data-tab=overview]").click();
    await page.getByRole("heading", { name: "Instance", exact: true }).waitFor();
    await page.waitForTimeout(350);
    assert.equal(queries.includes("pending-debounce"), false);
    await page.getByLabel("Find a section").fill("Shop");
    await page.evaluate(() => (location.hash = "#/users"));
    await page.getByRole("heading", { name: "Users", exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, "#/users", "navigation filtering does not revoke route access");
    await page.getByLabel("Find a section").fill("");
    await page.getByLabel("Find users", { exact: true }).fill("newest");
    await page.getByText("Result newest 0", { exact: true }).waitFor();
    await page.screenshot({ path: "/tmp/fosscord-admin-search-desktop.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "/tmp/fosscord-admin-search-mobile.png", fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log("PASS tab cancellation, delayed callbacks, filtered navigation and desktop/mobile render");
} finally {
    await browser.close();
}
