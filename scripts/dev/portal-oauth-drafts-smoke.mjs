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
        if (request.method === "PATCH" && pendingValues && url.pathname === pendingValues.pathname) {
            const held = pendingValues;
            held.ready();
            await held.pending;
            if (held.fail)
                return new Response(
                    JSON.stringify({
                        message: "Injected redirect rejection",
                        errors: {
                            "redirect_uris.0": { _errors: [{ message: "Injected redirect rejection" }] },
                        },
                    }),
                    { status: 503, headers: { "content-type": "application/json" } },
                );
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
                redirect_uris: value.redirect_uris,
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
    const application = await request("POST", "/applications", { name: "portal-oauth-drafts" });
    assert.equal(application.status, 200);
    applicationId = application.id;
    assert.match(applicationId, /^\d+$/);
    const pathname = `/api/v9/applications/${applicationId}`;
    const scenarios = process.argv.includes("--validation-only")
        ? ["validation-failure"]
        : ["edit", "add", "remove", "clear", "failure", "validation-failure", "stale-success", "stale-failure"];
    for (const scenario of scenarios) {
        phase = scenario;
        const initial = ["https://example.com/first", "https://example.com/second"];
        assert.equal((await request("PATCH", pathname.slice(7), { redirect_uris: initial })).status, 200);
        await page.goto(`${portalOrigin}/developers/applications/${applicationId}/oauth2`);
        const card = page.locator("form.card").filter({ has: page.getByRole("heading", { name: "Redirects", exact: true }) });
        await card
            .getByRole("textbox", { name: "Redirect 1", exact: true })
            .fill(scenario === "validation-failure" ? `https://example.com/${"x".repeat(2100)}` : "https://example.com/submitted");
        const action = card.getByRole("button", { name: "Save changes", exact: true });
        await action.evaluate((button) => {
            window.oldRedirectButton = button;
            window.oldRedirectCard = button.closest("form");
        });
        let release;
        const pending = new Promise((resolve) => (release = resolve));
        const fail = scenario.endsWith("failure");
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Redirect save did not reach the proxy")), 10000);
            pendingValues = {
                pathname,
                pending,
                fail: fail && scenario !== "validation-failure",
                ready: () => {
                    clearTimeout(timer);
                    resolve();
                },
            };
        });
        const response = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === pathname);
        response.catch(() => {});
        await action.click();
        await intercepted;
        let expected = ["https://example.com/submitted", "https://example.com/second"];
        if (scenario === "edit" || scenario === "failure" || scenario === "validation-failure") {
            await card.getByRole("textbox", { name: "Redirect 1", exact: true }).fill("https://example.com/newer");
            expected[0] = "https://example.com/newer";
        }
        if (scenario === "add") {
            await card.getByRole("button", { name: "Add redirect", exact: true }).click();
            await card.getByRole("textbox", { name: "Redirect 3", exact: true }).fill("https://example.com/third");
            expected.push("https://example.com/third");
        }
        if (scenario === "remove" || scenario === "clear") {
            await card.getByRole("button", { name: "Remove redirect 1", exact: true }).click();
            expected.shift();
        }
        if (scenario === "clear") {
            await card.getByRole("button", { name: "Remove redirect 1", exact: true }).click();
            expected = [];
        }
        if (scenario.startsWith("stale")) {
            await page.getByRole("link", { name: "General information", exact: true }).click();
            await page.getByRole("button", { name: "Save changes", exact: true }).waitFor();
        }
        await page.locator("#view").focus();
        const title = await page.title();
        const snapshot = scenario.startsWith("stale") ? await page.locator("#view").textContent() : null;
        pendingValues = undefined;
        release();
        assert.equal((await response).status(), scenario === "validation-failure" ? 400 : fail ? 503 : 200);
        await page.waitForFunction(() => !oldRedirectButton.disabled);
        const firstSaved = await request("GET", pathname.slice(7));
        assert.equal(firstSaved.status, 200);
        assert.deepEqual(firstSaved.redirect_uris, fail ? initial : ["https://example.com/submitted", "https://example.com/second"]);
        if (scenario.startsWith("stale")) {
            assert.equal(await page.title(), title);
            assert.equal(await page.locator("#view").textContent(), snapshot);
            assert.equal(await page.evaluate(() => oldRedirectCard.querySelector("[role=alert]").hidden), true);
        } else {
            assert.deepEqual(await card.getByRole("textbox").evaluateAll((inputs) => inputs.map((input) => input.value)), expected);
            assert.equal(await card.locator("[aria-invalid]").count(), 0);
            assert.equal(await page.evaluate(() => document.activeElement.id), "view");
            if (fail)
                assert.ok((await card.getByRole("alert").textContent()).includes(scenario === "validation-failure" ? "Not a well formed URL" : "Injected redirect rejection"));
            else assert.equal(await card.getByRole("status").textContent(), "Changes saved. You have unsaved changes.");
            const second = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === pathname);
            await action.click();
            assert.equal((await second).status(), 200);
            await page.waitForFunction(() => !oldRedirectButton.disabled);
            assert.deepEqual((await request("GET", pathname.slice(7))).redirect_uris, expected);
            assert.equal(await card.getByRole("status").textContent(), "Changes saved.");
        }
        await Bun.sleep(10500);
    }
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeSignin: true,
            scenarios: scenarios.length,
            realValidationRejection: scenarios.includes("validation-failure"),
            newerDraftsRetained: true,
            secondSavePersistsDraft: true,
            obsoleteResponsesIgnored: true,
            olderErrorCannotMarkOrFocusNewerInput: true,
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
        if (applicationId && page && !page.isClosed()) assert.equal((await request("POST", `/applications/${applicationId}/delete`, {})).status, 200);
    } finally {
        proxy.stop(true);
        await browser.close();
    }
}
