import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { chromiumPath } from "../util/chromium.cjs";
const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const database = process.env.PROFILE_PENDING_TEST_DATABASE;
assert.match(database ?? "", /^meowcord_profile_pending_[0-9]+$/, "Use the owned profile pending database");
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
let profileWrites = 0;
const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
        const url = new URL(request.url);
        if (request.method === "PUT" && url.pathname === "/api/v9/users/@me/widgets") profileWrites++;
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
let profileFixtureVerified = false;
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
    const application = await request("POST", "/applications", { name: "portal-profile-pending" });
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
    const fixture = Bun.spawnSync(
        [
            "psql",
            `postgres://localhost:5432/${database}`,
            "-X",
            "-At",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            `SELECT count(*) FROM applications WHERE id = '${applicationId}' AND name = 'portal-profile-pending'`,
        ],
        { stdout: "pipe", stderr: "pipe" },
    );
    assert.equal(fixture.exitCode, 0, "The fixture database must be available");
    assert.equal(Buffer.from(fixture.stdout).toString().trim(), "1", "The server must use the owned fixture database");
    profileFixtureVerified = true;
    for (const removing of [false, true])
        for (const fail of [false, true]) {
            phase = `${removing ? "remove" : "add"}-${fail ? "failure" : "success"}`;
            const initial = removing ? [{ data: { type: "application", application_id: applicationId } }] : [];
            assert.equal((await request("PUT", "/users/@me/widgets", { widgets: initial })).status, 200);
            await page.goto(`${portalOrigin}/developers/applications/${applicationId}/widget`);
            await page.locator("#widget-title").fill(`Pending ${phase}`);
            for (let index = 0; index < 6; index++) await page.locator(`#widget-stat-${index}-value`).fill(String(index + 1));
            const profile = page.getByRole("button", {
                name: removing ? "Remove from my profile" : "Add to my profile",
                exact: true,
            });
            await profile.evaluate((button) => (window.pendingProfileButton = button));
            const before = profileWrites;
            const pathname = "/api/v9/users/@me/widgets";
            let release;
            const pending = new Promise((resolve) => (release = resolve));
            const intercepted = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("Profile mutation did not reach the proxy")), 10000);
                pendingValues = {
                    pathname,
                    pending,
                    release,
                    fail,
                    ready: () => {
                        clearTimeout(timer);
                        resolve();
                    },
                };
            });
            const profileResponse = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === pathname);
            profileResponse.catch(() => {});
            await profile.click();
            await intercepted;
            const configuration = page.waitForResponse(
                (response) => response.request().method() === "PUT" && new URL(response.url()).pathname === `/api/v9/applications/${applicationId}/widget-config`,
            );
            await page.getByRole("button", { name: "Save widget", exact: true }).click();
            assert.equal((await configuration).status(), 200);
            await page.waitForFunction(() => !document.querySelector(".wp-save button").disabled);
            assert.equal(await page.evaluate(() => pendingProfileButton.disabled), true, "The real configuration response must leave the profile request pending");
            await page.evaluate(() => {
                pendingProfileButton.dispatchEvent(new MouseEvent("click"));
                pendingProfileButton.dispatchEvent(new MouseEvent("click"));
            });
            await page.waitForTimeout(100);
            assert.equal(profileWrites - before, 1, "Only the original profile write may reach the server proxy");
            pendingValues = undefined;
            release();
            assert.equal((await profileResponse).status(), fail ? 503 : 200);
            await page.waitForFunction(() => !pendingProfileButton.disabled);
            assert.equal(await page.evaluate(() => pendingProfileButton.textContent), removing !== fail ? "Add to my profile" : "Remove from my profile");
            const stored = await request("GET", "/users/@me/widgets");
            assert.equal(stored.status, 200);
            assert.equal(
                stored.widgets.some((widget) => widget.data?.application_id === applicationId),
                removing === fail,
            );
            assert.equal((await request("GET", `/applications/${applicationId}/widget-config`)).config.surfaces.widget_top.components.title.fields.text.value, `Pending ${phase}`);
            await Bun.sleep(10500);
        }
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeSignin: true,
            scenarios: 4,
            profileRemainsPendingDuringConfiguration: true,
            duplicateWritesPrevented: true,
            actualAddRemoveAndFailureVerified: true,
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
        if (applicationId && page && !page.isClosed()) {
            if (profileFixtureVerified) assert.equal((await request("PUT", "/users/@me/widgets", { widgets: [] })).status, 200);
            assert.equal((await request("POST", `/applications/${applicationId}/delete`, {})).status, 200);
        }
    } finally {
        proxy.stop(true);
        await browser.close();
    }
}
