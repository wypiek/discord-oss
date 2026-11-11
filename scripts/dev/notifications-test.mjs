import crypto from "node:crypto";
import http from "node:http";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const port = process.env.PORT || "3001";
const api = `http://localhost:${port}/api/v9`;
const db = process.env.DATABASE?.split("/").pop() ?? readFileSync(new URL("../../.env", import.meta.url), "utf8").match(/^DATABASE=.*\/([^/\s]+)$/m)?.[1];
const sql = (query) => execFileSync("psql", ["-d", db, "-Atc", query], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const accounts = Object.fromEntries(
    readFileSync(new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
);
const call = async (method, path, token, body) => {
    const res = await fetch(`${api}${path}`, {
        method,
        headers: { "content-type": "application/json", ...(token && { authorization: token }) },
        body: body && JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
};
const login = async (login, password) => (await call("POST", "/auth/login", null, { login, password })).body.token;

sql("DELETE FROM rate_limits");
const tester = await login(accounts.TEST_EMAIL, accounts.TEST_PASSWORD);
const friend = await login("friend@fosscord.test", accounts.FRIEND_PASSWORD);
const me = (await call("GET", "/users/@me", tester)).body;
const them = (await call("GET", "/users/@me", friend)).body;
const guild = (await call("GET", "/users/@me/guilds", tester)).body[0];
const general = (await call("GET", `/guilds/${guild.id}/channels`, tester)).body.find((c) => c.type === 0 && c.name === "general");
const dm = (await call("GET", "/users/@me/channels", tester)).body.find((c) => c.recipients?.some((r) => r.id === them.id));
const E2EE_ALGORITHM = "x25519-hpke-aes256gcm-ed25519";
const key = (bytes) => crypto.randomBytes(bytes).toString("base64url");
for (const [index, user] of [me, them].entries())
    sql(
        `INSERT INTO e2ee_devices (id, user_id, signing_key, status, prekey_id, prekey_public, prekey_signature, prekey_updated_at, created_at) VALUES ('push-test-${user.id}', ${user.id}, '${key(32)}', 'active', ${index + 1}, '${key(32)}', '${key(64)}', now(), now()) ON CONFLICT (id) DO NOTHING`,
    );
const sealed = (token, extra = {}) => ({
    content: "",
    encrypted: {
        v: 1,
        alg: E2EE_ALGORITHM,
        sender_device: `push-test-${token === tester ? me.id : them.id}`,
        iv: key(12),
        ct: key(48),
        sig: key(64),
        keys: [me, them].map((user, index) => ({ user_id: user.id, device_id: `push-test-${user.id}`, prekey_id: index + 1, enc: key(32), wrapped: key(48) })),
    },
    ...extra,
});
const send = (token, channel, body) => call("POST", `/channels/${channel}/messages`, token, typeof body === "string" ? { content: body } : body);
const mentions = (user, channel) => Number(sql(`SELECT COALESCE((SELECT mention_count FROM read_states WHERE user_id = ${user} AND channel_id = ${channel}), 0)`));
const settings = (token, body, target = guild.id) => call("PATCH", `/users/@me/guilds/${target}/settings`, token, body);

const counts = async (label, action, channel, expected) => {
    const before = mentions(them.id, channel);
    await action();
    await sleep(300);
    assert.equal(mentions(them.id, channel) - before, expected, label);
    console.log(`ok   ${label}`);
};

sql(`UPDATE sessions SET status = 'offline' WHERE user_id = ${them.id}`);
await counts("@everyone counts as a mention", () => send(tester, general.id, "@everyone hello"), general.id, 1);
await settings(friend, { suppress_everyone: true });
await counts("suppress_everyone skips @everyone", () => send(tester, general.id, "@everyone again"), general.id, 0);
await settings(friend, { suppress_everyone: false });
await counts("@here skips offline members", () => send(tester, general.id, "@here anyone"), general.id, 0);
const hidden = (
    await call("POST", `/guilds/${guild.id}/channels`, tester, {
        name: `hidden-${Date.now() % 10000}`,
        type: 0,
        permission_overwrites: [{ id: guild.id, type: 0, allow: "0", deny: "1024" }],
    })
).body;
await counts("no mention count in a channel the member cannot see", () => send(tester, hidden.id, `@everyone <@${them.id}>`), hidden.id, 0);
await call("DELETE", `/channels/${hidden.id}`, tester);

const dmSettings = await settings(
    friend,
    {
        channel_overrides: {
            [dm.id]: { muted: true, mute_config: { selected_time_window: -1, end_time: null } },
        },
    },
    "@me",
);
assert.equal(dmSettings.status, 200, "partial dm override is accepted");
assert.equal(dmSettings.body.channel_overrides.find((o) => o.channel_id === dm.id)?.muted, true, "dm mute is stored");
await settings(friend, { channel_overrides: { [dm.id]: { muted: false, mute_config: null } } }, "@me");
console.log("ok   dm settings persist");

const mention = (await send(friend, general.id, `inbox <@${me.id}>`)).body;
assert.ok(
    (await call("GET", "/users/@me/mentions?limit=25", tester)).body.some((m) => m.id === mention.id),
    "mention is in the inbox",
);
assert.equal((await call("DELETE", `/users/@me/mentions/${mention.id}`, tester)).status, 204);
assert.ok(!(await call("GET", "/users/@me/mentions?limit=25", tester)).body.some((m) => m.id === mention.id), "dismissed mention stays gone");
console.log("ok   inbox mention dismissal");

const vapid = (await call("GET", "/users/@me/devices/web-push", friend)).body;
if (!vapid.enabled) {
    console.log("skip web push is disabled");
    process.exit(0);
}
const client = crypto.createECDH("prime256v1");
const clientKey = client.generateKeys();
const auth = crypto.randomBytes(16);
const received = [];
let status = 201;
const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
        received.push({ authorization: req.headers.authorization, body: Buffer.concat(chunks) });
        res.writeHead(status).end();
    });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/push`;
const registered = await call("POST", "/users/@me/devices", friend, {
    provider: "webpush",
    token: JSON.stringify({
        endpoint,
        keys: { p256dh: clientKey.toString("base64url"), auth: auth.toString("base64url") },
    }),
});
if (registered.status !== 204) {
    console.log("skip web push needs security.allowPrivateNetworkRequests for the local test endpoint");
    server.close();
    process.exit(0);
}

const decrypt = (body) => {
    const salt = body.subarray(0, 16);
    const serverKey = body.subarray(21, 21 + body[20]);
    const ikm = Buffer.from(crypto.hkdfSync("sha256", client.computeSecret(serverKey), auth, Buffer.concat([Buffer.from("WebPush: info\0"), clientKey, serverKey]), 32));
    const key = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const data = body.subarray(21 + body[20]);
    const decipher = crypto.createDecipheriv("aes-128-gcm", key, nonce);
    decipher.setAuthTag(data.subarray(-16));
    const plain = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]);
    return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
};
const verify = (authorization) => {
    const [, token, publicKey] = authorization.match(/^vapid t=([^,]+), k=(.+)$/);
    const [header, claims, signature] = token.split(".");
    const raw = Buffer.from(publicKey, "base64url");
    const key = crypto.createPublicKey({
        key: {
            kty: "EC",
            crv: "P-256",
            x: raw.subarray(1, 33).toString("base64url"),
            y: raw.subarray(33).toString("base64url"),
        },
        format: "jwk",
    });
    return publicKey === vapid.public_key && crypto.verify("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
};
const pushes = async (label, action, expected) => {
    const before = received.length;
    await action();
    await sleep(1500);
    const got = received.slice(before);
    assert.equal(got.length, expected, label);
    for (const push of got) assert.ok(verify(push.authorization), `${label}: vapid signature`);
    console.log(`ok   ${label}`);
    return got.map((push) => decrypt(push.body));
};

const [dmPush] = await pushes("dm while the recipient is offline", () => send(tester, dm.id, sealed(tester)), 1);
assert.equal(dmPush.body, "🔒 Encrypted message");
assert.equal(dmPush.url, `/channels/@me/${dm.id}/${dmPush.message_id}`);
assert.equal(dmPush.user_id, them.id);
await pushes("plain message at the mentions level", () => send(tester, general.id, "no push"), 0);
const [mentionPush] = await pushes("guild mention", () => send(tester, general.id, `hey <@${them.id}>`), 1);
assert.equal(mentionPush.body, `hey @${them.global_name || them.username}`);
await pushes("silent message", () => send(tester, dm.id, sealed(tester, { flags: 4096 })), 0);
await settings(friend, { mobile_push: false });
await pushes("mobile push turned off for the server", () => send(tester, general.id, `again <@${them.id}>`), 0);
await settings(friend, { mobile_push: true });
const syncTokens = await Promise.all([tester, friend].map(async (token) => (await call("GET", "/users/@me/devices/sync-token", token)).body.token));
const synced = await call("PUT", "/users/@me/devices/sync", friend, {
    provider: "webpush",
    token: JSON.stringify({ endpoint, keys: { p256dh: clientKey.toString("base64url"), auth: auth.toString("base64url") } }),
    push_sync_tokens: syncTokens,
});
assert.deepEqual(synced.body, { invalid_push_sync_tokens: [] });
sql(`UPDATE sessions SET status = 'offline' WHERE user_id IN (${me.id}, ${them.id})`);
const [forFriend] = await pushes("synced device gets the dm for the second account", () => send(tester, dm.id, sealed(tester)), 1);
assert.equal(forFriend.user_id, them.id);
const [forTester] = await pushes("synced device gets the dm for the first account", () => send(friend, dm.id, sealed(friend)), 1);
assert.equal(forTester.user_id, me.id);
status = 410;
await pushes("expired subscription", () => send(tester, dm.id, sealed(tester)), 1);
assert.equal(sql(`SELECT count(*) FROM push_devices WHERE token = '${endpoint}'`), "0", "expired subscription is removed");
console.log("ok   expired subscription is removed");
server.close();
