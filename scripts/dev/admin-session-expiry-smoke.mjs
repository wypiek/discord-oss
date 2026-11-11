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
    const context = await browser.newContext(browserName === "webkit" ? playwright.devices["iPhone 13"] : {});
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/admin`);
    await page.locator('#login-form input[name="login"]').fill(account.TEST_EMAIL);
    await page.locator('#login-form input[name="password"]').fill(account.TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.locator("#nav-search").waitFor();
    await page.locator('#nav a[data-tab="users"]').click();
    const row = page.locator("#user-results tbody tr").filter({ hasText: "tester" }).first();
    await row.waitFor();
    await page.locator("#user-search").focus();
    await page.evaluate(() => {
        document.body.style.setProperty("overflow-x", "clip");
        document.body.style.setProperty("overflow-y", "auto", "important");
    });
    await row.click();
    const drawer = page.locator("#drawer");
    await drawer.waitFor();
    await page.getByRole("heading", { name: "User", exact: true }).waitFor();
    await drawer.locator("#user-form").waitFor();
    const close = drawer.getByRole("button", { name: "Close", exact: true });
    assert.equal(await close.evaluate((element) => element === document.activeElement), true);
    await page.locator('#user-form input[name="pronouns"]').fill("Unsaved expiry fixture");
    let confirmations = 0;
    page.on("dialog", async (dialog) => {
        confirmations++;
        await dialog.dismiss();
    });
    await page.evaluate(() => {
        window.expiredPageRequests = pageRequests;
    });
    await page.evaluate(() => api("/auth/logout", { method: "POST", body: {} }));
    const status = await page.evaluate(async () => {
        try {
            await api("/admin");
            return 200;
        } catch (error) {
            return error.status;
        }
    });
    assert.equal(status, 401);
    assert.equal(confirmations, 0);
    assert.equal(await drawer.evaluate((element) => element.hidden), true);
    assert.equal(await page.locator("#app").evaluate((element) => element.hidden && !element.inert), true);
    assert.equal(await page.locator("#view").textContent(), "");
    assert.equal(await page.locator("#me").textContent(), "");
    assert.equal(await page.locator("#drawer-body").textContent(), "");
    assert.deepEqual(
        await page.evaluate(() => ({
            aborted: expiredPageRequests.signal.aborted,
            current: pageRequests.signal.aborted,
            overview: state.overview,
            me: state.me,
        })),
        {
            aborted: true,
            current: false,
            overview: null,
            me: null,
        },
    );
    assert.deepEqual(
        await page.evaluate(() =>
            ["overflow-x", "overflow-y"].map((property) => [document.body.style.getPropertyValue(property), document.body.style.getPropertyPriority(property)]),
        ),
        [
            ["clip", ""],
            ["auto", "important"],
        ],
    );
    const login = page.locator('#login-form input[name="login"]');
    assert.equal(await login.evaluate((element) => document.activeElement === element), true);
    await login.fill(account.TEST_EMAIL);
    await page.locator('#login-form input[name="password"]').fill(account.TEST_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.locator("#user-results tbody tr").first().waitFor();
    assert.equal(await page.locator("#app").evaluate((element) => !element.hidden && !element.inert), true);
    assert.equal(await drawer.evaluate((element) => element.hidden), true);
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            actualRevokedSession: 401,
            staleDrawerRemoved: true,
            cachedDashboardCleared: true,
            requestsCancelled: true,
            originalScrollRestored: true,
            signinFocused: true,
            originalPasswordSignin: true,
            discardConfirmations: confirmations,
        }),
    );
} finally {
    await browser.close();
}
