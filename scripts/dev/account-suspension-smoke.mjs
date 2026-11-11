import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";
import { solveCap } from "./cap-token.mjs";
import { chromiumPath } from "../util/chromium.cjs";

if (process.env.RUN_SUSPENSION_SMOKE !== "1") throw new Error("Set RUN_SUSPENSION_SMOKE=1 for disposable-account integration");
const origin = process.env.ORIGIN || "http://fosscord.localhost:3290";
assert.ok(["localhost", "127.0.0.1", "fosscord.localhost"].includes(new URL(origin).hostname));
const env = parseEnv(String(readFileSync(process.env.DOTENV_CONFIG_PATH || ".env")));
const database = process.env.DATABASE || env.DATABASE;
assert.equal(new URL(database).pathname, "/fosscord_codex_admin");
assert.ok(["localhost", "127.0.0.1"].includes(new URL(database).hostname));
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const WebSocket = require("ws");
const { chromium } = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const db = new Client({ connectionString: database });
const fixtures = [];
const gateways = [];
let channelId;
let applicationId;
let messageId;
const browser = await chromium.launch({
    executablePath: chromiumPath(),
    headless: true,
});
const call = async (method, route, token, body) => {
    const response = await fetch(`${origin}/api/v9${route}`, {
        method,
        headers: { ...(token ? { authorization: token } : {}), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
    });
    let data = null;
    try {
        data = await response.json();
    } catch {}
    return { status: response.status, data };
};
const expect = (response, status, label) => {
    assert.equal(response.status, status, label);
    return response.data;
};
const wait = async (predicate, label, timeout = 10000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out: ${label}`);
};
const gateway = (token) => {
    const endpoint = new URL(origin);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    endpoint.pathname = "/";
    endpoint.search = "?v=9&encoding=json";
    const socket = new WebSocket(endpoint, {
        headers: { origin, "user-agent": "Mozilla/5.0 isolated suspension regression" },
    });
    const state = {
        socket,
        ready: false,
        closed: false,
        code: null,
        invalid: false,
        acknowledgements: 0,
    };
    let heartbeat;
    let sequence = null;
    socket.on("error", () => {});
    socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString());
        if (message.s != null) sequence = message.s;
        if (message.op === 10) {
            heartbeat = setInterval(() => {
                if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ op: 1, d: sequence }));
            }, message.d.heartbeat_interval);
            socket.send(
                JSON.stringify({
                    op: 2,
                    d: {
                        token,
                        capabilities: 16381,
                        properties: { os: "Mac OS X", browser: "Chrome", device: "suspension regression" },
                    },
                }),
            );
        }
        if (message.op === 0 && message.t === "READY") state.ready = true;
        if (message.op === 9) state.invalid = true;
        if (message.op === 11) state.acknowledgements++;
    });
    socket.on("close", (code) => {
        clearInterval(heartbeat);
        state.closed = true;
        state.code = code;
    });
    gateways.push(state);
    return state;
};
try {
    await db.connect();
    const signup = async (label) => {
        const suffix = randomBytes(6).toString("hex");
        const fixture = {
            label,
            email: `suspension-smoke-${label}-${suffix}@fosscord.test`,
            password: `Aa2!${randomBytes(18).toString("hex")}`,
        };
        fixtures.push(fixture);
        const captcha_key = await solveCap({ origin, browser });
        fixture.token = expect(
            await call("POST", "/auth/register", null, {
                email: fixture.email,
                username: `suspend${suffix}`,
                password: fixture.password,
                date_of_birth: "2000-01-01",
                consent: true,
                captcha_key,
            }),
            200,
            "Cap registration",
        ).token;
        const user = expect(await call("GET", "/users/@me", fixture.token), 200, "Own user");
        fixture.id = user.id;
        const stored = (await db.query("SELECT rights FROM users WHERE id=$1 AND email=$2", [fixture.id, fixture.email])).rows[0];
        assert.ok(stored);
        assert.equal(BigInt(stored.rights) & 1n, 0n, "Normal fixture is not an operator");
        return fixture;
    };
    const target = await signup("target"),
        witness = await signup("witness"),
        admin = await signup("admin");
    const adminRow = (await db.query("SELECT rights FROM users WHERE id=$1 AND email=$2", [admin.id, admin.email])).rows[0];
    assert.ok(adminRow);
    await db.query("UPDATE users SET rights=$3 WHERE id=$1 AND email=$2", [admin.id, admin.email, (BigInt(adminRow.rights) | 128n).toString()]);
    admin.token = expect(await call("POST", "/auth/login", null, { login: admin.email, password: admin.password }), 200, "Scoped administrator login").token;
    expect(await call("GET", `/admin/users/${target.id}`, admin.token), 200, "MANAGE_USERS access");
    for (const [actor, peer] of [
        [target, witness],
        [witness, target],
    ])
        expect(await call("PUT", `/users/@me/relationships/${peer.id}`, actor.token, {}), 204, "Fixture friendship");
    channelId = expect(await call("POST", "/users/@me/channels", target.token, { recipients: [witness.id] }), 200, "Target DM").id;
    assert.equal(expect(await call("POST", "/users/@me/channels", witness.token, { recipients: [target.id] }), 200, "Witness opens DM").id, channelId);
    const native = async (fixture) => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        const page = await context.newPage();
        await page.goto(`${origin}/login`);
        await page.locator('input[name="email"]').fill(fixture.email);
        await page.locator('input[name="password"]').fill(fixture.password);
        await page.locator('button[type="submit"]').click();
        await page.getByRole("button", { name: "User Settings", exact: true }).waitFor({ timeout: 45000 });
        await page.goto(`${origin}/channels/@me/${channelId}`);
        await page.bringToFront();
        await page.locator('[contenteditable="true"][role="textbox"]').waitFor({ timeout: 45000 });
        await page.waitForFunction(() => window.__fosscordE2ee?.status?.()?.ready === true, null, {
            timeout: 45000,
        });
        return page;
    };
    const witnessPage = await native(witness),
        targetPage = await native(target);
    const secondToken = await targetPage.evaluate(() => JSON.parse(localStorage.getItem("token")));
    assert.ok(secondToken && secondToken !== target.token);
    const text = `Suspension retention fixture ${randomBytes(6).toString("hex")}`;
    const sent = targetPage.waitForResponse((response) => new URL(response.url()).pathname === `/api/v9/channels/${channelId}/messages` && response.request().method() === "POST", {
        timeout: 30000,
    });
    await targetPage.locator('[role="textbox"]').first().fill(text);
    await targetPage.locator('[role="textbox"]').first().press("Enter");
    const response = await sent;
    assert.equal(response.status(), 200);
    const message = await response.json();
    messageId = message.id;
    assert.ok(message.encrypted?.ct);
    await witnessPage.bringToFront();
    await witnessPage.waitForFunction(
        ({ channel, id, text }) => window.Vencord.Webpack.Common.MessageStore.getMessage(channel, id)?.content === text,
        { channel: channelId, id: messageId, text },
        { timeout: 30000 },
    );
    applicationId = (BigInt(Date.now()) * 4096n + BigInt(randomBytes(2).readUInt16BE() % 4096)).toString();
    await db.query("INSERT INTO applications(id,name,hook,bot_public,bot_require_code_grant,verify_key,flags,owner_id) VALUES($1,$2,false,false,false,$3,0,$4)", [
        applicationId,
        "Suspension OAuth Fixture",
        randomBytes(32).toString("hex"),
        target.id,
    ]);
    const oauth = randomBytes(32).toString("base64url");
    const oauthId = (BigInt(applicationId) + 1n).toString();
    await db.query("INSERT INTO oauth2_tokens(id,user_id,application_id,scopes,access_token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')", [
        oauthId,
        target.id,
        applicationId,
        JSON.stringify(["identify"]),
        createHash("sha256").update(oauth).digest("base64url"),
    ]);
    expect(await call("GET", "/oauth2/@me", `Bearer ${oauth}`), 200, "Owned OAuth bearer before suspension");
    const targetOne = gateway(target.token),
        targetTwo = gateway(secondToken),
        control = gateway(witness.token);
    await wait(() => targetOne.ready && targetTwo.ready && control.ready, "Three gateway READY events", 20000);
    const witnessSessions = Number((await db.query("SELECT count(*) n FROM sessions WHERE user_id=$1", [witness.id])).rows[0].n);
    assert.equal(Number((await db.query("SELECT count(*) n FROM sessions WHERE user_id=$1", [target.id])).rows[0].n), 2, "Exactly two target sessions");
    const retained = (await db.query("SELECT encrypted FROM messages WHERE id=$1 AND channel_id=$2", [messageId, channelId])).rows[0].encrypted;
    expect(await call("PATCH", `/admin/users/${target.id}`, admin.token, { account_standing: 500 }), 200, "Suspend target");
    await wait(() => targetOne.closed && targetTwo.closed, "Both suspended target sockets close");
    assert.equal(targetOne.code, 4006);
    assert.equal(targetTwo.code, 4006);
    assert.ok(targetOne.invalid && targetTwo.invalid);
    assert.equal(control.closed, false, "Unrelated socket remains open");
    const beforeAck = control.acknowledgements;
    control.socket.send(JSON.stringify({ op: 1, d: null }));
    await wait(() => control.acknowledgements > beforeAck, "Unrelated gateway heartbeat ACK");
    assert.equal(Number((await db.query("SELECT count(*) n FROM sessions WHERE user_id=$1", [target.id])).rows[0].n), 0);
    assert.equal(Number((await db.query("SELECT count(*) n FROM sessions WHERE user_id=$1", [witness.id])).rows[0].n), witnessSessions);
    expect(await call("GET", "/users/@me", target.token), 401, "First revoked session denied");
    expect(await call("GET", "/users/@me", secondToken), 401, "Second revoked session denied");
    const suspendedLogin = await call("POST", "/auth/login", null, {
        login: target.email,
        password: target.password,
    });
    assert.ok([400, 403].includes(suspendedLogin.status));
    expect(await call("GET", "/oauth2/@me", `Bearer ${oauth}`), 401, "OAuth bearer blocked while suspended");
    expect(await call("GET", "/users/@me", witness.token), 200, "Witness token unaffected");
    const standing = (await db.query("SELECT account_standing,disabled,deleted FROM users WHERE id=$1", [target.id])).rows[0];
    assert.equal(standing.account_standing, 500);
    assert.equal(standing.disabled, false);
    assert.equal(standing.deleted, false);
    expect(await call("PATCH", `/admin/users/${target.id}`, admin.token, { account_standing: 100 }), 200, "Reverse suspension");
    const fresh = expect(await call("POST", "/auth/login", null, { login: target.email, password: target.password }), 200, "Fresh login after reversal").token;
    assert.equal(expect(await call("GET", "/users/@me", fresh), 200, "Fresh session usable").id, target.id);
    expect(await call("GET", "/users/@me", target.token), 401, "Revoked session stays invalid after reversal");
    expect(await call("GET", "/oauth2/@me", `Bearer ${oauth}`), 200, "OAuth standing reversal");
    const history = expect(await call("GET", `/channels/${channelId}/messages?limit=10`, fresh), 200, "Retained history after reversal");
    assert.ok(history.some((item) => item.id === messageId));
    assert.deepEqual((await db.query("SELECT encrypted FROM messages WHERE id=$1 AND channel_id=$2", [messageId, channelId])).rows[0].encrypted, retained);
    assert.equal(control.closed, false);
    console.log(
        JSON.stringify({
            status: "pass",
            targetSessionsRevoked: 2,
            targetGatewayClosures: [targetOne.code, targetTwo.code],
            unrelatedGatewayHeartbeat: true,
            unrelatedSessionsPreserved: true,
            suspendedLogin: suspendedLogin.status,
            suspendedJwt: 401,
            suspendedOAuth: 401,
            reversedLogin: 200,
            oldSessionStillDenied: 401,
            encryptedHistoryRetained: true,
            oauthCredentialSource: "owned seeded fixture; real HTTP authorization checks",
        }),
    );
} finally {
    for (const gateway of gateways) gateway.socket.terminate();
    await browser.close();
    await db.query("BEGIN");
    try {
        if (channelId) {
            const rows = (await db.query("SELECT user_id FROM recipients WHERE channel_id=$1", [channelId])).rows;
            assert.equal(rows.length, 2);
            assert.ok(rows.every((row) => fixtures.slice(0, 2).some((f) => f.id === row.user_id)));
            await db.query("DELETE FROM channels WHERE id=$1", [channelId]);
        }
        if (applicationId) {
            assert.equal((await db.query("SELECT owner_id FROM applications WHERE id=$1", [applicationId])).rows[0]?.owner_id, fixtures[0].id);
            await db.query("DELETE FROM applications WHERE id=$1 AND owner_id=$2", [applicationId, fixtures[0].id]);
        }
        for (const fixture of fixtures) {
            const rows = (await db.query('SELECT id,"settingsIndex" FROM users WHERE email=$1', [fixture.email])).rows;
            if (!rows.length) continue;
            assert.equal(rows.length, 1);
            if (fixture.id) assert.equal(rows[0].id, fixture.id);
            const id = rows[0].id;
            await db.query("DELETE FROM audit_logs WHERE user_id=$1", [id]);
            await db.query("DELETE FROM user_settings_protos WHERE user_id=$1", [id]);
            await db.query("DELETE FROM users WHERE id=$1 AND email=$2", [id, fixture.email]);
            if (rows[0].settingsIndex != null) await db.query('DELETE FROM user_settings WHERE "index"=$1', [rows[0].settingsIndex]);
            assert.equal(Number((await db.query("SELECT count(*) n FROM users WHERE id=$1", [id])).rows[0].n), 0);
        }
        await db.query("COMMIT");
        console.log(JSON.stringify({ ownFixturesCleaned: true }));
    } catch (error) {
        await db.query("ROLLBACK");
        throw error;
    } finally {
        await db.end();
    }
}
