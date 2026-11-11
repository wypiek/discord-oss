import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { chromiumPath } from "../util/chromium.cjs";

const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const origin = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3413}`;
assert.ok(["localhost", "127.0.0.1", "fosscord.localhost"].includes(new URL(origin).hostname), "Use an isolated local instance with registration disabled");
const code = process.env.REGISTRATION_DISABLED_CODE || "DISABLED";
assert.ok(["DISABLED", "REGISTRATION_DISABLED"].includes(code));
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
    page.on("pageerror", (error) => {
        if (!error.message.includes("Sentry successfully disabled")) errors.push(error.message);
    });
    if (process.env.VENCORD_OUTPUT) {
        for (const [file, contentType] of [
            ["vencord.js", "application/javascript"],
            ["vencord.css", "text/css"],
        ]) {
            await page.route(
                (url) => url.pathname.endsWith(`/vencord/${file}`),
                (route) => route.fulfill({ path: path.join(process.env.VENCORD_OUTPUT, file), contentType }),
            );
        }
    }
    let requests = 0;
    let redeems = 0;
    page.on("request", (request) => {
        if (request.method() !== "POST") return;
        const pathname = new URL(request.url()).pathname;
        if (pathname.endsWith("/auth/register")) requests++;
        if (pathname.endsWith("/auth/cap/redeem")) redeems++;
    });
    await page.goto(`${origin}/register`);
    const widget = page.locator("cap-widget[required]");
    await widget.waitFor();
    const username = `capdisabled${Date.now()}`;
    const password = `${crypto.randomUUID()}A9`;
    await page.locator('input[name="global_name"]').fill("Disabled registration fixture");
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await page.locator("form").evaluate((form) => form.requestSubmit());
    await page.locator("#fosscord-cap-error").waitFor();
    assert.equal(requests, 0, "Required verification still blocks unsolved signup when registration is closed");
    await widget.getByRole("button", { name: "Click to verify you're a human", exact: true }).click();
    await page.locator("#fosscord-cap-status").getByText("Verified. You can create your account.", { exact: true }).waitFor({ timeout: 60000 });
    const proof = await page.evaluate(() => Vencord.Plugins.plugins.FosscordCap.takeToken());
    assert.ok(proof);
    assert.equal(redeems, 1);
    for (let attempt = 0; attempt < 2; attempt++) {
        const pending = page
            .waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/auth/register"))
            .then(async (response) => ({ status: response.status(), body: await response.json() }));
        await page.locator("form").evaluate((form) => form.requestSubmit());
        const response = await pending;
        assert.equal(response.status, 400);
        const error = response.body.errors?.username?._errors?.[0];
        assert.equal(error?.code, code);
        assert.equal(response.body.captcha_service, undefined, "The closed-registration error is not another verification challenge");
        assert.equal(response.body.errors?.email, undefined);
        const policyError = page.getByText(error.message, { exact: true }).first();
        await policyError.waitFor();
        const policyErrorHandle = await policyError.elementHandle();
        try {
            await page.waitForFunction((element) => {
                for (let parent = element; parent; parent = parent.parentElement) {
                    if (Number(getComputedStyle(parent).opacity) < 0.99) return false;
                }
                return true;
            }, policyErrorHandle);
        } finally {
            await policyErrorHandle.dispose();
        }
        assert.equal(await page.locator("#fosscord-cap-status").getByText("Verified. You can create your account.", { exact: true }).isVisible(), true);
        assert.ok(await page.evaluate((value) => Vencord.Plugins.plugins.FosscordCap.takeToken() === value, proof), "Policy rejection preserves the current proof");
        assert.ok((await page.locator('input[name="username"]').inputValue()) === username, "Username remains unchanged");
        assert.ok((await page.locator('input[name="password"]').inputValue()) === password, "Password remains unchanged");
        assert.equal(await page.getByRole("dialog").count(), 0);
        assert.equal(redeems, 1, "Repeated policy rejections do not force another verification solve");
    }
    assert.equal(requests, 2);
    if (process.env.CAP_DISABLED_SCREENSHOT) {
        await page.locator('input[name="username"]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: process.env.CAP_DISABLED_SCREENSHOT });
    }
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            code,
            nativePolicyErrors: 2,
            visibleUsernameError: true,
            proofRetained: true,
            verificationRedeems: redeems,
            draftsRetained: true,
            captchaModal: false,
        }),
    );
} finally {
    await browser.close();
}
