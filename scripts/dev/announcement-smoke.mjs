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
const port = process.env.PORT || "3290",
    origin = `http://fosscord.localhost:${port}`,
    api = `${origin}/api/v9`;
const env = Object.fromEntries(
    readFileSync(new URL("../../.env", import.meta.url), "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
assert.equal(new URL(env.DATABASE).pathname, "/fosscord_codex_admin");
const sql = (query) => execFileSync("psql", [env.DATABASE, "-At", "-c", query], { encoding: "utf8" }).trim();
const suffix = randomBytes(5).toString("hex"),
    password = randomBytes(18).toString("hex"),
    email = `announcement-${suffix}@fosscord.test`;
let token, id, announcementId, context;
const profile = mkdtempSync(join(tmpdir(), "fosscord-announcement-render-"));
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
        username: `announcement${suffix}`,
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
    await admin.goto(`${origin}/admin/#announcements`);
    await admin.locator("#announce-form").waitFor({ timeout: 20000 });
    const content = `Encrypted announcement rendered ${suffix}`;
    await admin.locator('select[name="audience"]').selectOption("selected");
    await admin.locator('textarea[name="recipient_ids"]').fill(id);
    await admin.locator('textarea[name="body"]').fill(content);
    await admin.locator('input[name="files"]').setInputFiles({
        name: "announcement-proof.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Encrypted announcement attachment proof"),
    });
    const posted = admin.waitForResponse((response) => response.url().includes("/admin/announcements") && response.request().method() === "POST");
    await admin.getByRole("button", { name: "Send announcement", exact: true }).click();
    const response = await posted;
    assert.equal(response.status(), 201);
    const result = await response.json();
    announcementId = result.id;
    assert.equal(result.audience, "selected");
    assert.equal(result.recipient_count, 1);
    await wait(async () => {
        const state = (await call("GET", "/admin/announcements")).body.announcements.find((a) => a.id === announcementId);
        return state?.delivery.delivered === 1;
    }, "durable delivery count");
    const [channelId, messageId] = sql(`SELECT channel_id,message_id FROM announcement_messages WHERE announcement_id='${announcementId}'`).split("|");
    assert.match(channelId, /^\d+$/);
    assert.match(messageId, /^\d+$/);
    const stored = JSON.parse(sql(`SELECT json_build_object('content',content,'encrypted',encrypted,'nonce',nonce) FROM messages WHERE id='${messageId}'`));
    assert.equal(stored.content, "🔒 Encrypted message");
    assert.ok(stored.encrypted);
    assert.equal(stored.nonce, messageId);
    assert.equal(JSON.stringify(stored.encrypted).includes(content), false);
    await page.goto(`${origin}/channels/@me/${channelId}`);
    await page.getByText(content, { exact: true }).waitFor({ timeout: 30000 });
    await page.getByText("announcement-proof.txt", { exact: true }).first().waitFor({ timeout: 20000 });
    await page.screenshot({ path: "/tmp/fosscord-announcement-native.png" });
    const attachments = JSON.parse(
        sql(`SELECT coalesce(json_agg(json_build_object('id',id::text,'filename',filename,'content_type',content_type)), '[]') FROM attachments WHERE message_id='${messageId}'`),
    );
    assert.equal(attachments.length, 1);
    assert.match(attachments[0].filename, /^[a-f0-9]{32}\.bin$/);
    assert.equal(attachments[0].content_type, "application/octet-stream");
    const attachmentUrl = `${origin}/e2ee/attachments/${channelId}/${attachments[0].id}/announcement-proof.txt`;
    const downloaded = await page.evaluate(async (url) => {
        const response = await fetch(url);
        return { status: response.status, text: await response.text() };
    }, attachmentUrl);
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.text, "Encrypted announcement attachment proof");
    await page.waitForTimeout(500);
    await page.screenshot({ path: "/tmp/fosscord-announcement-native.png" });
    await admin.locator(`[data-id="${announcementId}"] .announcement-progress`).filter({ hasText: "1 delivered" }).waitFor({ timeout: 20000 });
    await admin.screenshot({ path: "/tmp/fosscord-announcement-admin.png" });
    assert.deepEqual(errors, []);
    console.log("PASS selected recipient native text/attachment decrypt, encrypted persisted message, accurate live admin counts, zero browser errors");
} finally {
    if (announcementId) await call("DELETE", `/admin/announcements/${announcementId}`);
    if (context) await context.close();
    if (id) {
        sql(`DELETE FROM channels WHERE id IN (SELECT channel_id FROM recipients WHERE user_id='${id}'); DELETE FROM users WHERE id='${id}'`);
    }
    rmSync(profile, { recursive: true, force: true });
}
