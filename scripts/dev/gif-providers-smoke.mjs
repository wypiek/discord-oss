import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";
import { solveCap } from "./cap-token.mjs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { chromiumPath } from "../util/chromium.cjs";
const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");
const origin = `http://fosscord.localhost:${process.env.PORT || 3290}`;
const env = parseEnv(String(readFileSync(process.env.DOTENV_CONFIG_PATH || ".env")));
const database = process.env.DATABASE || env.DATABASE;
assert.equal(new URL(database).pathname, "/fosscord_codex_admin", "Use the isolated admin demo database");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(database).hostname));
const { Client } = createRequire(import.meta.url)("pg");
const db = new Client({ connectionString: database });
const fixtures = [];
let fixtureChannel;
const account = Object.fromEntries(
    readFileSync(process.env.TEST_ACCOUNT_FILE || new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
);
const login = await fetch(`${origin}/api/v9/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: account.TEST_EMAIL, password: account.TEST_PASSWORD }),
});
assert.equal(login.status, 200);
const { token } = await login.json();
const api = async (route, method = "GET", body) => {
    const response = await fetch(`${origin}/api/v9${route}`, {
        method,
        headers: { authorization: token, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
};
const before = await api("/admin/gifs");
assert.equal(before.status, 200);
assert.equal("apiKey" in before.body.klipy, false);
assert.equal("apiKeyPath" in before.body.klipy, false);
assert.equal((await api("/admin/gifs", "PATCH", { defaultProvider: "invalid" })).status, 400);
assert.equal((await api("/gifs/providers")).body.defaultProvider, before.body.defaultProvider);
let page;
const browser = await chromium.launch({
    executablePath: chromiumPath(),
    headless: true,
});
try {
    await db.connect();
    const signup = async () => {
        const suffix = randomBytes(6).toString("hex");
        const fixture = {
            email: `gif-smoke-${suffix}@fosscord.test`,
            password: `Aa2!${randomBytes(18).toString("hex")}`,
        };
        fixtures.push(fixture);
        const captcha_key = await solveCap({ origin, browser });
        const registered = await fetch(`${origin}/api/v9/auth/register`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                email: fixture.email,
                username: `gif${suffix}`,
                password: fixture.password,
                date_of_birth: "2000-01-01",
                consent: true,
                captcha_key,
            }),
        });
        assert.equal(registered.status, 200, "Disposable Cap signup failed");
        fixture.token = (await registered.json()).token;
        const self = await fetch(`${origin}/api/v9/users/@me`, {
            headers: { authorization: fixture.token },
        });
        assert.equal(self.status, 200);
        fixture.id = (await self.json()).id;
        return fixture;
    };
    const viewer = await signup();
    const recipient = await signup();
    console.log(JSON.stringify({ fixturesCreated: 2 }));
    const dm = await fetch(`${origin}/api/v9/users/@me/channels`, {
        method: "POST",
        headers: { authorization: viewer.token, "content-type": "application/json" },
        body: JSON.stringify({ recipients: [recipient.id] }),
    });
    assert.equal(dm.status, 200);
    fixtureChannel = (await dm.json()).id;
    const context = await browser.newContext();
    await context.addInitScript((value) => localStorage.setItem("token", JSON.stringify(value)), token);
    page = await context.newPage();
    await page.goto(`${origin}/admin/#/settings`);
    await page.locator("#gif-save").waitFor({ timeout: 30000 });
    assert.equal(await page.locator("#gif-klipy-key").inputValue(), "");
    assert.equal(await page.locator("#gif-klipy-key").getAttribute("type"), "password");
    await page.locator("#gif-save").click();
    await page.getByText("GIF settings saved", { exact: true }).waitFor();
    await context.close();
    const nativeContext = await browser.newContext();
    await nativeContext.addInitScript((value) => localStorage.setItem("token", JSON.stringify(value)), viewer.token);
    page = await nativeContext.newPage();
    await page.goto(`${origin}/channels/@me/${fixtureChannel}`);
    await page.getByRole("button", { name: "User Settings", exact: true }).waitFor({ timeout: 45000 });
    const artifactDirectory = process.env.GIF_ARTIFACT_DIR;
    if (artifactDirectory) mkdirSync(artifactDirectory, { recursive: true });
    const passwordPrompt = page.locator("dialog.fe2ee-dialog[open]");
    await passwordPrompt.waitFor({ timeout: 15000 }).catch(() => {});
    if (await passwordPrompt.count()) {
        await passwordPrompt.getByLabel("Account password", { exact: true }).fill(viewer.password);
        await passwordPrompt.getByRole("button", { name: "Continue", exact: true }).click();
        await passwordPrompt.waitFor({ state: "hidden", timeout: 30000 });
    }
    const openGifSettings = async () => {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
        await page.getByRole("button", { name: "User Settings", exact: true }).click();
        await page.getByText("Edit Profiles", { exact: true }).waitFor();
        if (await page.locator("dialog.fe2ee-dialog[open]").count()) await page.keyboard.press("Escape");
        await page.getByText("GIFs", { exact: true }).click();
        await page.getByRole("combobox", { name: "GIF provider", exact: true }).waitFor();
    };
    await openGifSettings();
    const selector = page.getByRole("combobox", { name: "GIF provider", exact: true });
    await selector.selectOption("tenor");
    if (artifactDirectory) await page.screenshot({ path: path.join(artifactDirectory, "gif-settings.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open GIF picker", exact: true }).click();
    assert.equal(await page.getByRole("combobox", { name: "GIF provider", exact: true }).count(), 0, "The GIF picker must not contain provider controls");
    const responsePromise = page.waitForResponse((response) => response.url().includes("/gifs/search?") && response.url().includes("provider=tenor"));
    await page.getByRole("textbox").last().fill("cat");
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    const gifResults = await response.json();
    assert.ok(gifResults.length > 0);
    const previewNames = gifResults
        .flatMap((gif) => [gif.src, gif.gif_src, gif.preview])
        .filter(Boolean)
        .map((url) => new URL(url).pathname.split("/").pop());
    await page.waitForFunction(
        (names) =>
            [...document.images].some((image) => image.complete && image.naturalWidth > 0 && names.some((name) => image.currentSrc.includes(name))) ||
            [...document.querySelectorAll("video")].some((video) => video.readyState >= 2 && video.videoWidth > 0 && names.some((name) => video.currentSrc.includes(name))),
        previewNames,
        { timeout: 20000 },
    );
    if (artifactDirectory) await page.screenshot({ path: path.join(artifactDirectory, "gif-picker.png") });
    await page.keyboard.press("Escape");
    await openGifSettings();
    await selector.selectOption("klipy");
    assert.equal(await page.evaluate(() => localStorage.getItem("fosscord.gifProvider")), "klipy");
    await page.reload();
    await page.getByRole("button", { name: "User Settings", exact: true }).waitFor();
    await openGifSettings();
    assert.equal(await selector.inputValue(), "klipy", "Provider preference must survive a reload");
    console.log(
        JSON.stringify({
            admin_key_masked: true,
            invalid_provider_rejected: true,
            settings_provider_control: true,
            picker_provider_control_absent: true,
            tenor_live_search: true,
            tenor_preview_rendered: true,
            klipy_selection_persisted: true,
        }),
    );
} catch (error) {
    if (page) {
        await page.screenshot({ path: "/tmp/gif-smoke-failure.png" });
        console.log(
            JSON.stringify({
                failedPath: new URL(page.url()).pathname,
                visibleDialogCount: await page.getByRole("dialog").count(),
            }),
        );
    }
    throw error;
} finally {
    try {
        await browser.close();
    } finally {
        const logout = await fetch(`${origin}/api/v9/auth/logout`, {
            method: "POST",
            headers: { authorization: token, "content-type": "application/json" },
            body: "{}",
        });
        assert.equal(logout.status, 204, "The admin smoke session must be revoked");
        await db.query("BEGIN");
        try {
            if (fixtureChannel) {
                const recipients = await db.query("SELECT user_id FROM recipients WHERE channel_id = $1", [fixtureChannel]);
                assert.equal(recipients.rows.length, 2);
                assert.ok(
                    recipients.rows.every((row) => fixtures.some((fixture) => fixture.id === row.user_id)),
                    "Delete only our synthetic DM",
                );
                await db.query("DELETE FROM channels WHERE id = $1", [fixtureChannel]);
            }
            for (const fixture of fixtures) {
                const row = await db.query('SELECT id, "settingsIndex" FROM users WHERE email = $1', [fixture.email]);
                if (!row.rows.length) continue;
                assert.equal(row.rows.length, 1);
                const id = row.rows[0].id;
                if (fixture.id) assert.equal(id, fixture.id);
                await db.query("DELETE FROM user_settings_protos WHERE user_id = $1", [id]);
                await db.query("DELETE FROM users WHERE id = $1 AND email = $2", [id, fixture.email]);
                if (row.rows[0].settingsIndex != null) await db.query('DELETE FROM user_settings WHERE "index" = $1', [row.rows[0].settingsIndex]);
                assert.equal(Number((await db.query("SELECT count(*) AS remaining FROM users WHERE id = $1", [id])).rows[0].remaining), 0);
            }
            await db.query("COMMIT");
        } catch (error) {
            await db.query("ROLLBACK");
            throw error;
        } finally {
            await db.end();
        }
    }
}
