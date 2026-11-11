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
let page;
let applicationId;
let phase = "signin";
const request = (method, pathname, body) =>
    page.evaluate(
        async ({ method, pathname, body }) => {
            const token = JSON.parse(localStorage.getItem("token"));
            const response = await fetch(`/api/v9${pathname}`, {
                method,
                headers: { authorization: token, "content-type": "application/json" },
                body: body === undefined ? undefined : JSON.stringify(body),
                redirect: "manual",
            });
            const text = await response.text();
            const value = text ? JSON.parse(text) : {};
            return {
                status: response.status,
                id: value.id,
                redirect_uris: value.redirect_uris,
                integration_types_config: value.integration_types_config,
                errors: value.errors,
            };
        },
        { method, pathname, body },
    );
const keep = "https://example.com/meowcord-keep";
const removed = "https://example.com/meowcord-remove";
const guildOnly = {
    0: { oauth2_install_params: { scopes: ["applications.commands"], permissions: "0" } },
};
const authorize = (type, redirect) =>
    request(
        "GET",
        `/oauth2/authorize?${new URLSearchParams({
            client_id: applicationId,
            scope: "applications.commands",
            ...(type === undefined ? {} : { integration_type: String(type) }),
            ...(redirect === undefined ? {} : { response_type: "code", redirect_uri: redirect }),
        })}`,
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
    assert.ok(await page.evaluate(() => localStorage.getItem("token")));
    await page.close();
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/developers/applications`);
    await page.getByRole("button", { name: "New application", exact: true }).waitFor();
    phase = "fixture-creation";
    const application = await request("POST", "/applications", { name: "oauth-replacement-probe" });
    assert.equal(application.status, 200);
    applicationId = application.id;
    assert.match(applicationId, /^\d+$/);
    const pathname = `/applications/${applicationId}`;
    assert.equal(
        (
            await request("PATCH", pathname, {
                redirect_uris: [keep, removed],
                integration_types_config: {
                    0: {
                        oauth2_install_params: {
                            scopes: ["bot", "applications.commands", "webhook.incoming"],
                            permissions: "8",
                        },
                    },
                    1: { oauth2_install_params: { scopes: ["applications.commands"], permissions: "0" } },
                },
            })
        ).status,
        200,
    );
    assert.equal((await authorize(0, keep)).status, 200);
    assert.equal((await authorize(0, removed)).status, 200);
    assert.equal((await authorize(1)).status, 200);
    phase = "revocation";
    const replacement = await request("PATCH", pathname, {
        redirect_uris: [keep],
        integration_types_config: {
            0: { oauth2_install_params: { scopes: ["applications.commands"], permissions: "8" } },
        },
    });
    assert.equal(replacement.status, 200);
    assert.equal((await authorize(0, keep)).status, 200);
    const revokedRedirect = await authorize(0, removed);
    assert.equal(revokedRedirect.status, 400, "A removed redirect URL must be rejected by authorization");
    assert.equal(revokedRedirect.errors.redirect_uri._errors[0].code, "INVALID_OAUTH2_REDIRECT_URI");
    const revokedUserInstall = await authorize(1);
    assert.equal(revokedUserInstall.status, 400);
    assert.equal(revokedUserInstall.errors.integration_type._errors[0].code, "APPLICATION_INTEGRATION_TYPE_NOT_SUPPORTED");
    assert.deepEqual(replacement.redirect_uris, [keep]);
    assert.deepEqual(replacement.integration_types_config, guildOnly);
    const checkSaved = async (redirects, config) => {
        const saved = await request("GET", pathname);
        assert.equal(saved.status, 200);
        assert.deepEqual(saved.redirect_uris, redirects);
        assert.deepEqual(saved.integration_types_config, config);
    };
    await checkSaved([keep], guildOnly);
    phase = "omitted-and-invalid-settings";
    assert.equal((await request("PATCH", pathname, { description: "Settings remain unchanged when omitted" })).status, 200);
    await checkSaved([keep], guildOnly);
    for (const body of [
        { redirect_uris: ["not-a-url"] },
        { integration_types_config: {} },
        {
            integration_types_config: {
                1: { oauth2_install_params: { scopes: ["bot"], permissions: "0" } },
            },
        },
        {
            integration_types_config: {
                0: { oauth2_install_params: { scopes: ["bot"], permissions: "invalid" } },
            },
        },
    ]) {
        assert.equal((await request("PATCH", pathname, body)).status, 400);
        await checkSaved([keep], guildOnly);
    }
    await Bun.sleep(10500);
    phase = "clear-redirects-and-replace-contexts";
    assert.equal((await request("PATCH", pathname, { redirect_uris: [] })).status, 200);
    await checkSaved([], guildOnly);
    assert.equal((await authorize(0, keep)).status, 400);
    assert.equal((await authorize(0, removed)).status, 400);
    const userOnly = {
        1: { oauth2_install_params: { scopes: ["applications.commands"], permissions: "0" } },
    };
    assert.equal((await request("PATCH", pathname, { integration_types_config: userOnly })).status, 200);
    await checkSaved([], userOnly);
    assert.equal((await authorize(0)).status, 400);
    assert.equal((await authorize(1)).status, 200);
    assert.equal((await authorize()).status, 200);
    phase = "empty-and-null-parameters";
    const empty = { 0: {} };
    assert.equal((await request("PATCH", pathname, { integration_types_config: empty })).status, 200);
    await checkSaved([], empty);
    const nullable = { 0: { oauth2_install_params: null } };
    assert.equal((await request("PATCH", pathname, { integration_types_config: nullable })).status, 200);
    await checkSaved([], nullable);
    assert.deepEqual(errors, []);
    console.log(
        JSON.stringify({
            browser: browserName,
            nativeSignin: true,
            revokedRedirectDenied: true,
            revokedContextsDenied: true,
            savedDefaultsReplaceScopes: true,
            omittedSettingsRetained: true,
            invalidSettingsRejected: true,
            emptyAndNullParametersPreserved: true,
            portalPageErrors: errors.length,
            loginPageErrorCount: loginErrors.length,
        }),
    );
} catch (error) {
    console.error(JSON.stringify({ browser: browserName, phase }));
    throw error;
} finally {
    try {
        if (applicationId && page && !page.isClosed()) assert.equal((await request("POST", `/applications/${applicationId}/delete`, {})).status, 200);
    } finally {
        await browser.close();
    }
}
