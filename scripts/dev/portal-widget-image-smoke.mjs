import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { chromiumPath } from "../util/chromium.cjs";
const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const sharp = (await import("sharp")).default;
const png = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 40, g: 90, b: 160, alpha: 1 } },
})
    .png()
    .toBuffer();
const initialPng = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 160, g: 90, b: 40, alpha: 1 } },
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
        if (request.method === "POST" && pendingValues && url.pathname === pendingValues.pathname) {
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
                key: value.key,
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
    const application = await request("POST", "/applications", { name: "portal-widget-images" });
    assert.equal(application.status, 200);
    applicationId = application.id;
    assert.match(applicationId, /^\d+$/);
    const assetPath = `/applications/${applicationId}/widget-config/assets`;
    for (const scenario of ["current", "stale-success", "stale-failure", "removed-success", "removed-failure"]) {
        phase = scenario;
        const initial = await request("POST", assetPath, {
            image: `data:image/png;base64,${initialPng.toString("base64")}`,
        });
        assert.equal(initial.status, 201);
        assert.equal(
            (
                await request("PUT", `/applications/${applicationId}/widget-config`, {
                    public: false,
                    surfaces: {
                        widget_top: {
                            layout: "widget_top_contained",
                            components: {
                                title: {
                                    fields: {
                                        text: {
                                            value_type: "custom_string",
                                            presentation_type: "text",
                                            value: "Image probe",
                                        },
                                    },
                                },
                                contained_image: {
                                    fields: {
                                        image: {
                                            value_type: "application_asset",
                                            presentation_type: "image",
                                            value: initial.key,
                                        },
                                    },
                                },
                            },
                        },
                        widget_bottom: {
                            layout: "widget_bottom_stats",
                            components: Object.fromEntries(
                                Array.from({ length: 6 }, (_, index) => [
                                    `stat_${index + 1}`,
                                    {
                                        fields: {
                                            value: {
                                                value_type: "custom_string",
                                                presentation_type: "text",
                                                value: String(index + 1),
                                            },
                                        },
                                    },
                                ]),
                            ),
                        },
                    },
                })
            ).status,
            200,
        );
        await page.goto(`${portalOrigin}/developers/applications/${applicationId}/widget`);
        const picker = page.locator(".field").filter({ has: page.locator("#widget-top-image") });
        await picker.locator("#widget-top-image").evaluate((button) => {
            window.pendingImageButton = button;
            window.oldImagePicker = button.closest(".field");
            window.oldImageForm = button.closest("form");
        });
        const pathname = `/api/v9${assetPath}`;
        let release;
        const pending = new Promise((resolve) => (release = resolve));
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Image upload did not reach the proxy")), 10000);
            pendingValues = {
                pathname,
                pending,
                fail: scenario.endsWith("failure"),
                ready: () => {
                    clearTimeout(timer);
                    resolve();
                },
            };
        });
        const response = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === pathname);
        response.catch(() => {});
        await picker.locator("input[type=file]").setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: png });
        await intercepted;
        if (scenario.startsWith("removed")) await picker.getByRole("button", { name: "Remove image", exact: true }).click();
        if (scenario.startsWith("stale")) {
            await page.getByRole("link", { name: "General information", exact: true }).click();
            await page.getByRole("button", { name: "Save changes", exact: true }).waitFor();
        }
        const title = await page.title();
        const viewSnapshot = scenario.startsWith("stale") ? await page.locator("#view").textContent() : null;
        const before = await page.evaluate(() => ({
            picker: oldImagePicker.querySelector(".wp-thumb").innerHTML,
            errors: [...oldImageForm.querySelectorAll("[role=alert]")].map((node) => ({
                text: node.textContent,
                hidden: node.hidden,
            })),
        }));
        pendingValues = undefined;
        release();
        const completed = await response;
        assert.equal(completed.status(), scenario.endsWith("failure") ? 503 : 201);
        await page.waitForFunction(() => !pendingImageButton.disabled);
        await page.waitForTimeout(100);
        if (scenario.startsWith("stale")) {
            assert.equal(await page.title(), title);
            assert.equal(await page.locator("#view").textContent(), viewSnapshot);
            assert.equal(await page.evaluate(() => oldImagePicker.isConnected), false);
            const after = await page.evaluate(() => ({
                picker: oldImagePicker.querySelector(".wp-thumb").innerHTML,
                errors: [...oldImageForm.querySelectorAll("[role=alert]")].map((node) => ({
                    text: node.textContent,
                    hidden: node.hidden,
                })),
            }));
            assert.deepEqual(after, before);
        } else {
            assert.equal(await picker.locator(".wp-thumb img").count(), scenario === "current" ? 1 : 0);
            assert.equal(await page.getByRole("alert").filter({ hasText: "Injected widget value save failure" }).count(), 0);
            const saved = page.waitForResponse(
                (response) => response.request().method() === "PUT" && new URL(response.url()).pathname === `/api/v9/applications/${applicationId}/widget-config`,
            );
            await page.getByRole("button", { name: "Save widget", exact: true }).click();
            assert.equal((await saved).status(), 200);
            const stored = await request("GET", `/applications/${applicationId}/widget-config`);
            assert.equal(stored.status, 200);
            const image = stored.config.surfaces.widget_top.components.contained_image?.fields.image?.value ?? null;
            assert.equal(image, scenario === "current" ? (await completed.json()).key : null);
        }
        await Bun.sleep(10500);
    }
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeSignin: true,
            scenarios: 5,
            currentImageStored: true,
            newerRemovalStored: true,
            obsoleteSuccessAndFailureIgnored: true,
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
