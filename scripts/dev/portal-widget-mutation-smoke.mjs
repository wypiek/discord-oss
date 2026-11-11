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
    const application = await request("POST", "/applications", { name: "portal-widget-mutations" });
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
    for (const kind of ["configuration", "profile"]) {
        for (const fail of [false, true]) {
            phase = `${kind}-${fail ? "failure" : "success"}`;
            if (kind === "profile") assert.equal((await request("PUT", "/users/@me/widgets", { widgets: [] })).status, 200);
            await page.goto(`${portalOrigin}/developers/applications/${applicationId}/widget`);
            if (kind === "configuration") {
                await page.locator("#widget-title").fill(`Saved ${phase}`);
                for (let index = 0; index < 6; index++) await page.locator(`#widget-stat-${index}-value`).fill(String(index + 1));
            }
            const action = page.getByRole("button", {
                name: kind === "configuration" ? "Save widget" : "Add to my profile",
                exact: true,
            });
            await action.evaluate((button) => {
                window.pendingWidgetButton = button;
                window.pendingWidgetRoot = button.closest("form,section.card");
            });
            const pathname = kind === "configuration" ? `/api/v9/applications/${applicationId}/widget-config` : "/api/v9/users/@me/widgets";
            let release;
            const pending = new Promise((resolve) => (release = resolve));
            const intercepted = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("Widget mutation did not reach the proxy")), 10000);
                pendingValues = {
                    pathname,
                    pending,
                    fail,
                    ready: () => {
                        clearTimeout(timer);
                        resolve();
                    },
                };
            });
            const response = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === pathname);
            response.catch(() => {});
            await action.click();
            await intercepted;
            await page.getByRole("link", { name: "General information", exact: true }).click();
            await page.getByRole("button", { name: "Save changes", exact: true }).waitFor();
            const title = await page.title();
            const snapshot = await page.locator("#view").textContent();
            await page.evaluate(() => {
                window.widgetMessages = [...pendingWidgetRoot.querySelectorAll("[role=status],[role=alert]")].map((node) => ({ text: node.textContent, hidden: node.hidden }));
            });
            pendingValues = undefined;
            release();
            assert.equal((await response).status(), fail ? 503 : 200);
            await page.waitForFunction(() => !pendingWidgetButton.disabled);
            assert.equal(await page.title(), title);
            assert.equal(await page.locator("#view").textContent(), snapshot);
            assert.equal(await page.evaluate(() => pendingWidgetRoot.isConnected), false);
            assert.deepEqual(
                await page.evaluate(() =>
                    [...pendingWidgetRoot.querySelectorAll("[role=status],[role=alert]")].map((node) => ({
                        text: node.textContent,
                        hidden: node.hidden,
                    })),
                ),
                await page.evaluate(() => widgetMessages),
            );
            if (kind === "profile") {
                const stored = await request("GET", "/users/@me/widgets");
                assert.equal(stored.status, 200);
                assert.equal(
                    stored.widgets.some((widget) => widget.data?.type === "application" && widget.data.application_id === applicationId),
                    !fail,
                );
            } else {
                const stored = await request("GET", `/applications/${applicationId}/widget-config`);
                assert.equal(stored.status, 200);
                assert.equal(stored.config.surfaces.widget_top.components.title.fields.text.value, "Saved configuration-success");
            }
            await Bun.sleep(10500);
        }
    }
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeSignin: true,
            scenarios: 4,
            lateSuccessAndFailureIgnored: true,
            actualMutationsVerified: true,
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
            assert.equal((await request("PUT", "/users/@me/widgets", { widgets: [] })).status, 200);
            assert.equal((await request("POST", `/applications/${applicationId}/delete`, {})).status, 200);
        }
    } finally {
        proxy.stop(true);
        await browser.close();
    }
}
