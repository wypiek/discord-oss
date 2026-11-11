import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const root = path.resolve(import.meta.dirname, "../..");
const { packEtf, unpackEtf } = require(path.join(root, "dist/gateway/util/Etf.js"));

const origin = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3001}`;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "the probe only runs against a local server");
const accounts = Object.fromEntries(
    fs
        .readFileSync(path.join(root, "scripts/dev/.test-account"), "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

const buildNumber = 280202;
const properties = {
    os: "Android",
    browser: "Discord Android",
    device: "a20e",
    system_locale: "en-US",
    has_client_mods: false,
    client_version: "280.2 - rn",
    release_channel: "googleRelease",
    device_vendor_id: randomUUID(),
    design_id: 2,
    browser_user_agent: "",
    browser_version: "",
    os_version: "34",
    client_build_number: buildNumber,
    client_event_source: null,
    client_launch_id: randomUUID(),
    client_app_state: "active",
};
const userAgent = `Discord-Android/${buildNumber};RNA`;
const superProperties = Buffer.from(JSON.stringify(properties)).toString("base64");
const capabilities = 30717;

const failures = [];
const check = (label, ok, detail = "") => {
    console.log(`${ok ? "pass" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
    if (!ok) failures.push(label);
};

async function call(method, pathname, token, body) {
    const response = await fetch(`${origin}/api/v9${pathname}`, {
        method,
        headers: {
            "content-type": "application/json",
            "user-agent": userAgent,
            "x-super-properties": superProperties,
            "x-discord-locale": "en-US",
            "x-discord-timezone": "Europe/Lisbon",
            ...(token ? { authorization: token } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let parsed = text;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {}
    return { status: response.status, body: parsed };
}

function syncZlib(stream, flag) {
    const close = stream.close;
    const handle = stream._handle;
    const handleClose = handle.close;
    return (chunk) => {
        stream.close = () => undefined;
        handle.close = () => undefined;
        try {
            return Buffer.from(stream._processChunk(chunk, flag));
        } finally {
            stream.close = close;
            stream._handle = handle;
            handle.close = handleClose;
            stream.removeAllListeners("error");
        }
    };
}

function frameDecoder(compress) {
    if (compress === "zstd-stream") {
        const decompress = syncZlib(zlib.createZstdDecompress(), zlib.constants.ZSTD_e_continue);
        return (frame) => [decompress(frame)];
    }
    if (compress === "zlib-stream") {
        const inflate = syncZlib(zlib.createInflate(), zlib.constants.Z_SYNC_FLUSH);
        let pending = [];
        return (frame) => {
            pending.push(frame);
            if (frame.length < 4 || frame.readUInt32BE(frame.length - 4) !== 0xffff) return [];
            const joined = Buffer.concat(pending);
            pending = [];
            return [inflate(joined)];
        };
    }
    return (frame) => [frame];
}

function findUndefinedOrBigint(value, at = "d") {
    if (value === undefined) return at;
    if (typeof value === "bigint") return at;
    if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
            const found = findUndefinedOrBigint(item, `${at}.${key}`);
            if (found) return found;
        }
    }
    return null;
}

async function gateway(url, encoding, compress, token) {
    const socket = new WebSocket(`${url}/?encoding=${encoding}&v=9${compress ? `&compress=${compress}` : ""}`, { headers: { "user-agent": userAgent } });
    const decode = frameDecoder(compress);
    const packets = [];
    const waiters = new Set();
    let bytesOnWire = 0;
    let bytesDecoded = 0;
    socket.on("message", (data, isBinary) => {
        const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
        bytesOnWire += frame.length;
        for (const message of decode(frame)) {
            bytesDecoded += message.length;
            const packet = encoding === "etf" ? unpackEtf(message) : JSON.parse(message.toString("utf8"));
            packet.binary = isBinary;
            packets.push(packet);
        }
        for (const waiter of waiters) waiter();
    });
    const closed = new Promise((resolve) => socket.on("close", (code, reason) => resolve({ code, reason: String(reason) })));
    let closeInfo;
    closed.then((info) => {
        closeInfo = info;
        for (const waiter of waiters) waiter();
    });
    const receive = (predicate, label, timeout = 10000) =>
        new Promise((resolve, reject) => {
            const attempt = () => {
                const index = packets.findIndex(predicate);
                if (index >= 0) {
                    waiters.delete(attempt);
                    clearTimeout(timer);
                    resolve(packets.splice(index, 1)[0]);
                } else if (closeInfo) {
                    waiters.delete(attempt);
                    clearTimeout(timer);
                    reject(new Error(`${label}: socket closed ${closeInfo.code} ${closeInfo.reason}`));
                }
            };
            const timer = setTimeout(() => {
                waiters.delete(attempt);
                reject(new Error(`${label} timeout`));
            }, timeout);
            waiters.add(attempt);
            attempt();
        });
    const send = (payload) => socket.send(encoding === "etf" ? packEtf(payload) : JSON.stringify(payload));
    await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
    });
    return { socket, receive, send, closed, stats: () => ({ bytesOnWire, bytesDecoded }) };
}

async function runGateway(url, encoding, compress, token, guild, channel) {
    const label = `${encoding}${compress ? `+${compress}` : ""}`;
    const client = await gateway(url, encoding, compress, token);
    try {
        const hello = await client.receive((p) => p.op === 10, "HELLO");
        check(`${label} hello`, hello.d.heartbeat_interval > 0 && (encoding === "json" ? !compress || hello.binary : hello.binary), `interval ${hello.d.heartbeat_interval}`);
        client.send({
            op: 2,
            d: {
                token,
                capabilities,
                properties,
                presence: { status: "unknown", since: 0, activities: [], afk: false },
                compress: false,
                client_state: { guild_versions: {} },
            },
        });
        const ready = await client.receive((p) => p.t === "READY", "READY", 20000);
        const d = ready.d;
        check(`${label} READY user`, d.user?.id === tokenUserId, d.user?.id);
        check(`${label} READY ids are strings`, typeof d.user?.id === "string" && d.guilds.every((g) => typeof g.id === "string"));
        check(`${label} READY session`, typeof d.session_id === "string" && typeof d.resume_gateway_url === "string", d.resume_gateway_url);
        check(
            `${label} READY has the test guild`,
            d.guilds.some((g) => g.id === guild),
        );
        check(`${label} READY arrays stay arrays`, Array.isArray(d.guilds) && Array.isArray(d.private_channels) && Array.isArray(d.relationships));
        check(`${label} READY has no undefined or bigint`, !findUndefinedOrBigint(d), findUndefinedOrBigint(d) ?? "");
        const supplemental = await client.receive((p) => p.t === "READY_SUPPLEMENTAL", "READY_SUPPLEMENTAL").catch((error) => error);
        check(`${label} READY_SUPPLEMENTAL`, !(supplemental instanceof Error), supplemental instanceof Error ? supplemental.message : "");

        client.send({ op: 1, d: ready.s ?? null });
        const ack = await client.receive((p) => p.op === 11, "HEARTBEAT_ACK").catch((error) => error);
        check(`${label} heartbeat ack`, !(ack instanceof Error), ack instanceof Error ? ack.message : "");

        client.send({ op: 3, d: { status: "online", since: 0, activities: [], afk: false } });

        client.send({ op: 14, d: { guild_id: guild, typing: true, activities: true, threads: true, channels: { [channel]: [[0, 99]] } } });
        const list14 = await client.receive((p) => p.t === "GUILD_MEMBER_LIST_UPDATE" && p.d.guild_id === guild, "OP 14 member list").catch((error) => error);
        check(
            `${label} OP 14 member list`,
            !(list14 instanceof Error) && Array.isArray(list14.d.ops),
            list14 instanceof Error ? list14.message : `${list14.d.member_count} members`,
        );

        client.send({ op: 37, d: { subscriptions: { [guild]: { typing: true, activities: true, threads: true, channels: { [channel]: [[0, 99]] } } } } });
        const list37 = await client.receive((p) => p.t === "GUILD_MEMBER_LIST_UPDATE" && p.d.guild_id === guild, "OP 37 member list").catch((error) => error);
        check(`${label} OP 37 member list`, !(list37 instanceof Error) && Array.isArray(list37.d.ops), list37 instanceof Error ? list37.message : `${list37.d.ops.length} ops`);

        const nonce = String(BigInt(Date.now() - 1420070400000) << 22n);
        const sent = await call("POST", `/channels/${channel}/messages`, token, { content: `android probe ${label}`, nonce });
        check(`${label} REST message`, sent.status === 200, String(sent.status));
        const created = await client.receive((p) => p.t === "MESSAGE_CREATE" && p.d.nonce === nonce, "MESSAGE_CREATE").catch((error) => error);
        check(
            `${label} MESSAGE_CREATE`,
            !(created instanceof Error) && created.d.content === `android probe ${label}` && typeof created.d.id === "string",
            created instanceof Error ? created.message : created.d.id,
        );
        if (!(created instanceof Error)) {
            check(`${label} MESSAGE_CREATE empty arrays`, Array.isArray(created.d.attachments) && Array.isArray(created.d.embeds) && Array.isArray(created.d.mentions));
        }
        const { bytesOnWire, bytesDecoded } = client.stats();
        console.log(`     ${label}: ${bytesOnWire} bytes on the wire for ${bytesDecoded} decoded`);
    } catch (error) {
        check(`${label} gateway run`, false, error.message);
    } finally {
        client.socket.close(1000);
        await client.closed;
    }
}

let tokenUserId;
const login = await call("POST", "/auth/login", undefined, {
    login: accounts.TEST_EMAIL,
    password: accounts.TEST_PASSWORD,
    undelete: false,
    login_source: null,
    gift_code_sku_id: null,
});
assert.equal(login.status, 200, `login failed: ${JSON.stringify(login.body)}`);
const token = login.body.token;
const me = await call("GET", "/users/@me", token);
tokenUserId = me.body.id;

const startup = [
    ["GET", "/experiments?with_guild_experiments=true"],
    ["GET", "/auth/location-metadata"],
    ["GET", "/users/@me"],
    ["GET", "/users/@me/settings-proto/1"],
    ["GET", "/users/@me/settings-proto/2"],
    ["GET", "/users/@me/settings-proto/3"],
    ["GET", "/content-inventory/users/@me"],
    ["GET", "/users/@me/consent"],
    ["GET", "/users/@me/affinities/users"],
    ["GET", "/users/@me/affinities/guilds"],
    ["GET", "/users/@me/connections"],
    ["GET", "/users/@me/billing/subscriptions"],
    ["GET", "/users/@me/billing/payment-sources"],
    ["GET", "/users/@me/guilds/premium/subscription-slots"],
    ["GET", "/users/@me/entitlements/gifts"],
    ["GET", "/users/@me/library"],
    ["GET", "/users/@me/mentions?limit=25"],
    ["GET", "/users/@me/notification-center/items?limit=20"],
    ["GET", "/users/@me/survey"],
    ["GET", "/users/@me/referrals/eligibility"],
    ["GET", "/users/@me/collectibles-purchases"],
    ["GET", "/users/@me/email-settings"],
    ["GET", "/users/@me/activities/statistics/applications"],
    ["GET", "/applications/detectable"],
    ["GET", "/sticker-packs"],
    ["GET", "/gateway"],
    ["GET", "/voice/regions"],
    ["GET", "/promotions?locale=en-US&platform=1"],
    ["GET", "/outbound-promotions"],
    ["POST", "/users/@me/devices", { provider: "gcm", token: "probe-token" }],
    ["DELETE", "/users/@me/devices", { provider: "gcm", token: "probe-token" }],
    ["POST", "/science", { token: "", events: [] }],
    ["POST", "/metrics/v2", { metrics: [], client_info: {} }],
];
for (const [method, pathname, body] of startup) {
    const response = await call(method, pathname, token, body);
    check(`${method} ${pathname}`, response.status < 400, String(response.status));
}

const syncToken = await call("GET", "/users/@me/devices/sync-token", token);
check("GET /users/@me/devices/sync-token", syncToken.status === 200 && typeof syncToken.body?.token === "string", String(syncToken.status));
const sync = await call("PUT", "/users/@me/devices/sync", token, { provider: "gcm", token: "probe-sync-token", push_sync_tokens: [syncToken.body?.token, "not-a-sync-token"] });
check(
    "PUT /users/@me/devices/sync",
    sync.status === 200 && sync.body?.invalid_push_sync_tokens?.length === 1 && sync.body.invalid_push_sync_tokens[0] === "not-a-sync-token",
    JSON.stringify(sync.body),
);
await call("DELETE", "/users/@me/devices", token, { provider: "gcm", token: "probe-sync-token" });

const sticker = await fetch(`${origin}/api/v9/users/@me`, { headers: { authorization: token, "user-agent": userAgent } });
check("REST answers the Android user agent", sticker.status === 200);
const avatar = await fetch(`${origin}/embed/avatars/0.png`);
check("CDN default avatar", avatar.status === 200, String(avatar.status));

const gatewayUrl = (await call("GET", "/gateway", token)).body.url;
const guilds = await call("GET", "/users/@me/guilds", token);
const guild = guilds.body[0].id;
const channels = await call("GET", `/guilds/${guild}/channels`, token);
const channel = channels.body.find((c) => c.type === 0).id;

for (const [encoding, compress] of [
    ["etf", "zstd-stream"],
    ["etf", "zlib-stream"],
    ["etf", ""],
    ["json", "zstd-stream"],
]) {
    await runGateway(gatewayUrl, encoding, compress, token, guild, channel);
}

console.log(`${failures.length ? "FAIL" : "pass"} ${failures.length} failures`);
process.exit(failures.length ? 1 : 0);
