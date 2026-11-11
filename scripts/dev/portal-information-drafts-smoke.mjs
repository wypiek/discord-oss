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
let pendingInformation;
const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
        const url = new URL(request.url);
        if (request.method === "PATCH" && pendingInformation && url.pathname === pendingInformation.pathname) {
            const held = pendingInformation;
            held.ready();
            await held.pending;
            if (held.fail)
                return new Response(JSON.stringify({ message: "Injected information save failure" }), {
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
                tags: value.tags,
                description: value.description,
                icon: value.icon,
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
    const application = await request("POST", "/applications", { name: "portal-information-drafts" });
    assert.equal(application.status, 200);
    applicationId = application.id;
    assert.match(applicationId, /^\d+$/);
    const pathname = `/api/v9/applications/${applicationId}`;
    for (const scenario of ["tag-input", "tag-add", "tag-remove", "tag-clear", "description", "icon", "failure"]) {
        phase = scenario;
        assert.equal(
            (
                await request("PATCH", pathname.slice(7), {
                    tags: ["base"],
                    description: "initial",
                    icon: null,
                })
            ).status,
            200,
        );
        await page.goto(`${portalOrigin}/developers/applications/${applicationId}/information`);
        const form = page.locator("form.card").filter({ has: page.getByRole("heading", { name: "General information", exact: true }) });
        await form.locator("#app-tags").fill("submitted");
        await form.evaluate((form) => {
            window.draftForm = form;
        });
        let firstIcon;
        let newIcon;
        if (scenario === "icon") {
            await form.locator('input[type="file"]').setInputFiles(path.resolve("assets/icon.png"));
            await page.waitForFunction(() => draftForm.querySelector("img.app-icon")?.getAttribute("src")?.startsWith("data:"));
            firstIcon = await form.locator("img.app-icon").getAttribute("src");
        }
        const action = form.getByRole("button", { name: "Save changes", exact: true });
        await action.evaluate((button) => (window.pendingInformationButton = button));
        let release;
        const pending = new Promise((resolve) => (release = resolve));
        const intercepted = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("The information save did not reach the proxy")), 10000);
            pendingInformation = {
                pathname,
                pending,
                fail: scenario === "failure",
                ready: () => {
                    clearTimeout(timer);
                    resolve();
                },
            };
        });
        const firstResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === pathname);
        await action.click();
        await intercepted;
        assert.equal(await action.isDisabled(), true);
        const expected = { tags: ["base", "submitted"], description: "initial" };
        if (scenario === "tag-input" || scenario === "failure") {
            await form.locator("#app-tags").fill("new draft");
            expected.tags = ["base", "new draft"];
        }
        if (scenario === "tag-add") {
            await form.locator("#app-tags").press("Enter");
            await form.locator("#app-tags").fill("new-tag");
            await form.locator("#app-tags").press("Enter");
            expected.tags.push("new-tag");
        }
        if (scenario === "tag-remove") {
            await form.getByRole("button", { name: "Remove base", exact: true }).click();
            expected.tags = ["submitted"];
        }
        if (scenario === "tag-clear") {
            await form.getByRole("button", { name: "Remove base", exact: true }).click();
            await form.locator("#app-tags").fill("");
            expected.tags = [];
        }
        if (scenario === "description") {
            await form.locator("#app-description").fill("new description");
            expected.description = "new description";
        }
        if (scenario === "icon") {
            await form.locator('input[type="file"]').setInputFiles(path.resolve("dist/default-avatars/0.png"));
            await page.waitForFunction(
                (before) =>
                    draftForm.querySelector("img.app-icon")?.getAttribute("src")?.startsWith("data:") && draftForm.querySelector("img.app-icon").getAttribute("src") !== before,
                firstIcon,
            );
            newIcon = await form.locator("img.app-icon").getAttribute("src");
        }
        const tagsBefore = await form.locator(".tag-list").textContent();
        const inputBefore = await form.locator("#app-tags").inputValue();
        release();
        assert.equal((await firstResponse).status(), scenario === "failure" ? 503 : 200);
        await page.waitForFunction(() => !pendingInformationButton.disabled);
        pendingInformation = undefined;
        assert.equal(await form.locator(".tag-list").textContent(), tagsBefore);
        assert.equal(await form.locator("#app-tags").inputValue(), inputBefore);
        if (scenario === "failure") assert.equal(await form.getByRole("alert").textContent(), "Injected information save failure");
        else assert.equal(await form.getByRole("status").textContent(), "Changes saved. You have unsaved changes.");
        const firstSaved = await request("GET", pathname.slice(7));
        assert.equal(firstSaved.status, 200);
        assert.deepEqual(firstSaved.tags, scenario === "failure" ? ["base"] : ["base", "submitted"]);
        assert.equal(firstSaved.description, "initial");
        const secondResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === pathname);
        await action.click();
        const savedResponse = await secondResponse;
        assert.equal(savedResponse.status(), 200);
        if (scenario === "icon") assert.equal(savedResponse.request().postDataJSON().icon === newIcon, true);
        await page.waitForFunction(() => !pendingInformationButton.disabled);
        assert.equal(await form.getByRole("status").textContent(), "Changes saved.");
        const finalSaved = await request("GET", pathname.slice(7));
        assert.equal(finalSaved.status, 200);
        assert.deepEqual(finalSaved.tags, expected.tags);
        assert.equal(finalSaved.description, expected.description);
        if (scenario === "icon") {
            assert.ok(firstSaved.icon);
            assert.ok(finalSaved.icon);
            assert.notEqual(finalSaved.icon, firstSaved.icon);
            assert.equal(finalSaved.icon, (await savedResponse.json()).icon);
        }
        await Bun.sleep(10500);
    }
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeSignin: true,
            scenarios: 7,
            laterTagAndIconDraftsPreserved: true,
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
    pendingInformation = undefined;
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
