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
const privateTokens = new Map();
let resetWrites = 0;
const applications = [];
const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
        const url = new URL(request.url);
        if (request.method === "POST" && /\/applications\/\d+\/bot\/reset$/.test(url.pathname)) resetWrites++;
        if (request.method === "POST" && pendingValues && url.pathname === pendingValues.pathname) {
            const held = pendingValues;
            held.ready();
            await held.pending;
            if (held.fail)
                return new Response(JSON.stringify({ message: "Injected bot reset failure" }), {
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
        if (request.method === "POST" && /\/applications\/\d+\/bot\/reset$/.test(url.pathname) && response.status === 200) {
            const data = await response.clone().json();
            if (typeof data.token === "string") privateTokens.set(url.pathname, data.token);
        }
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
    const application = await request("POST", "/applications", { name: "portal-bot-reset" });
    assert.equal(application.status, 200);
    applicationId = application.id;
    assert.match(applicationId, /^\d+$/);
    applications.push(applicationId);
    const other = await request("POST", "/applications", { name: "portal-bot-reset-other" });
    assert.equal(other.status, 200);
    assert.match(other.id, /^\d+$/);
    applications.push(other.id);
    assert.equal((await request("POST", `/applications/${applicationId}/bot`, {})).status, 200);
    assert.equal((await request("POST", `/applications/${other.id}/bot`, {})).status, 200);
    const navigate = async (id) => {
        await page.evaluate((path) => {
            history.pushState(null, "", path);
            window.dispatchEvent(new PopStateEvent("popstate"));
        }, `/developers/applications/${id}/bot`);
        await page.getByRole("button", { name: "Reset token", exact: true }).waitFor();
    };
    const resetPath = `/api/v9/applications/${applicationId}/bot/reset`;
    for (const scenario of ["current", "late-other-return", "early-return", "stale-failure"]) {
        phase = scenario;
        await navigate(applicationId);
        const opener = page.getByRole("button", { name: "Reset token", exact: true });
        await opener.evaluate((button) => (window.originalTokenButton = button));
        let release;
        const pending = new Promise((resolve) => (release = resolve));
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Bot reset did not reach the proxy")), 10000);
            pendingValues = {
                pathname: resetPath,
                pending,
                release,
                fail: scenario === "stale-failure",
                ready: () => {
                    clearTimeout(timer);
                    resolve();
                },
            };
        });
        const response = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === resetPath);
        response.catch(() => {});
        const before = resetWrites;
        await opener.click();
        assert.equal(await page.evaluate(() => originalTokenButton.disabled), true);
        await page.evaluate(() => originalTokenButton.dispatchEvent(new MouseEvent("click")));
        assert.equal(await page.getByRole("dialog").count(), 1);
        await page.getByRole("dialog").getByRole("button", { name: "Reset token", exact: true }).click();
        await intercepted;
        await page.evaluate(() => originalTokenButton.dispatchEvent(new MouseEvent("click")));
        assert.equal(resetWrites - before, 1);
        if (scenario !== "current") await navigate(other.id);
        if (scenario === "early-return") {
            await navigate(applicationId);
            assert.equal(await page.getByRole("button", { name: "Reset token", exact: true }).isDisabled(), true);
        }
        pendingValues = undefined;
        release();
        assert.equal((await response).status(), scenario === "stale-failure" ? 503 : 200);
        await page.waitForFunction(() => !originalTokenButton.disabled);
        if (scenario === "late-other-return" || scenario === "stale-failure") {
            assert.equal(await page.getByRole("textbox", { name: "Token", exact: true }).count(), 0);
            assert.equal(await page.getByRole("alert").filter({ hasText: "Injected" }).count(), 0);
            if (scenario === "stale-failure") continue;
            await navigate(applicationId);
        }
        const field = page.getByRole("textbox", { name: "Token", exact: true });
        await field.waitFor();
        const expected = privateTokens.get(resetPath);
        assert.ok(expected);
        assert.ok((await field.inputValue()) === expected, "The displayed token must match its own successful reset");
        assert.equal(
            await page.evaluate((value) => [localStorage, sessionStorage].some((storage) => Object.values(storage).some((entry) => String(entry).includes(value))), expected),
            false,
            "Bot tokens must remain out of browser storage",
        );
        const credentialResponse = await fetch(`${origin}/api/v9/users/@me`, {
            headers: { authorization: `Bot ${expected}` },
        });
        assert.equal(credentialResponse.status, 200, "The displayed token must authenticate its bot");
        await credentialResponse.body?.cancel();
        await navigate(other.id);
        assert.equal(await page.getByRole("textbox", { name: "Token", exact: true }).count(), 0);
        await navigate(applicationId);
        await page.waitForTimeout(100);
        assert.equal(await page.getByRole("textbox", { name: "Token", exact: true }).count(), 0, "A displayed token must not appear again");
        await Bun.sleep(10500);
    }
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeSignin: true,
            scenarios: 4,
            duplicateResetsPrevented: true,
            lateTokensShownOnlyOnOriginalApp: true,
            shownOnlyOnce: true,
            botAuthenticationAccepted: true,
            noBrowserStoragePersistence: true,
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
        privateTokens.clear();
        proxy.stop(true);
        await browser.close();
    }
}
