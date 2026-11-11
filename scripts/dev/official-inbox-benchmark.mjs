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
    for (let i = 0; i < 20; i++) {
        const sent = await call("POST", `/admin/conversations/${id}`, {
            content: `Official benchmark fixture ${suffix} item ${i}`,
        });
        assert.equal(sent.status, 201);
    }
    const timings = [];
    for (let i = 0; i < 23; i++) {
        const start = performance.now();
        const history = await call("GET", `/admin/conversations/${id}`);
        const elapsed = performance.now() - start;
        assert.equal(history.status, 200);
        assert.equal(history.body.messages.length, 20);
        assert.ok(history.body.messages.every((message) => message.readable && message.content.startsWith("Official benchmark fixture")));
        if (i >= 3) timings.push(elapsed);
    }
    timings.sort((a, b) => a - b);
    console.log(
        JSON.stringify({
            fixture_messages: 20,
            warmup: 3,
            samples: 20,
            p50_ms: +timings[9].toFixed(2),
            p95_ms: +timings[18].toFixed(2),
            min_ms: +timings[0].toFixed(2),
            max_ms: +timings[19].toFixed(2),
            all_readable: true,
        }),
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
