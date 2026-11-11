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
try {
    const context = await browser.newContext();
    let page = await context.newPage();
    const errors = [];
    const loginErrors = [];
    page.on("pageerror", (error) => loginErrors.push(error.message));
    await page.goto(`${origin}/login`);
    await page.locator('input[name="email"]').fill(account.TEST_EMAIL);
    await page.locator('input[name="password"]').fill(account.TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/channels/@me");
    await page.close();
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/developers/applications`);
    const opener = page.getByRole("button", { name: "New application", exact: true });
    await opener.waitFor();
    await page.evaluate(() => {
        document.body.style.minHeight = "5000px";
        scrollTo(0, 400);
    });
    await opener.evaluate((element) => element.click());
    const modal = page.locator("dialog:modal");
    await modal.waitFor();
    const before = await page.evaluate(() => scrollY);
    await page.mouse.move(4, 4);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => scrollY), before);
    if (process.env.PORTAL_SCROLL_SCREENSHOT) await page.screenshot({ path: process.env.PORTAL_SCROLL_SCREENSHOT });
    await page.keyboard.press("Escape");
    await modal.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => scrollY), before);
    await page.mouse.wheel(0, 500);
    await page.waitForFunction((before) => scrollY > before, before);
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeSignin: true,
            nativeCreateDialog: true,
            backgroundScrollLocked: true,
            scrollRestored: true,
            loginPageErrorCount: loginErrors.length,
        }),
    );
} finally {
    await browser.close();
}
