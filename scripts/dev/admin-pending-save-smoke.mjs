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
    let pending;
    let held;
    let release;
    await page.route("**/api/v9/admin/**", async (route) => {
        if (route.request().method() === "PATCH" && pending) {
            held();
            await pending;
        }
        await route.continue();
    });
    const startHold = () => {
        pending = new Promise((resolve) => (release = resolve));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The pending save request was not intercepted")), 10000);
            held = () => {
                clearTimeout(timer);
                resolve();
            };
        });
    };
    const openEditor = async (kind) => {
        await page.locator(`#nav a[data-tab="${kind === "user" ? "users" : "guilds"}"]`).click();
        const rows = page.locator(kind === "user" ? "#user-results tbody tr" : "#guild-results tbody tr");
        const row = kind === "user" ? rows.filter({ hasText: "tester" }).first() : rows.first();
        await row.waitFor();
        await row.click();
        const form = page.locator(kind === "user" ? "#user-form" : "#guild-form");
        await form.waitFor();
        return form;
    };
    const confirmAction = async (action, accept) => {
        const confirmation = page.waitForEvent("dialog");
        const result = action();
        const dialog = await confirmation;
        assert.equal(dialog.type(), "confirm");
        if (accept) await dialog.accept();
        else await dialog.dismiss();
        await result;
    };
    const restores = [];
    for (const kind of ["user", "guild"]) {
        const form = await openEditor(kind);
        const input = form.locator(kind === "user" ? 'input[name="pronouns"]' : 'input[name="name"]');
        const originalValue = await input.inputValue();
        await input.fill("Saved fixture");
        const requestHeld = startHold();
        await form.evaluate((form) => {
            window.pendingSaveForm = form;
            window.pendingSaveButton = form.querySelector('button[type="submit"]');
        });
        const response = page.waitForResponse(
            (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.startsWith(`/api/v9/admin/${kind === "user" ? "users" : "guilds"}/`),
        );
        await form.locator('button[type="submit"]').click();
        await requestHeld;
        await input.fill("Unsaved fixture");
        release();
        pending = undefined;
        const savedResponse = await response;
        assert.equal(savedResponse.status(), 200);
        restores.push({
            kind,
            value: originalValue,
            path: new URL(savedResponse.url()).pathname.replace(/^\/api\/v9/, ""),
        });
        await page.waitForFunction(() => !window.pendingSaveButton.disabled);
        assert.equal(await input.inputValue(), "Unsaved fixture");
        assert.equal(await form.evaluate((form) => form === window.pendingSaveForm && form.dataset.dirty === "true"), true);
        const hash = await page.evaluate(() => location.hash);
        await confirmAction(
            () =>
                page.evaluate(() => {
                    location.hash = "#/overview";
                }),
            false,
        );
        await page.waitForFunction((hash) => location.hash === hash, hash);
        assert.equal(await input.inputValue(), "Unsaved fixture");
        await confirmAction(() => page.evaluate(() => route()), false);
        assert.equal(await input.inputValue(), "Unsaved fixture");
        const reloadConfirmation = page.waitForEvent("dialog");
        const reload = page.reload({ timeout: 5000 }).then(
            () => true,
            () => false,
        );
        const reloadDialog = await reloadConfirmation;
        assert.equal(reloadDialog.type(), "beforeunload");
        await reloadDialog.dismiss();
        assert.equal(await reload, false);
        assert.equal(await input.inputValue(), "Unsaved fixture");
        await confirmAction(() => page.locator(".drawer-backdrop").click({ position: { x: 4, y: 4 } }), false);
        assert.equal(await form.evaluate((form) => form.dataset.dirty), "true");
        await confirmAction(() => page.getByRole("button", { name: "Close", exact: true }).click(), true);
        await page.locator("#drawer").waitFor({ state: "hidden" });
        const closingForm = await openEditor(kind);
        await closingForm.locator(kind === "user" ? 'input[name="pronouns"]' : 'input[name="name"]').fill("Closed fixture");
        await closingForm.evaluate((form) => {
            window.pendingSaveButton = form.querySelector('button[type="submit"]');
        });
        const closingHeld = startHold();
        const closingResponse = page.waitForResponse(
            (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname.startsWith(`/api/v9/admin/${kind === "user" ? "users" : "guilds"}/`),
        );
        await closingForm.locator('button[type="submit"]').click();
        await closingHeld;
        await confirmAction(() => page.getByRole("button", { name: "Close", exact: true }).click(), true);
        release();
        pending = undefined;
        assert.equal((await closingResponse).status(), 200);
        await page.waitForFunction(() => !window.pendingSaveButton.disabled);
        assert.equal(await page.locator("#drawer").evaluate((drawer) => drawer.hidden), true);
    }
    for (const restore of restores)
        await page.evaluate(
            ({ kind, path, value }) =>
                api(path, {
                    method: "PATCH",
                    body: kind === "user" ? { pronouns: value } : { name: value },
                }),
            restore,
        );
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeAdminSignin: true,
            userAndGuildDraftsPreserved: true,
            navigationRefreshAndBackdropProtected: true,
            closedEditorsStayClosed: true,
        }),
    );
} finally {
    await browser.close();
}
