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
let pendingCreation;
let creationHeld;
let pendingUser;
let userHeld;
let pendingRouteRead;
let pendingSave;
let pendingBot;
let pendingDeletion;
let pendingActivity;
let pendingWidgetRemoval;
const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname === "/api/v9/applications" && pendingCreation) {
            creationHeld();
            await pendingCreation;
        }
        if (request.method === "GET" && url.pathname === "/api/v9/users/@me" && pendingUser) {
            userHeld();
            await pendingUser;
        }
        if (request.method === "GET" && pendingRouteRead && url.pathname === pendingRouteRead.pathname && !pendingRouteRead.captured) {
            const held = pendingRouteRead;
            held.captured = true;
            held.ready();
            await held.pending;
            if (held.fail)
                return new Response(JSON.stringify({ message: "Injected obsolete read failure" }), {
                    status: 503,
                    headers: { "content-type": "application/json" },
                });
        }
        if (request.method === "PATCH" && pendingSave && url.pathname === pendingSave.pathname) {
            const held = pendingSave;
            held.ready();
            await held.pending;
            if (held.fail)
                return new Response(JSON.stringify({ message: "Endpoint validation failed" }), {
                    status: 503,
                    headers: { "content-type": "application/json" },
                });
        }
        if (request.method === "POST" && pendingBot && url.pathname === pendingBot.pathname) {
            const held = pendingBot;
            held.ready();
            await held.pending;
        }
        if (request.method === "POST" && pendingDeletion && url.pathname === pendingDeletion.pathname) {
            const held = pendingDeletion;
            held.ready();
            await held.pending;
        }
        if (pendingActivity && request.method === pendingActivity.method && url.pathname === pendingActivity.pathname) {
            const held = pendingActivity;
            held.ready();
            await held.pending;
            if (held.fail)
                return new Response(
                    JSON.stringify({
                        errors: {
                            "url_map.0.target": { _errors: [{ message: "Injected activity mapping failure" }] },
                        },
                    }),
                    {
                        status: 503,
                        headers: { "content-type": "application/json" },
                    },
                );
        }
        if (request.method === "DELETE" && pendingWidgetRemoval && url.pathname === pendingWidgetRemoval.pathname) {
            const held = pendingWidgetRemoval;
            held.ready();
            await held.pending;
            if (held.fail)
                return new Response(JSON.stringify({ message: "Injected widget deletion failure" }), {
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
let phase = "signin";
const portalOrigin = `http://127.0.0.1:${proxy.port}`;
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
    const createdIds = [];
    const isCreation = (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/v9/applications";
    const createVisible = async (kind, name) => {
        await page
            .getByRole("button", {
                name: kind === "application" ? "New application" : "New profile widget",
                exact: true,
            })
            .click();
        const dialog = page.locator("dialog:modal");
        await dialog.locator(kind === "application" ? "#new-app-name" : "#new-widget-name").fill(name);
        const response = page.waitForResponse(isCreation);
        await dialog.getByRole("button", { name: "Create", exact: true }).click();
        const saved = await response;
        assert.equal(saved.status(), 200);
        const id = (await saved.json()).id;
        assert.match(id, /^\d+$/);
        createdIds.push(id);
        await page.waitForURL(`**/developers/applications/${id}/${kind === "application" ? "information" : "widget"}`);
        await page.getByRole("heading", { name, exact: true }).waitFor();
        return id;
    };
    await page.getByRole("button", { name: "New application", exact: true }).waitFor();
    phase = "parent-creation";
    const parentId = await createVisible("application", "portal-lifecycle-parent");
    await page.locator('#nav a[href="/developers/applications"]').click();
    const obsoleteId = await createVisible("application", "portal-route-obsolete");
    await page.goto(`${portalOrigin}/developers/applications/${parentId}/information`);
    await page.getByRole("heading", { name: "portal-lifecycle-parent", exact: true }).waitFor();
    for (const scenario of ["list-success", "list-failure", "app-success", "app-failure", "section-success", "section-failure"]) {
        phase = scenario;
        const pathname = scenario.startsWith("list-") ? "/api/v9/applications" : `/api/v9/applications/${obsoleteId}${scenario.startsWith("section-") ? "/widget-config" : ""}`;
        let release;
        const pending = new Promise((resolve) => (release = resolve));
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The route read did not reach the proxy")), 10000);
            pendingRouteRead = {
                pathname,
                pending,
                fail: scenario.endsWith("failure"),
                ready: () => {
                    clearTimeout(timer);
                    resolve();
                },
            };
        });
        const oldPath = scenario.startsWith("list-")
            ? "/developers/applications"
            : `/developers/applications/${obsoleteId}/${scenario.startsWith("section-") ? "widget" : "information"}`;
        await Promise.all([
            page.evaluate((path) => {
                history.pushState(null, "", path);
                window.dispatchEvent(new PopStateEvent("popstate"));
            }, oldPath),
            intercepted,
        ]);
        await page.evaluate((path) => {
            history.pushState(null, "", path);
            window.dispatchEvent(new PopStateEvent("popstate"));
        }, `/developers/applications/${parentId}/information`);
        await page.getByRole("heading", { name: "portal-lifecycle-parent", exact: true }).waitFor();
        await page.locator('#nav a[href="/developers/applications"]').focus();
        await page.evaluate(() => {
            window.currentRouteNodes = [...document.querySelector("#view").childNodes];
            window.currentNavNodes = [...document.querySelector("#nav").childNodes];
            window.currentRouteTitle = document.title;
            window.currentRouteFocus = document.activeElement;
        });
        const response = page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === pathname);
        release();
        pendingRouteRead = undefined;
        assert.equal((await response).status(), scenario.endsWith("failure") ? 503 : 200);
        await page.waitForTimeout(200);
        assert.equal(
            await page.evaluate(
                () =>
                    currentRouteNodes.length === document.querySelector("#view").childNodes.length &&
                    currentRouteNodes.every((node, i) => node === document.querySelector("#view").childNodes[i]),
            ),
            true,
            scenario,
        );
        assert.equal(
            await page.evaluate(
                () =>
                    currentNavNodes.length === document.querySelector("#nav").childNodes.length &&
                    currentNavNodes.every((node, i) => node === document.querySelector("#nav").childNodes[i]),
            ),
            true,
            scenario,
        );
        assert.equal(await page.evaluate(() => document.title === currentRouteTitle && document.activeElement === currentRouteFocus), true, scenario);
    }
    await page.goto(`${portalOrigin}/developers/applications/${parentId}/information`);
    await page.getByRole("heading", { name: "portal-lifecycle-parent", exact: true }).waitFor();
    for (const fail of [false, true]) {
        phase = fail ? "obsolete-save-failure" : "obsolete-save-success";
        await page.goto(`${portalOrigin}/developers/applications/${parentId}/information`);
        await page.locator("#app-description").fill("portal-save-lifecycle-fixture");
        const button = page.getByRole("button", { name: "Save changes", exact: true });
        await button.evaluate((button) => (window.pendingSaveButton = button));
        let release;
        const pending = new Promise((resolve) => (release = resolve));
        const pathname = `/api/v9/applications/${parentId}`;
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The save did not reach the proxy")), 10000);
            pendingSave = {
                pathname,
                pending,
                fail,
                ready: () => {
                    clearTimeout(timer);
                    resolve();
                },
            };
        });
        await Promise.all([button.click(), intercepted]);
        await page.evaluate((path) => {
            history.pushState(null, "", path);
            window.dispatchEvent(new PopStateEvent("popstate"));
        }, `/developers/applications/${obsoleteId}/information`);
        await page.getByRole("heading", { name: "portal-route-obsolete", exact: true }).waitFor();
        await page.locator('#nav a[href="/developers/applications"]').focus();
        await page.evaluate(() => {
            window.currentSaveNodes = [...document.querySelector("#view").childNodes];
            window.currentSaveNav = [...document.querySelector("#nav").childNodes];
            window.currentSaveFocus = document.activeElement;
            window.currentSaveTitle = document.title;
        });
        const response = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === pathname);
        release();
        pendingSave = undefined;
        assert.equal((await response).status(), fail ? 503 : 200);
        await page.waitForFunction(() => !pendingSaveButton.disabled);
        assert.equal(
            await page.evaluate(
                () =>
                    currentSaveNodes.length === document.querySelector("#view").childNodes.length &&
                    currentSaveNodes.every((node, i) => node === document.querySelector("#view").childNodes[i]),
            ),
            true,
        );
        assert.equal(
            await page.evaluate(
                () =>
                    currentSaveNav.length === document.querySelector("#nav").childNodes.length &&
                    currentSaveNav.every((node, i) => node === document.querySelector("#nav").childNodes[i]),
            ),
            true,
        );
        assert.equal(await page.evaluate(() => currentSaveFocus === document.activeElement && currentSaveTitle === document.title), true);
        if (!fail) {
            assert.equal(
                await page.evaluate(async (id) => {
                    const token = JSON.parse(localStorage.getItem("token"));
                    const response = await fetch(`/api/v9/applications/${id}`, {
                        headers: { authorization: token },
                    });
                    return response.status === 200 && (await response.json()).description === "portal-save-lifecycle-fixture";
                }, parentId),
                true,
            );
        }
    }
    await page.goto(`${portalOrigin}/developers/applications/${parentId}/information`);
    await page.getByRole("heading", { name: "portal-lifecycle-parent", exact: true }).waitFor();
    if (process.env.BOT_CREATION_TEST_DATABASE) {
        assert.match(process.env.BOT_CREATION_TEST_DATABASE, /^meowcord_bot_tokens_[0-9]+$/);
        const fixture = Bun.spawnSync(
            [
                "psql",
                process.env.BOT_CREATION_TEST_DATABASE,
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                `BEGIN; UPDATE applications SET bot_user_id=null WHERE id='${parentId}' AND name='portal-lifecycle-parent'; DELETE FROM users WHERE id='${parentId}' AND bot=true; COMMIT;`,
            ],
            { stdout: "pipe", stderr: "pipe" },
        );
        assert.equal(fixture.exitCode, 0, "The owned legacy bot fixture must initialize");
    }
    for (const reset of process.env.BOT_CREATION_TEST_DATABASE ? [false, true] : [true]) {
        phase = reset ? "obsolete-bot-reset" : "obsolete-bot-creation";
        await page.goto(`${portalOrigin}/developers/applications/${parentId}/bot`);
        let release;
        const pending = new Promise((resolve) => (release = resolve));
        const pathname = `/api/v9/applications/${parentId}/bot${reset ? "/reset" : ""}`;
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The bot request did not reach the proxy")), 10000);
            pendingBot = {
                pathname,
                pending,
                ready: () => {
                    clearTimeout(timer);
                    resolve();
                },
            };
        });
        const action = page.getByRole("button", {
            name: reset ? "Reset token" : "Add bot",
            exact: true,
        });
        await action.evaluate((button) => (window.pendingBotAction = button));
        if (reset) {
            await action.click();
            await Promise.all([page.locator("dialog").getByRole("button", { name: "Reset token", exact: true }).click(), intercepted]);
        } else await Promise.all([action.click(), intercepted]);
        await page.evaluate((path) => {
            history.pushState(null, "", path);
            window.dispatchEvent(new PopStateEvent("popstate"));
        }, `/developers/applications/${obsoleteId}/bot`);
        await page.locator("#bot-username").waitFor();
        assert.equal(await page.locator("#bot-token").count(), 0);
        await page.locator('#nav a[href="/developers/applications"]').focus();
        await page.evaluate(() => {
            window.currentBotNodes = [...document.querySelector("#view").childNodes];
            window.currentBotNav = [...document.querySelector("#nav").childNodes];
            window.currentBotTitle = document.title;
            window.currentBotFocus = document.activeElement;
        });
        const response = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === pathname);
        release();
        pendingBot = undefined;
        const saved = await response;
        assert.equal(saved.status(), 200);
        const expectedToken = (await saved.json()).token;
        assert.ok(typeof expectedToken === "string" && expectedToken.length > 0, "The test bot operation must return a token");
        if (!reset) await page.waitForFunction(() => !pendingBotAction.disabled);
        else await page.waitForTimeout(200);
        assert.equal(
            await page.evaluate(
                () =>
                    currentBotNodes.length === document.querySelector("#view").childNodes.length &&
                    currentBotNodes.every((node, i) => node === document.querySelector("#view").childNodes[i]),
            ),
            true,
        );
        assert.equal(
            await page.evaluate(
                () =>
                    currentBotNav.length === document.querySelector("#nav").childNodes.length &&
                    currentBotNav.every((node, i) => node === document.querySelector("#nav").childNodes[i]) &&
                    document.title === currentBotTitle &&
                    document.activeElement === currentBotFocus,
            ),
            true,
        );
        assert.equal(await page.locator("#bot-token").count(), 0, "An unrelated application must never display the returned token");
        await page.evaluate((path) => {
            history.pushState(null, "", path);
            window.dispatchEvent(new PopStateEvent("popstate"));
        }, `/developers/applications/${parentId}/bot`);
        await page.locator("#bot-token").waitFor();
        assert.equal(
            await page.locator("#bot-token").evaluate((input, value) => input.value === value, expectedToken),
            true,
            "The token must be available only on its application",
        );
        await page.evaluate(() => window.dispatchEvent(new PopStateEvent("popstate")));
        await page.locator("#bot-username").waitFor();
        assert.equal(await page.locator("#bot-token").count(), 0, "A consumed one-time token must not appear again");
    }
    await page.goto(`${portalOrigin}/developers/applications/${parentId}/information`);
    await page.getByRole("heading", { name: "portal-lifecycle-parent", exact: true }).waitFor();
    const activityFixtureStatus = await page.evaluate(async (id) => {
        const token = JSON.parse(localStorage.getItem("token"));
        return (
            await fetch(`/api/v9/applications/${id}`, {
                method: "PATCH",
                headers: { authorization: token, "content-type": "application/json" },
                body: JSON.stringify({ flags: 1 << 17 }),
            })
        ).status;
    }, obsoleteId);
    assert.equal(activityFixtureStatus, 200);
    for (const kind of ["enable", "settings", "mappings", "mapping-failure", "disable"]) {
        phase = `obsolete-activity-${kind}`;
        await page.goto(`${portalOrigin}/developers/applications/${parentId}/activities`);
        let action;
        if (kind === "enable" || kind === "disable")
            action = page.getByRole("button", {
                name: kind === "enable" ? "Enable activities" : "Disable activities",
                exact: true,
            });
        else {
            const settings = kind === "settings";
            if (settings) {
                await page.getByLabel("Web and desktop", { exact: true }).check();
                await page.locator("#activity-age-gate").check();
            } else await page.locator("#mapping-target-0").fill("example.com");
            action = page
                .locator("form")
                .filter({
                    has: page.getByRole("heading", {
                        name: settings ? "Activity settings" : "URL mappings",
                        exact: true,
                    }),
                })
                .getByRole("button", { name: "Save changes", exact: true });
        }
        await action.evaluate((button) => (window.pendingActivityButton = button));
        const method = kind === "mappings" || kind === "mapping-failure" ? "PUT" : "PATCH";
        const pathname = `/api/v9/applications/${parentId}${kind === "settings" ? "/embedded-activity-config" : method === "PUT" ? "/proxy-config" : ""}`;
        let release;
        const pending = new Promise((resolve) => (release = resolve));
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The activity request did not reach the proxy")), 10000);
            pendingActivity = {
                method,
                pathname,
                pending,
                fail: kind === "mapping-failure",
                ready: () => {
                    clearTimeout(timer);
                    resolve();
                },
            };
        });
        if (kind === "disable") {
            await action.click();
            await Promise.all([page.locator("dialog").getByRole("button", { name: "Disable activities", exact: true }).click(), intercepted]);
        } else await Promise.all([action.click(), intercepted]);
        assert.equal(await page.evaluate(() => pendingActivityButton.disabled), true);
        await page.evaluate(
            (path) => {
                history.pushState(null, "", path);
                window.dispatchEvent(new PopStateEvent("popstate"));
            },
            `/developers/applications/${obsoleteId}/${kind === "mapping-failure" ? "activities" : "information"}`,
        );
        if (kind === "mapping-failure") await page.locator("#mapping-target-0").waitFor();
        else await page.getByRole("heading", { name: "portal-route-obsolete", exact: true }).waitFor();
        await page.locator('#nav a[href="/developers/applications"]').focus();
        await page.evaluate(() => {
            window.currentActivityNodes = [...document.querySelector("#view").childNodes];
            window.currentActivityNav = [...document.querySelector("#nav").childNodes];
            window.currentActivityTitle = document.title;
            window.currentActivityFocus = document.activeElement;
        });
        const response = page.waitForResponse((response) => response.request().method() === method && new URL(response.url()).pathname === pathname);
        release();
        pendingActivity = undefined;
        assert.equal((await response).status(), kind === "mapping-failure" ? 503 : 200);
        await page.waitForFunction(() => !pendingActivityButton.disabled);
        assert.equal(
            await page.evaluate(
                () =>
                    currentActivityNodes.length === document.querySelector("#view").childNodes.length &&
                    currentActivityNodes.every((node, i) => node === document.querySelector("#view").childNodes[i]),
            ),
            true,
            kind,
        );
        assert.equal(
            await page.evaluate(
                () =>
                    currentActivityNav.length === document.querySelector("#nav").childNodes.length &&
                    currentActivityNav.every((node, i) => node === document.querySelector("#nav").childNodes[i]) &&
                    document.title === currentActivityTitle &&
                    document.activeElement === currentActivityFocus,
            ),
            true,
            kind,
        );
        if (kind === "mapping-failure") assert.equal(await page.locator("#mapping-target-0").getAttribute("aria-invalid"), null);
        else
            assert.equal(
                await page.evaluate(
                    async ({ id, kind }) => {
                        const token = JSON.parse(localStorage.getItem("token"));
                        const suffix = kind === "settings" ? "/embedded-activity-config" : kind === "mappings" ? "/proxy-config" : "";
                        const response = await fetch(`/api/v9/applications/${id}${suffix}`, {
                            headers: { authorization: token },
                        });
                        if (response.status !== 200) return false;
                        const value = await response.json();
                        return kind === "settings"
                            ? value.requires_age_gate === true && value.supported_platforms.includes("web")
                            : kind === "mappings"
                              ? value.url_map.some((mapping) => mapping.prefix === "/" && mapping.target === "example.com")
                              : Boolean(value.flags & (1 << 17)) === (kind === "enable");
                    },
                    { id: parentId, kind },
                ),
                true,
                "The submitted activity change must persist",
            );
    }
    await page.goto(`${portalOrigin}/developers/applications/${parentId}/information`);
    await page.getByRole("heading", { name: "portal-lifecycle-parent", exact: true }).waitFor();
    for (const fail of [false, true]) {
        phase = fail ? "obsolete-widget-deletion-failure" : "obsolete-widget-deletion-success";
        const fixtureStatus = await page.evaluate(async (id) => {
            const token = JSON.parse(localStorage.getItem("token"));
            return (
                await fetch(`/api/v9/applications/${id}/widget-config`, {
                    method: "PUT",
                    headers: { authorization: token, "content-type": "application/json" },
                    body: JSON.stringify({
                        surfaces: {
                            widget_top: { layout: "widget_top_contained", components: {} },
                            widget_bottom: { layout: "widget_bottom_stats", components: {} },
                        },
                        public: false,
                    }),
                })
            ).status;
        }, parentId);
        assert.equal(fixtureStatus, 200);
        await page.goto(`${portalOrigin}/developers/applications/${parentId}/widget`);
        const action = page.getByRole("button", { name: "Delete widget", exact: true });
        await action.evaluate((button) => (window.pendingWidgetRemovalButton = button));
        let release;
        const pending = new Promise((resolve) => (release = resolve));
        const pathname = `/api/v9/applications/${parentId}/widget-config`;
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The widget deletion did not reach the proxy")), 10000);
            pendingWidgetRemoval = {
                pathname,
                pending,
                fail,
                ready: () => {
                    clearTimeout(timer);
                    resolve();
                },
            };
        });
        await action.click();
        await Promise.all([page.locator("dialog").getByRole("button", { name: "Delete widget", exact: true }).click(), intercepted]);
        assert.equal(await page.evaluate(() => pendingWidgetRemovalButton.disabled), true);
        await page.evaluate((path) => {
            history.pushState(null, "", path);
            window.dispatchEvent(new PopStateEvent("popstate"));
        }, `/developers/applications/${obsoleteId}/information`);
        await page.getByRole("heading", { name: "portal-route-obsolete", exact: true }).waitFor();
        await page.locator('#nav a[href="/developers/applications"]').focus();
        await page.evaluate(() => {
            window.currentWidgetRemovalNodes = [...document.querySelector("#view").childNodes];
            window.currentWidgetRemovalNav = [...document.querySelector("#nav").childNodes];
            window.currentWidgetRemovalTitle = document.title;
            window.currentWidgetRemovalFocus = document.activeElement;
        });
        const response = page.waitForResponse((response) => response.request().method() === "DELETE" && new URL(response.url()).pathname === pathname);
        release();
        pendingWidgetRemoval = undefined;
        assert.equal((await response).status(), fail ? 503 : 204);
        await page.waitForFunction(() => !pendingWidgetRemovalButton.disabled);
        assert.equal(
            await page.evaluate(
                () =>
                    currentWidgetRemovalNodes.length === document.querySelector("#view").childNodes.length &&
                    currentWidgetRemovalNodes.every((node, i) => node === document.querySelector("#view").childNodes[i]),
            ),
            true,
        );
        assert.equal(
            await page.evaluate(
                () =>
                    currentWidgetRemovalNav.length === document.querySelector("#nav").childNodes.length &&
                    currentWidgetRemovalNav.every((node, i) => node === document.querySelector("#nav").childNodes[i]) &&
                    document.title === currentWidgetRemovalTitle &&
                    document.activeElement === currentWidgetRemovalFocus,
            ),
            true,
        );
        assert.equal(
            await page.evaluate(
                async ({ id, fail }) => {
                    const token = JSON.parse(localStorage.getItem("token"));
                    const response = await fetch(`/api/v9/applications/${id}/widget-config`, {
                        headers: { authorization: token },
                    });
                    if (response.status !== 200) return false;
                    const value = await response.json();
                    return fail ? !!value.config : value.config === null && value.public === false;
                },
                { id: parentId, fail },
            ),
            true,
            "The real widget configuration must reflect deletion or the injected failure",
        );
    }
    await page.goto(`${portalOrigin}/developers/applications/${parentId}/information`);
    await page.getByRole("heading", { name: "portal-lifecycle-parent", exact: true }).waitFor();
    for (const kind of ["application", "widget"]) {
        phase = `${kind}-pending-creation`;
        await page.locator('#nav a[href="/developers/applications"]').click();
        await page.getByRole("button", { name: "New application", exact: true }).waitFor();
        let release;
        pendingCreation = new Promise((resolve) => (release = resolve));
        await page
            .getByRole("button", {
                name: kind === "application" ? "New application" : "New profile widget",
                exact: true,
            })
            .click();
        const dialog = page.locator("dialog:modal");
        await dialog.locator(kind === "application" ? "#new-app-name" : "#new-widget-name").fill(`portal-lifecycle-${kind}`);
        await dialog.getByRole("button", { name: "Create", exact: true }).evaluate((button) => (window.creationSubmit = button));
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The application creation request did not reach the proxy")), 10000);
            creationHeld = () => {
                clearTimeout(timer);
                resolve();
            };
        });
        const response = page.waitForResponse(isCreation);
        await Promise.all([dialog.getByRole("button", { name: "Create", exact: true }).click(), intercepted]);
        if (kind === "application") await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        else {
            await page.goBack();
            await page.waitForURL(`**/developers/applications/${parentId}/information`);
        }
        await page.waitForFunction(() => !document.querySelector("dialog:modal"));
        const path = new URL(page.url()).pathname;
        release();
        pendingCreation = undefined;
        const saved = await response;
        assert.equal(saved.status(), 200);
        const id = (await saved.json()).id;
        assert.match(id, /^\d+$/);
        createdIds.push(id);
        await page.waitForFunction(() => !window.creationSubmit.disabled);
        assert.equal(new URL(page.url()).pathname, path);
        assert.equal(await page.locator("dialog").count(), 0);
        await page.goto(`${portalOrigin}/developers/applications/${parentId}/information`);
        await page.getByRole("heading", { name: "portal-lifecycle-parent", exact: true }).waitFor();
    }
    await page.locator('#nav a[href="/developers/applications"]').click();
    await page.locator(`a.app-card[href="/developers/applications/${parentId}/information"]`).click();
    await page.locator('#nav a[href="/developers/applications"]').click();
    phase = "pending-widget-opening";
    let releaseUser;
    pendingUser = new Promise((resolve) => (releaseUser = resolve));
    const userIntercepted = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The user read did not reach the proxy")), 10000);
        userHeld = () => {
            clearTimeout(timer);
            resolve();
        };
    });
    const userResponse = page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/v9/users/@me");
    await Promise.all([page.getByRole("button", { name: "New profile widget", exact: true }).click(), userIntercepted]);
    await page.goBack();
    await page.waitForURL(`**/developers/applications/${parentId}/information`);
    releaseUser();
    pendingUser = undefined;
    assert.equal((await userResponse).status(), 200);
    await page.waitForTimeout(200);
    assert.equal(await page.locator("dialog").count(), 0, "A late user response must not open a dialog on the new route");
    phase = "deletion-confirmation";
    let deletionRequests = 0;
    page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname.endsWith(`/applications/${parentId}/delete`)) deletionRequests++;
    });
    await page.getByRole("button", { name: "Delete application", exact: true }).click();
    await page.locator("dialog:modal").waitFor();
    await page.goBack();
    await page.waitForURL("**/developers/applications");
    await page.waitForFunction(() => !document.querySelector("dialog"));
    assert.equal(deletionRequests, 0);
    {
        let release;
        pendingUser = new Promise((resolve) => (release = resolve));
        phase = "repeated-widget-opening";
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The repeated widget opening read did not reach the proxy")), 10000);
            userHeld = () => {
                clearTimeout(timer);
                resolve();
            };
        });
        const response = page.waitForResponse((response) => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/v9/users/@me");
        await Promise.all([
            page.getByRole("button", { name: "New profile widget", exact: true }).evaluate((button) => {
                button.click();
                button.click();
            }),
            intercepted,
        ]);
        release();
        pendingUser = undefined;
        assert.equal((await response).status(), 200);
        await page.locator("#new-widget-name").waitFor();
        await page.waitForTimeout(200);
        assert.equal(await page.locator("dialog").count(), 1, "Repeated pending openings must show one widget dialog");
        await page.locator("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
        await page.waitForFunction(() => !document.querySelector("dialog"));
    }
    phase = "visible-widget-creation";
    await createVisible("widget", "portal-lifecycle-widget-open");
    phase = "pending-application-deletion";
    await page.locator('#nav a[href="/developers/applications"]').click();
    const deleteId = await createVisible("application", "portal-delete-target");
    let releaseDeletion;
    const deletionPending = new Promise((resolve) => (releaseDeletion = resolve));
    const deletionPath = `/api/v9/applications/${deleteId}/delete`;
    const deletionIntercepted = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("The deletion did not reach the proxy")), 10000);
        pendingDeletion = {
            pathname: deletionPath,
            pending: deletionPending,
            ready: () => {
                clearTimeout(timer);
                resolve();
            },
        };
    });
    const deleteAction = page.getByRole("button", { name: "Delete application", exact: true });
    await deleteAction.evaluate((button) => (window.pendingDeleteButton = button));
    await deleteAction.click();
    await Promise.all([page.locator("dialog").getByRole("button", { name: "Delete application", exact: true }).click(), deletionIntercepted]);
    assert.equal(await page.evaluate(() => pendingDeleteButton.disabled), true);
    await page.evaluate((path) => {
        history.pushState(null, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
    }, `/developers/applications/${parentId}/information`);
    await page.getByRole("heading", { name: "portal-lifecycle-parent", exact: true }).waitFor();
    await page.locator('#nav a[href="/developers/applications"]').focus();
    await page.evaluate(() => {
        window.currentDeleteNodes = [...document.querySelector("#view").childNodes];
        window.currentDeleteNav = [...document.querySelector("#nav").childNodes];
        window.currentDeleteTitle = document.title;
        window.currentDeleteFocus = document.activeElement;
    });
    const deletionResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === deletionPath);
    releaseDeletion();
    pendingDeletion = undefined;
    assert.equal((await deletionResponse).status(), 200);
    await page.waitForFunction(() => !pendingDeleteButton.disabled);
    assert.equal(new URL(page.url()).pathname, `/developers/applications/${parentId}/information`);
    assert.equal(
        await page.evaluate(
            () =>
                currentDeleteNodes.length === document.querySelector("#view").childNodes.length &&
                currentDeleteNodes.every((node, i) => node === document.querySelector("#view").childNodes[i]),
        ),
        true,
    );
    assert.equal(
        await page.evaluate(
            () =>
                currentDeleteNav.length === document.querySelector("#nav").childNodes.length &&
                currentDeleteNav.every((node, i) => node === document.querySelector("#nav").childNodes[i]) &&
                document.title === currentDeleteTitle &&
                document.activeElement === currentDeleteFocus,
        ),
        true,
    );
    assert.equal(
        await page.evaluate(async (id) => {
            const token = JSON.parse(localStorage.getItem("token"));
            const response = await fetch("/api/v9/applications", { headers: { authorization: token } });
            return response.status === 200 && !(await response.json()).some((app) => app.id === id);
        }, deleteId),
        true,
        "The submitted application deletion must persist",
    );
    for (const id of createdIds.filter((id) => id !== deleteId)) {
        const status = await page.evaluate(async (id) => {
            const token = JSON.parse(localStorage.getItem("token") ?? "null");
            return (
                await fetch(`/api/v9/applications/${id}/delete`, {
                    method: "POST",
                    headers: { authorization: token, "content-type": "application/json" },
                    body: "{}",
                })
            ).status;
        }, id);
        assert.equal(status, 200);
    }
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeSignin: true,
            obsoleteRouteReadsPreserveCurrentPage: true,
            obsoleteSavesPreserveCurrentPage: true,
            obsoleteActivityChangesPreserveCurrentPage: true,
            obsoleteWidgetDeletionPreservesCurrentPage: true,
            botTokensStayOnTheirApplication: true,
            legacyBotCreationChecked: !!process.env.BOT_CREATION_TEST_DATABASE,
            oneTimeTokensSurviveNavigation: true,
            openCreateNavigates: true,
            cancelledPendingCreateStaysOnPage: true,
            historyBackDismissesWidget: true,
            routeChangeCancelsDeletion: true,
            completedDeletionPreservesCurrentPage: true,
            routeChangeCancelsPendingWidgetOpen: true,
            repeatedPendingWidgetOpenShowsOneDialog: true,
            submittedRequestsComplete: true,
            createdFixturesRemoved: createdIds.length,
            loginPageErrorCount: loginErrors.length,
        }),
    );
} catch (error) {
    console.error(JSON.stringify({ browser: browserName, phase }));
    throw error;
} finally {
    proxy.stop(true);
    await browser.close();
}
