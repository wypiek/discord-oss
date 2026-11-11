import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { chromiumPath } from "../util/chromium.cjs";

const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const origin = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3413}`;
assert.ok(["localhost", "127.0.0.1", "fosscord.localhost"].includes(new URL(origin).hostname));
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
    const mobile = browserName === "webkit" && process.env.DESKTOP_SCROLL !== "1";
    const context = await browser.newContext(mobile ? playwright.devices["iPhone 13"] : {});
    const page = await context.newPage();
    page.on("pageerror", (error) => {
        if (!error.message.includes("Sentry successfully disabled")) errors.push(error.message);
    });
    const verification = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/auth/verify"));
    await page.goto(`${origin}/verify?token=synthetic-invalid-focus-fixture`);
    assert.equal((await verification).status(), 400);
    const dialog = page.getByRole("dialog", { name: "Verify email", exact: true });
    await dialog.waitFor();
    const close = dialog.getByRole("button", { name: "Okay", exact: true });
    await close.waitFor();
    assert.equal(await dialog.evaluate((element) => element.tagName === "DIALOG" && element.matches(":modal")), true);
    assert.equal(await close.evaluate((element) => element === document.activeElement), true);
    assert.equal(await page.locator("#fc-native-dialog-scroll").count(), 1);
    await page.evaluate(() => {
        document.body.style.minHeight = "5000px";
        scrollTo(0, 400);
    });
    const scrollPosition = await page.evaluate(() => scrollY);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), "hidden");
    if (!mobile) {
        await page.mouse.move(4, 4);
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(250);
    }
    assert.equal(await page.evaluate(() => scrollY), scrollPosition);
    await page.keyboard.press("Escape");
    assert.equal(await dialog.count(), 1, "Escape does not bypass the required authentication result");
    await page.mouse.click(4, 4);
    assert.equal(await dialog.count(), 1, "Outside clicks do not bypass the required authentication result");
    await page.locator('input[name="email"]').waitFor({ state: "attached", timeout: 60000 });
    await page.locator('input[name="email"]').evaluate((element) => element.focus());
    assert.equal(await page.locator('input[name="email"]').evaluate((element) => element === document.activeElement), false, "The underlying login form remains inert");
    await page.keyboard.press("Tab");
    assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true, "Keyboard navigation returns to the modal action");
    if (process.env.AUTH_MODAL_SCREENSHOT) {
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: process.env.AUTH_MODAL_SCREENSHOT });
    }
    await close.click();
    await dialog.waitFor({ state: "detached" });
    const login = page.locator('input[name="email"]');
    await login.waitFor();
    await login.focus();
    assert.equal(await login.evaluate((element) => element === document.activeElement), true, "Closing restores access to the underlying login form");
    assert.equal(await page.locator(".fc-auth-backdrop").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            invalidVerification: 400,
            nativeModal: true,
            actionFocused: true,
            requiredDismissalPreserved: true,
            backgroundInert: true,
            loginFocusAfterDismissal: true,
            staleBackdrops: 0,
            backgroundScrollLocked: true,
            scrollCheck: mobile ? "computed-overflow" : "wheel",
        }),
    );
} finally {
    await browser.close();
}
