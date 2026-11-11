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
const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
        const url = new URL(request.url);
        if (request.method === "PUT" && pendingValues && url.pathname === pendingValues.pathname) {
            const held = pendingValues;
            held.ready();
            await held.pending;
            if (held.fail)
                return new Response(JSON.stringify({ message: "Injected widget value save failure" }), {
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
            return { status: response.status, id: value.id, data: value.data };
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
    const application = await request("POST", "/applications", { name: "portal-value-drafts" });
    assert.equal(application.status, 200);
    applicationId = application.id;
    assert.match(applicationId, /^\d+$/);
    assert.equal(
        (
            await request("PUT", `/applications/${applicationId}/widget-config`, {
                surfaces: {
                    widget_top: { layout: "widget_top_contained", components: {} },
                    widget_bottom: { layout: "widget_bottom_stats", components: {} },
                },
                public: false,
            })
        ).status,
        200,
    );
    const pathname = `/api/v9/applications/${applicationId}/users/@me/widget-data`;
    for (const scenario of ["value-edit", "key-edit", "add-row", "remove-row", "failure"]) {
        phase = scenario;
        assert.equal((await request("PUT", pathname.slice(7), { data: { visits: "initial" } })).status, 200);
        await page.goto(`${portalOrigin}/developers/applications/${applicationId}/widget`);
        const form = page.locator("form.card").filter({ has: page.getByRole("heading", { name: "Your values", exact: true }) });
        await form.getByRole("textbox", { name: "Value 1", exact: true }).fill("submitted");
        const action = form.getByRole("button", { name: "Save values", exact: true });
        await action.evaluate((button) => (window.pendingValueButton = button));
        let release;
        const pending = new Promise((resolve) => (release = resolve));
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The value save did not reach the proxy")), 10000);
            pendingValues = {
                pathname,
                pending,
                fail: scenario === "failure",
                ready: () => {
                    clearTimeout(timer);
                    resolve();
                },
            };
        });
        const firstResponse = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === pathname);
        await action.click();
        await intercepted;
        assert.equal(await action.isDisabled(), true);
        const expected = { visits: "submitted" };
        if (scenario === "value-edit" || scenario === "failure") {
            await form.getByRole("textbox", { name: "Value 1", exact: true }).fill("new draft");
            expected.visits = "new draft";
        }
        if (scenario === "key-edit") {
            await form.getByRole("textbox", { name: "Key 1", exact: true }).fill("new_key");
            delete expected.visits;
            expected.new_key = "submitted";
        }
        if (scenario === "add-row") {
            await form.getByRole("button", { name: "Add value", exact: true }).click();
            await form.getByRole("textbox", { name: "Key 2", exact: true }).fill("extra");
            await form.getByRole("textbox", { name: "Value 2", exact: true }).fill("extra draft");
            expected.extra = "extra draft";
        }
        if (scenario === "remove-row") {
            await form.getByRole("button", { name: "Remove visits", exact: true }).click();
            delete expected.visits;
        }
        await form.evaluate((form) => {
            window.draftInputs = [...form.querySelectorAll("input")];
        });
        release();
        assert.equal((await firstResponse).status(), scenario === "failure" ? 503 : 200);
        await page.waitForFunction(() => !pendingValueButton.disabled);
        pendingValues = undefined;
        assert.equal(await page.evaluate(() => draftInputs.every((input) => input.isConnected)), true);
        if (scenario === "failure") assert.equal(await form.getByRole("alert").textContent(), "Injected widget value save failure");
        else assert.equal(await form.getByRole("status").textContent(), "Values saved. You have unsaved changes.");
        const firstSaved = await request("GET", pathname.slice(7));
        assert.equal(firstSaved.status, 200);
        assert.deepEqual(firstSaved.data, { visits: scenario === "failure" ? "initial" : "submitted" });
        const secondResponse = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === pathname);
        await action.click();
        assert.equal((await secondResponse).status(), 200);
        await page.waitForFunction(() => !pendingValueButton.disabled);
        assert.equal(await form.getByRole("status").textContent(), "Values saved.");
        const finalSaved = await request("GET", pathname.slice(7));
        assert.equal(finalSaved.status, 200);
        assert.deepEqual(finalSaved.data, expected);
        await Bun.sleep(10500);
    }
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeSignin: true,
            scenarios: 5,
            laterDraftsPreserved: true,
            secondSavePersistsDrafts: true,
            failedSaveRetainsDraft: true,
            portalPageErrors: errors.length,
            loginPageErrorCount: loginErrors.length,
        }),
    );
} catch (error) {
    console.error(JSON.stringify({ browser: browserName, phase }));
    throw error;
} finally {
    pendingValues = undefined;
    try {
        if (applicationId && page && !page.isClosed()) {
            const result = await request("POST", `/applications/${applicationId}/delete`, {});
            assert.equal(result.status, 200);
        }
    } finally {
        proxy.stop(true);
        await browser.close();
    }
}
