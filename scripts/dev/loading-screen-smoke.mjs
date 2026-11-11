import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { chromiumPath } from "../util/chromium.cjs";

const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const origin = (process.env.ORIGIN || "http://localhost:3290").replace(/\/$/, "");
assert.ok(["localhost", "fosscord.localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const account = parseEnv(String(fs.readFileSync(process.env.TEST_ACCOUNT_FILE || "/tmp/fosscord-admin-perf/scripts/dev/.test-account")));
const login = await fetch(`${origin}/api/v9/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: account.TEST_EMAIL, password: account.TEST_PASSWORD }),
});
assert.equal(login.status, 200);
const { token } = await login.json();
const request = async (method, body) => {
    const response = await fetch(`${origin}/api/v9/admin/settings`, {
        method,
        headers: { authorization: token, "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
};
const previous = await request("GET");
assert.equal(previous.status, 200);
assert.ok(Object.hasOwn(previous.body.client, "loadingTips"), "Live loading settings are published");
const original = {
    loadingTips: previous.body.client.loadingTips,
    loadingSvg: previous.body.client.loadingSvg,
};
const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="24" fill="#b5a2ff"><animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite"/></circle></svg>';
const tip = "You can customize this instance's loading screen.";
let browser;
try {
    const invalid = await request("PATCH", { client: { loadingSvg: '<svg onload="alert(1)"/>' } });
    assert.equal(invalid.status, 400);
    const saved = await request("PATCH", {
        client: { loadingTips: [tip, "Second custom tip."], loadingSvg: svg },
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.client.loadingTips, [tip, "Second custom tip."]);
    const html = await (await fetch(`${origin}/channels/@me`)).text();
    assert.ok(html.includes(JSON.stringify(tip)), "Saved loading tips invalidate the HTML cache without restarting");
    browser = await playwright.chromium.launch({
        headless: true,
        executablePath: chromiumPath(),
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript((value) => {
        localStorage.setItem("admin_token", value);
        localStorage.setItem("token", JSON.stringify(value));
    }, token);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => {
        if (!error.message.includes("Sentry successfully disabled")) errors.push(error.message);
    });
    await page.goto(`${origin}/admin/#/settings`);
    await page.locator("#loading-tips").waitFor();
    assert.equal(await page.locator("#loading-svg").inputValue(), svg);
    await page.locator("#loading-preview-button").click();
    await page.locator("#loading-preview img").waitFor();
    assert.ok(await page.locator("#loading-preview img").evaluate((image) => image.complete && image.naturalWidth > 0));
    assert.equal(await page.locator("#loading-preview p").textContent(), tip);
    const artifacts = process.env.LOADING_ARTIFACT_DIR;
    if (artifacts) {
        fs.mkdirSync(artifacts, { recursive: true });
        await page.locator("#settings-loading").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(artifacts, "admin-preview.png") });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#settings-loading").scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (artifacts) await page.screenshot({ path: path.join(artifacts, "admin-mobile.png") });
    await page.locator("#loading-reset").click();
    assert.equal(await page.locator("#loading-tips").inputValue(), "");
    assert.equal(await page.locator("#loading-svg").inputValue(), "");
    const native = await context.newPage();
    await native.routeWebSocket(/localhost:3290\//, (socket) => {
        const server = socket.connectToServer();
        server.onMessage((message) => {
            setTimeout(() => {
                try {
                    socket.send(message);
                } catch {}
            }, 30000);
        });
    });
    await native.goto(`${origin}/channels/@me`);
    try {
        await native.locator('img[alt="Loading"]').waitFor({ timeout: 15000 });
    } catch (error) {
        if (artifacts) await native.screenshot({ path: path.join(artifacts, "native-failure.png") });
        console.log(
            await native.evaluate(() => ({
                url: location.pathname,
                tips: window.GLOBAL_ENV.LOADING_TIPS,
                svgBytes: window.GLOBAL_ENV.LOADING_SVG?.length,
                loadingImages: document.querySelectorAll('img[alt="Loading"]').length,
                errorCount: document.querySelectorAll('[role="alert"]').length,
            })),
        );
        throw error;
    }
    await native.getByText(/customize this instance|Second custom tip/).waitFor();
    assert.ok(await native.locator('img[alt="Loading"]').evaluate((image) => image.complete && image.naturalWidth > 0));
    if (artifacts) await native.screenshot({ path: path.join(artifacts, "native-loading.png") });
    await native.close();
    assert.deepEqual(errors, []);
    const reset = await request("PATCH", { client: { loadingTips: [], loadingSvg: "" } });
    assert.equal(reset.status, 200);
    assert.equal(reset.body.client.loadingTips, null);
    assert.equal(reset.body.client.loadingSvg, null);
    const resetHtml = await (await fetch(`${origin}/channels/@me`)).text();
    assert.match(resetHtml, /LOADING_TIPS:\s*null/);
    console.log("PASS live settings, unsafe SVG rejection, preview, reset, native loading tips and animation");
} finally {
    if (browser) await browser.close();
    const restored = await request("PATCH", { client: original });
    assert.equal(restored.status, 200, "Restore isolated loading settings");
    const logout = await fetch(`${origin}/api/v9/auth/logout`, {
        method: "POST",
        headers: { authorization: token, "content-type": "application/json" },
        body: "{}",
    });
    assert.equal(logout.status, 204);
}
