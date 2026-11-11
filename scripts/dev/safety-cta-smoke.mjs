import { solveCap } from "./cap-token.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromiumPath } from "../util/chromium.cjs";
const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");
assert.equal(process.env.SAFETY_CTA_SMOKE, "1", "Set SAFETY_CTA_SMOKE=1 to run disposable live fixtures");
const port = process.env.PORT || "3290",
    origin = `http://fosscord.localhost:${port}`,
    api = `${origin}/api/v9`;
const env = Object.fromEntries(
    readFileSync(process.env.SAFETY_CTA_DEMO_ENV || "/tmp/fosscord-admin-perf/.env", "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
assert.equal(new URL(env.DATABASE).pathname, "/fosscord_codex_admin");
const sql = (query) => execFileSync("psql", [env.DATABASE, "-At", "-c", query], { encoding: "utf8" }).trim();
const suffix = randomBytes(5).toString("hex"),
    password = randomBytes(18).toString("hex"),
    email = `official-inbox-${suffix}@fosscord.test`;
let token, id, context, page;
const profile = mkdtempSync(join(tmpdir(), "fosscord-official-inbox-render-"));
const errors = [];
async function call(method, path, body) {
    const response = await fetch(`${api}${path}`, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
        body: body && JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
}
async function wait(check, label) {
    for (let i = 0; i < 120; i++) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw Error(`Timed out: ${label}`);
}
try {
    const registration = await call("POST", "/auth/register", {
        email,
        username: `officialinbox${suffix}`,
        password,
        date_of_birth: "2000-01-01",
        consent: true,
        captcha_key: await solveCap({ origin: `http://localhost:${port}` }),
    });
    assert.equal(registration.status, 200);
    token = registration.body.token;
    assert.equal(typeof token, "string");
    id = (await call("GET", "/users/@me")).body.id;
    assert.match(id, /^\d+$/);
    sql(`UPDATE users SET rights=rights | 1 WHERE id='${id}'`);
    context = await chromium.launchPersistentContext(profile, {
        executablePath: chromiumPath(),
        headless: true,
        viewport: { width: 1280, height: 900 },
        colorScheme: "dark",
    });
    page = context.pages()[0] || (await context.newPage());
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/login`);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/channels\//, { timeout: 30000 });
    await wait(() => Number(sql(`SELECT count(*) FROM e2ee_devices WHERE user_id='${id}' AND status='active'`)) > 0, "native recipient encryption initialization");
    const changed = await call("PATCH", `/admin/users/${id}`, { account_standing: 200 });
    assert.equal(changed.status, 200);
    let notice;
    await wait(async () => {
        const response = await call("GET", `/admin/conversations/${id}`);
        notice = response.body?.messages?.find((message) => message.content.includes("Your account is limited"));
        return !!notice;
    }, "encrypted standing notice");
    const inbox = await call("GET", `/admin/conversations/${id}`);
    const channelId = inbox.body.channel_id;
    assert.ok(notice.content.includes("Review Account Standing"));
    assert.equal(notice.content.includes("**icon_type**"), false);
    await page.goto(`${origin}/channels/@me/${channelId}`);
    const message = page.locator(`#message-content-${notice.id}`);
    await message.getByText("Your account is limited", { exact: true }).waitFor({ timeout: 30000 });
    const review = message.getByRole("link", { name: "Review Account Standing", exact: true });
    await review.waitFor();
    await wait(async () => (await review.getAttribute("href")) === origin + "/settings/account/account-standing", "same-origin CTA localization");
    await page.screenshot({ path: "/tmp/fosscord-safety-notice-dm.png" });
    await review.click();
    await page.getByText("Account Standing", { exact: true }).first().waitFor({ timeout: 20000 });
    assert.equal(new URL(page.url()).origin, origin);
    await page.getByText("Account Standing", { exact: true }).first().waitFor();
    await page.screenshot({ path: "/tmp/fosscord-safety-notice-standing.png" });
    const legacy =
        "**icon_type**\ndanger\n\n**theme**\ndanger\n\n**header**\nLegacy limited notice\n\n**body**\nReview violations and appeal incorrect decisions.\n\n**timestamp**\n1791135304\n\n**ctas**\n";
    const posted = await call("POST", `/admin/conversations/${id}`, { content: legacy });
    assert.equal(posted.status, 201);
    await page.goto(`${origin}/channels/@me/${channelId}`);
    const old = page.locator(`#message-content-${posted.body.id}`);
    await old.getByText("Legacy limited notice", { exact: true }).waitFor({ timeout: 20000 });
    assert.equal((await old.innerText()).includes("icon_type"), false);
    const oldReview = old.getByRole("link", { name: "Review Account Standing", exact: true });
    await oldReview.waitFor();
    await oldReview.click();
    await page.getByText("Account Standing", { exact: true }).first().waitFor({ timeout: 20000 });
    assert.equal(new URL(page.url()).origin, origin);
    const persisted = sql(`SELECT content FROM messages WHERE id='${notice.id}'`);
    assert.equal(persisted, "🔒 Encrypted message");
    assert.deepEqual(errors, []);
    console.log("PASS encrypted standing notice is readable, new/legacy DM CTAs open native same-origin Account Standing, ciphertext-only storage, zero page errors");
} catch (error) {
    if (page) {
        await page.screenshot({ path: "/tmp/fosscord-safety-failure.png" }).catch(() => {});
        writeFileSync("/tmp/fosscord-safety-failure.json", JSON.stringify({ message: error.message, url: page.url() }, null, 2));
    }
    throw error;
} finally {
    if (context) await context.close();
    if (id) {
        sql(
            `DELETE FROM audit_logs WHERE user_id='${id}'; DELETE FROM channels WHERE id IN (SELECT channel_id FROM recipients WHERE user_id='${id}'); DELETE FROM user_settings_protos WHERE user_id='${id}'; DELETE FROM users WHERE id='${id}'`,
        );
    }
    rmSync(profile, { recursive: true, force: true });
}
