import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { solveCap } from "./cap-token.mjs";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const origin = process.env.ORIGIN || "http://localhost:3290";
assert.ok(["localhost", "fosscord.localhost", "127.0.0.1"].includes(new URL(origin).hostname));
process.loadEnvFile(process.env.FIXTURE_ENV || "/tmp/fosscord-admin-perf/.env");
assert.equal(new URL(process.env.DATABASE).pathname, "/fosscord_codex_admin");
const username = `resumesmoke${Date.now()}`;
const password = `${randomUUID()}A9`;
const sockets = [];
let fixtureId;
const call = async (method, pathname, token, body) => {
    const response = await fetch(`${origin}/api/v9${pathname}`, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
};
async function connect() {
    const socket = new WebSocket(`${origin.replace(/^http/, "ws")}/?encoding=json&v=9`, {
        headers: {
            "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
            origin,
        },
    });
    sockets.push(socket);
    const packets = [];
    let pending;
    socket.on("message", (data) => {
        packets.push(JSON.parse(String(data)));
        pending?.();
    });
    const receive = async (predicate, label = "packet") => {
        for (;;) {
            const index = packets.findIndex(predicate);
            if (index >= 0) return packets.splice(index, 1)[0];
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pending = undefined;
                    reject(new Error(`Gateway ${label} timeout`));
                }, 10000);
                pending = () => {
                    clearTimeout(timer);
                    pending = undefined;
                    resolve();
                };
            });
        }
    };
    await receive((packet) => packet.op === 10, "HELLO");
    return { socket, receive, send: (payload) => socket.send(JSON.stringify(payload)) };
}
const resume = (client, token, sessionId) => client.send({ op: 6, d: { token, session_id: sessionId, seq: 0 } });
try {
    const registration = await call("POST", "/auth/register", undefined, {
        username,
        password,
        consent: true,
        date_of_birth: "2000-01-01",
        captcha_key: await solveCap({ origin }),
    });
    assert.equal(registration.status, 200);
    const tokenA = registration.body.token;
    fixtureId = (await call("GET", "/users/@me", tokenA)).body.id;
    const login = await call("POST", "/auth/login", undefined, { login: username, password });
    assert.equal(login.status, 200);
    const tokenB = login.body.token;
    const didA = require("jsonwebtoken").decode(tokenA).did;
    const didB = require("jsonwebtoken").decode(tokenB).did;
    assert.notEqual(didA, didB);
    const original = await connect();
    original.send({
        op: 2,
        d: {
            token: tokenA,
            properties: { os: "Linux", browser: "Fosscord regression" },
            intents: 0,
            capabilities: 30717,
            presence: { status: "online", activities: [], afk: false, since: 0 },
            compress: false,
            client_state: { guild_versions: {} },
        },
    });
    const ready = await original.receive((packet) => packet.t === "READY", "READY");
    const gatewayId = ready.d.session_id;
    const disconnected = new Promise((resolve) => original.socket.once("close", resolve));
    original.socket.terminate();
    await disconnected;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const different = await connect();
    resume(different, tokenB, gatewayId);
    const denied = await different.receive((packet) => packet.op === 9 || packet.t === "RESUMED", "cross-device resume");
    assert.equal(denied.op, 9, "A second device token cannot take over the first device's revocation subscription");
    assert.equal(denied.d, false);
    different.socket.close(1000);
    const matching = await connect();
    resume(matching, tokenA, gatewayId);
    await matching.receive((packet) => packet.t === "RESUMED", "same-device resume");
    const closed = new Promise((resolve) => matching.socket.once("close", (code) => resolve(code)));
    assert.equal((await call("POST", "/auth/sessions/logout", tokenB, { session_ids: [didA] })).status, 204);
    const revocationClose = await closed;
    assert.equal(revocationClose, 4006, "The repository session-revocation close code is received");
    assert.equal((await call("GET", "/users/@me", tokenA)).status, 401);
    const revoked = await connect();
    resume(revoked, tokenA, gatewayId);
    const invalid = await revoked.receive((packet) => packet.op === 9, "revoked resume");
    assert.equal(invalid.d, false);
    revoked.socket.close(1000);
    assert.equal((await call("GET", "/users/@me", tokenB)).status, 200, "The other existing device token remains usable");
    console.log(
        JSON.stringify({
            status: "pass",
            crossDeviceResumeDenied: true,
            sameDeviceResume: true,
            targetedRevocationClose: revocationClose,
            revokedTokenStatus: 401,
            unaffectedTokenStatus: 200,
        }),
    );
} finally {
    for (const socket of sockets)
        if (socket.readyState === WebSocket.OPEN) socket.close(1000);
        else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    if (fixtureId) {
        const { Client } = require("pg");
        const db = new Client({ connectionString: process.env.DATABASE });
        await db.connect();
        const removed = await db.query("DELETE FROM users WHERE id=$1 AND username=$2", [fixtureId, username]);
        assert.equal(removed.rowCount, 1);
        await db.end();
        console.log("Removed exact isolated gateway-session fixture");
    }
}
