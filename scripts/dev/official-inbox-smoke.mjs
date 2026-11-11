import { solveCap } from "./cap-token.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chromiumPath } from "../util/chromium.cjs";
const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");
assert.equal(process.env.OFFICIAL_INBOX_SMOKE, "1", "Set OFFICIAL_INBOX_SMOKE=1 to run disposable live fixtures");
const port = process.env.PORT || "3290",
    origin = `http://fosscord.localhost:${port}`,
    api = `${origin}/api/v9`;
const env = Object.fromEntries(
    readFileSync(process.env.OFFICIAL_INBOX_DEMO_ENV || "/tmp/fosscord-admin-perf/.env", "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
assert.equal(new URL(env.DATABASE).pathname, "/fosscord_codex_admin");
const sql = (query) => execFileSync("psql", [env.DATABASE, "-At", "-c", query], { encoding: "utf8" }).trim();
const suffix = randomBytes(5).toString("hex"),
    password = randomBytes(18).toString("hex"),
    email = `official-inbox-${suffix}@fosscord.test`;
let token, id, context;
let sentId, replyId;
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
    const page = context.pages()[0] || (await context.newPage());
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/login`);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/channels\//, { timeout: 30000 });
    await wait(() => Number(sql(`SELECT count(*) FROM e2ee_devices WHERE user_id='${id}' AND status='active'`)) > 0, "native recipient encryption initialization");
    const admin = await context.newPage();
    admin.on("pageerror", (error) => errors.push(error.message));
    await admin.goto(`${origin}/admin/#official`);
    await admin.locator("#official-search").waitFor({ timeout: 20000 });
    await admin.getByLabel("Search users", { exact: true }).fill(`officialinbox${suffix}`);
    await admin.locator(`[data-official-user="${id}"]`).click();
    await admin.locator("#official-send").waitFor({ timeout: 20000 });
    const content = `Official encrypted native proof ${suffix}`;
    const reply = `Native encrypted recipient reply ${suffix}`;
    await admin.locator('#official-send textarea[name="content"]').fill(content);
    const posted = admin.waitForResponse((response) => response.url().includes(`/admin/conversations/${id}`) && response.request().method() === "POST");
    await admin.getByRole("button", { name: "Send as Official", exact: true }).click();
    const response = await posted;
    assert.equal(response.status(), 201);
    const result = await response.json();
    sentId = result.id;
    const channelId = result.channel_id;
    assert.match(channelId, /^\d+$/);
    await admin.getByText(content, { exact: true }).waitFor({ timeout: 20000 });
    await page.goto(`${origin}/channels/@me/${channelId}`);
    await page.getByText(content, { exact: true }).waitFor({ timeout: 30000 });
    const editor = page.locator('[role="textbox"][contenteditable="true"]').first();
    await editor.waitFor({ timeout: 20000 });
    await editor.fill(reply);
    const replied = page.waitForResponse((response) => response.url().includes(`/channels/${channelId}/messages`) && response.request().method() === "POST");
    await editor.press("Enter");
    const replyResponse = await replied;
    if (replyResponse.status() !== 200) console.log("Native reply denial:", await replyResponse.text());
    assert.equal(replyResponse.status(), 200);
    replyId = (await replyResponse.json()).id;
    await page.getByText(reply, { exact: true }).waitFor({ timeout: 20000 });
    const inbox = await call("GET", `/admin/conversations/${id}`);
    assert.equal(inbox.status, 200);
    assert.equal(inbox.body.messages.find((message) => message.id === replyId)?.content, reply);
    assert.equal(inbox.body.messages.find((message) => message.id === sentId)?.content, content);
    await admin.getByRole("button", { name: "Refresh", exact: true }).click();
    await admin.getByText(reply, { exact: true }).waitFor({ timeout: 20000 });
    const stored = JSON.parse(
        sql(`SELECT json_agg(json_build_object('id',id::text,'content',content,'encrypted',encrypted,'nonce',nonce)) FROM messages WHERE id IN ('${sentId}','${replyId}')`),
    );
    assert.equal(stored.length, 2);
    for (const message of stored) {
        assert.equal(message.content, "🔒 Encrypted message");
        assert.ok(message.encrypted);
        assert.equal(JSON.stringify(message).includes(content), false);
        assert.equal(JSON.stringify(message).includes(reply), false);
    }
    const audit = JSON.parse(sql(`SELECT json_agg(json_build_object('changes',changes,'options',options)) FROM audit_logs WHERE user_id='${id}' AND action_type=2001`));
    assert.equal(audit.length, 1);
    assert.equal(audit[0].options.message_id, sentId);
    assert.equal(JSON.stringify(audit).includes(content), false);
    assert.equal(JSON.stringify(audit).includes(reply), false);
    await page.screenshot({ path: "/tmp/fosscord-official-inbox-native.png" });
    await admin.screenshot({ path: "/tmp/fosscord-official-inbox-admin.png" });
    sql(`UPDATE users SET rights=128 WHERE id='${id}'`);
    assert.equal((await call("GET", `/admin/users/${id}`)).status, 200);
    assert.equal((await call("GET", `/admin/conversations/${id}`)).status, 403);
    assert.equal((await call("GET", "/admin/conversations")).status, 403);
    assert.equal((await call("POST", `/admin/conversations/${id}`, { content: "denied fixture" })).status, 403);
    assert.deepEqual(errors, []);
    console.log(
        "PASS native Official encrypted send/reply, dashboard decrypted reply, ciphertext-only persisted messages, metadata-only audit, MANAGE_USERS-only denied, zero browser errors",
    );
} finally {
    if (context) await context.close();
    if (id) {
        sql(
            `DELETE FROM audit_logs WHERE user_id='${id}'; DELETE FROM channels WHERE id IN (SELECT channel_id FROM recipients WHERE user_id='${id}'); DELETE FROM users WHERE id='${id}'`,
        );
    }
    rmSync(profile, { recursive: true, force: true });
}
