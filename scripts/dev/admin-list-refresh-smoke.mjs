import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { chromiumPath } from "../util/chromium.cjs";

const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const origin = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3413}`;
assert.ok(["localhost", "127.0.0.1", "fosscord.localhost"].includes(new URL(origin).hostname));
assert.ok(process.env.TEST_ACCOUNT_PATH, "Provide the isolated seeded account file");
const account = Object.fromEntries(
    readFileSync(process.env.TEST_ACCOUNT_PATH, "utf8")
        .trim()
        .split("\n")
        .map((line) => {
            const at = line.indexOf("=");
            return [line.slice(0, at), line.slice(at + 1)];
        }),
);
assert.ok(account.TEST_EMAIL && account.TEST_PASSWORD);
const browserName = process.env.BROWSER || "chromium";
assert.ok(["chromium", "webkit"].includes(browserName));
const browser = await playwright[browserName].launch(
    browserName === "chromium"
        ? {
              executablePath: chromiumPath(),
              headless: true,
          }
        : { headless: true },
);
const errors = [];
try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/admin`);
    await page.locator('#login-form input[name="login"]').fill(account.TEST_EMAIL);
    await page.locator('#login-form input[name="password"]').fill(account.TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.locator("#nav-search").waitFor();
    const query = "list-refresh-no-match-fixture";
    let interceptPath;
    let pending;
    let release;
    let held;
    await page.route("**/api/v9/admin/**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === "GET" && url.pathname === interceptPath && url.searchParams.get("q") === query) {
            interceptPath = undefined;
            held();
            await pending;
            await route.fulfill({
                status: 503,
                contentType: "application/json",
                body: '{"message":"Fixture refresh failure"}',
            });
        } else await route.continue();
    });
    for (const kind of ["users", "guilds"]) {
        await page.locator(`#nav a[data-tab="${kind}"]`).click();
        const prefix = kind === "users" ? "user" : "guild";
        const results = page.locator(`#${prefix}-results`);
        const rows = results.locator("tbody tr");
        await rows.first().waitFor();
        await page.waitForFunction((id) => document.getElementById(id).getAttribute("aria-busy") === "false", `${prefix}-results`);
        await results.evaluate((results) => {
            window.retainedRows = Array.from(results.querySelectorAll("tbody tr"));
        });
        interceptPath = `/api/v9/admin/${kind}`;
        pending = new Promise((resolve) => (release = resolve));
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The refresh request was not intercepted")), 10000);
            held = () => {
                clearTimeout(timer);
                resolve();
            };
        });
        const failure = page.waitForResponse((response) => response.status() === 503 && new URL(response.url()).pathname === `/api/v9/admin/${kind}`);
        await page.locator(`#${prefix}-search`).fill(query);
        await intercepted;
        assert.equal(await results.getAttribute("aria-busy"), "true");
        assert.equal(
            await results.evaluate((results) => {
                const rows = Array.from(results.querySelectorAll("tbody tr"));
                return rows.length === window.retainedRows.length && rows.every((row, index) => row === window.retainedRows[index]);
            }),
            true,
        );
        release();
        await failure;
        const retry = page.getByRole("button", { name: "Retry search", exact: true });
        await retry.waitFor();
        assert.equal(
            await results.evaluate((results) => {
                const rows = Array.from(results.querySelectorAll("tbody tr"));
                return rows.length === window.retainedRows.length && rows.every((row, index) => row === window.retainedRows[index]);
            }),
            true,
        );
        assert.equal(await results.getAttribute("aria-busy"), "false");
        const success = page.waitForResponse(
            (response) => response.status() === 200 && new URL(response.url()).pathname === `/api/v9/admin/${kind}` && new URL(response.url()).searchParams.get("q") === query,
        );
        await retry.click();
        await success;
        await results.locator(".empty").waitFor();
        assert.match(await results.textContent(), /No (users|servers) match/);
        assert.equal(await results.getAttribute("aria-busy"), "false");
    }
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeAdminSignin: true,
            userAndServerRowsRetainedWhilePending: true,
            rowsRetainedAfter503Fixture: true,
            actual200Retry: true,
        }),
    );
} finally {
    await browser.close();
}
