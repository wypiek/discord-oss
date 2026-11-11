import assert from "node:assert/strict";
import { Client } from "pg";
const database = process.env.WIDGET_DRAFT_TEST_DATABASE;
assert.match(database ?? "", /^meowcord_widget_drafts_[0-9]+$/, "Use the owned widget draft database");
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { chromiumPath } from "../util/chromium.cjs";
const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const sharp = (await import("sharp")).default;
const png = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 90, g: 160, b: 40, alpha: 1 } },
})
    .png()
    .toBuffer();
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
                public: value.public,
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
    const application = await request("POST", "/applications", { name: "portal-widget-drafts" });
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
    phase = "concurrent-image-uploads";
    const client = new Client({ connectionString: `postgres://localhost:5432/${database}` });
    await client.connect();
    try {
        assert.equal((await client.query("SELECT current_database() AS name")).rows[0].name, database);
        await client.query("BEGIN");
        const fixture = await client.query("SELECT id FROM applications WHERE id = $1 AND name = $2 FOR UPDATE", [applicationId, "portal-widget-drafts"]);
        assert.equal(fixture.rowCount, 1, "The server must use the owned fixture database");
        const images = await Promise.all(
            [20, 220].map((red) =>
                sharp({
                    create: {
                        width: 3,
                        height: 3,
                        channels: 4,
                        background: { r: red, g: 80, b: 110, alpha: 1 },
                    },
                })
                    .png()
                    .toBuffer(),
            ),
        );
        const uploads = Promise.all(
            images.map((image) =>
                request("POST", `/applications/${applicationId}/widget-config/assets`, {
                    image: `data:image/png;base64,${image.toString("base64")}`,
                }),
            ),
        );
        uploads.catch(() => {});
        const started = Date.now();
        let waiting = 0;
        while (waiting < 2 && Date.now() - started < 10000) {
            await client.query("SELECT pg_stat_clear_snapshot()");
            waiting = Number(
                (
                    await client.query(
                        "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%applications%' AND pid <> pg_backend_pid()",
                    )
                ).rows[0].count,
            );
            if (waiting < 2) await Bun.sleep(50);
        }
        assert.equal(waiting, 2, "Both actual uploads must reach the held application row");
        await client.query("COMMIT");
        const results = await uploads;
        assert.ok(results.every((result) => result.status === 201));
        const stored = await request("GET", `/applications/${applicationId}/widget-config`);
        assert.equal(stored.config.assets.length, 2, "Both serialized uploads must remain recorded");
        assert.equal(new Set(stored.config.assets.map((asset) => asset.key)).size, 2);
    } finally {
        await client.query("ROLLBACK");
        await client.end();
    }
    phase = "new-image-during-save";
    await page.goto(`${portalOrigin}/developers/applications/${applicationId}/widget`);
    await page.locator("#widget-title").fill("Submitted title");
    for (let index = 0; index < 6; index++) await page.locator(`#widget-stat-${index}-value`).fill(String(index + 1));
    const pathname = `/api/v9/applications/${applicationId}/widget-config`;
    let release;
    const pending = new Promise((resolve) => (release = resolve));
    const intercepted = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Configuration save did not reach the proxy")), 10000);
        pendingValues = {
            pathname,
            pending,
            fail: false,
            ready: () => {
                clearTimeout(timer);
                resolve();
            },
        };
    });
    const response = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === pathname);
    response.catch(() => {});
    await page.getByRole("button", { name: "Save widget", exact: true }).click();
    await intercepted;
    await page.locator("#widget-title").fill("Newer title");
    await page.locator("#widget-public").check();
    const uploadResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === `${pathname}/assets`);
    await page
        .locator(".field")
        .filter({ has: page.locator("#widget-top-image") })
        .locator("input[type=file]")
        .setInputFiles({ name: "newer.png", mimeType: "image/png", buffer: png });
    assert.equal((await uploadResponse).status(), 201);
    const uploaded = await (await uploadResponse).json();
    await page.waitForFunction(() => !document.querySelector("#widget-top-image").disabled);
    assert.equal(
        (await request("GET", pathname.slice(7))).config.assets.some((asset) => asset.key === uploaded.key),
        true,
    );
    pendingValues = undefined;
    release();
    assert.equal((await response).status(), 200);
    await page.getByRole("button", { name: "Save widget", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector(".wp-save button").disabled);
    const firstSaved = await request("GET", pathname.slice(7));
    assert.equal(
        firstSaved.config.assets.some((asset) => asset.key === uploaded.key),
        true,
        "The earlier save must retain an image uploaded after submission",
    );
    assert.equal(firstSaved.config.surfaces.widget_top.components.title.fields.text.value, "Submitted title");
    assert.equal(firstSaved.public, false);
    assert.deepEqual(
        firstSaved.config.assets.map((asset) => asset.key),
        [uploaded.key],
    );
    assert.equal(await page.locator("#widget-title").inputValue(), "Newer title");
    assert.equal(await page.locator(".wp-save [role=status]").textContent(), "Widget saved. You have unsaved changes.");
    const secondResponse = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === pathname);
    await page.getByRole("button", { name: "Save widget", exact: true }).click();
    assert.equal((await secondResponse).status(), 200);
    const secondSaved = await request("GET", pathname.slice(7));
    assert.equal(secondSaved.config.surfaces.widget_top.components.title.fields.text.value, "Newer title");
    assert.equal(secondSaved.public, true);
    assert.equal(secondSaved.config.surfaces.widget_top.components.contained_image.fields.image.value, uploaded.key);
    const imageUrl = await page
        .locator(".field")
        .filter({ has: page.locator("#widget-top-image") })
        .locator(".wp-thumb img")
        .getAttribute("src");
    assert.ok(imageUrl);
    assert.equal(await page.evaluate(async (url) => (await fetch(url, { cache: "no-store" })).status, imageUrl), 200, "The retained image file must remain available");
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeSignin: true,
            newerImageRetained: true,
            concurrentUploadsRetained: true,
            replacedImagesPruned: true,
            firstSubmittedSnapshotStored: true,
            secondSaveStoresDraft: true,
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
