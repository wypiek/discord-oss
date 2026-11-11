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
let pendingValues;

let resetWrites = 0;
const applications = [];
const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
        const url = new URL(request.url);
        if (request.method === "PATCH" && /\/applications\/\d+\/bot$/.test(url.pathname)) resetWrites++;
        if (request.method === "PATCH" && pendingValues && url.pathname === pendingValues.pathname) {
            const held = pendingValues;
            held.ready();
            await held.pending;
            if (held.fail)
                return new Response(JSON.stringify({ message: "Injected bot profile failure" }), {
                    status: 503,
                    headers: { "content-type": "application/json" },
                });
        }
        const response = await fetch(new URL(url.pathname + url.search, origin), {
            method: request.method,
            headers: request.headers,
            body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
            redirect: "manual",
        });
        const headers = new Headers(response.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        return new Response(response.body, { status: response.status, headers });
    },
});
const portalOrigin = `http://127.0.0.1:${proxy.port}`;
let phase = "signin";
let page;
let applicationId;
const request = (method, pathname, body) =>
    page.evaluate(
        async ({ method, pathname, body }) => {
            const token = JSON.parse(localStorage.getItem("token"));
            const response = await fetch(`/api/v9${pathname}`, {
                method,
                headers: { authorization: token, "content-type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const text = await response.text();
            const value = text ? JSON.parse(text) : {};
            return {
                status: response.status,
                id: value.id,
                data: value.data,
                config: value.config,
                widgets: value.widgets,
                bot: value.bot,
            };
        },
        { method, pathname, body },
    );
try {
    const context = await browser.newContext();
    page = await context.newPage();
    const loginErrors = [];
    const errors = [];
    page.on("pageerror", (error) => loginErrors.push(error.message));
    await page.goto(`${origin}/login`);
    await page.locator('input[name="email"]').fill(account.TEST_EMAIL);
    await page.locator('input[name="password"]').fill(account.TEST_PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/channels/@me");
    const serializedToken = await page.evaluate(() => localStorage.getItem("token"));
    assert.ok(serializedToken);
    await page.close();
    page = await context.newPage();
    await page.addInitScript(
        ({ origin, token }) => {
            if (location.origin === origin) localStorage.setItem("token", token);
        },
        { origin: portalOrigin, token: serializedToken },
    );
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${portalOrigin}/developers/applications`);
    await page.getByRole("button", { name: "New application", exact: true }).waitFor();
    const application = await request("POST", "/applications", { name: "portal-bot-profile" });
    assert.equal(application.status, 200);
    applicationId = application.id;
    assert.match(applicationId, /^\d+$/);
    applications.push(applicationId);
    const other = await request("POST", "/applications", { name: "portal-bot-profile-other" });
    assert.equal(other.status, 200);
    applications.push(other.id);
    assert.equal((await request("POST", `/applications/${applicationId}/bot`, {})).status, 200);
    const sharp = (await import("sharp")).default;
    const image = async (red) =>
        sharp({
            create: { width: 2, height: 2, channels: 4, background: { r: red, g: 70, b: 120, alpha: 1 } },
        })
            .png()
            .toBuffer();
    const firstImage = await image(30);
    const newerImage = await image(190);
    const navigate = async (id) => {
        await page.evaluate((path) => {
            history.pushState(null, "", path);
            window.dispatchEvent(new PopStateEvent("popstate"));
        }, `/developers/applications/${id}/bot`);
        await page
            .getByRole("heading", {
                name: id === applicationId ? "portal-bot-profile" : "portal-bot-profile-other",
                exact: true,
            })
            .waitFor();
    };
    const patchPath = `/api/v9/applications/${applicationId}/bot`;
    for (const scenario of ["newer-draft", "failure", "stale-success", "stale-failure"]) {
        phase = scenario;
        await navigate(applicationId);
        const form = page.locator("form").filter({ has: page.locator("#bot-username") });
        const save = form.getByRole("button", { name: "Save changes", exact: true });
        await form.locator("input[type=file]").setInputFiles({ name: "first.png", mimeType: "image/png", buffer: firstImage });
        await page.waitForFunction(() => document.querySelector("form img")?.getAttribute("src")?.startsWith("data:"));
        await page.locator("#bot-username").fill("Submitted bot");
        await form.evaluate((form) => (window.originalProfile = form));
        let release;
        const pending = new Promise((resolve) => (release = resolve));
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Profile save did not reach the proxy")), 10000);
            pendingValues = {
                pathname: patchPath,
                pending,
                release,
                fail: scenario.endsWith("failure"),
                ready: () => {
                    clearTimeout(timer);
                    resolve();
                },
            };
        });
        const response = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === patchPath);
        response.catch(() => {});
        const before = resetWrites;
        await save.click();
        await intercepted;
        await page.evaluate(() => originalProfile.dispatchEvent(new Event("submit", { cancelable: true })));
        assert.equal(resetWrites - before, 1);
        let foreignUsername;
        if (scenario.startsWith("stale")) {
            await navigate(other.id);
            foreignUsername = await page.locator("#bot-username").inputValue();
        } else {
            await page.locator("#bot-username").fill("Newer bot draft");
            await form.locator("input[type=file]").setInputFiles({ name: "newer.png", mimeType: "image/png", buffer: newerImage });
            await page.waitForFunction((value) => document.querySelector("form img")?.getAttribute("src") === value, `data:image/png;base64,${newerImage.toString("base64")}`);
        }
        pendingValues = undefined;
        release();
        assert.equal((await response).status(), scenario.endsWith("failure") ? 503 : 200);
        await page.waitForFunction(() => !originalProfile.querySelector("button[type=submit]").disabled);
        if (scenario.startsWith("stale")) {
            assert.equal(await page.locator("#bot-username").inputValue(), foreignUsername);
            assert.equal(await page.getByRole("alert").filter({ hasText: "Injected" }).count(), 0);
            continue;
        }
        assert.equal(await page.locator("#bot-username").inputValue(), "Newer bot draft");
        if (scenario === "newer-draft") assert.equal(await form.getByRole("status").textContent(), "You have unsaved changes.");
        else assert.match(await form.getByRole("alert").textContent(), /Injected/);
        const first = (await request("GET", `/applications/${applicationId}`)).bot;
        if (scenario === "newer-draft") assert.equal(first.username, "Submitted bot");
        const next = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === patchPath);
        await save.click();
        assert.equal((await next).status(), 200);
        const second = (await request("GET", `/applications/${applicationId}`)).bot;
        assert.equal(second.username, "Newer bot draft");
        assert.ok(second.avatar);
        if (scenario === "newer-draft") assert.notEqual(second.avatar, first.avatar, "The newer avatar must reach storage on the second save");
        await Bun.sleep(10500);
    }
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeSignin: true,
            scenarios: 4,
            duplicateSavesPrevented: true,
            newerDraftsRetained: true,
            exactSecondSavePersistence: true,
            obsoleteCallbacksIgnored: true,
            portalPageErrors: errors.length,
            loginPageErrorCount: loginErrors.length,
        }),
    );
} catch (error) {
    console.error(JSON.stringify({ browser: browserName, phase }));
    throw error;
} finally {
    pendingValues?.release?.();
    pendingValues = undefined;
    try {
        if (page && !page.isClosed()) for (const id of applications) assert.equal((await request("POST", `/applications/${id}/delete`, {})).status, 200);
    } finally {
        proxy.stop(true);
        await browser.close();
    }
}
