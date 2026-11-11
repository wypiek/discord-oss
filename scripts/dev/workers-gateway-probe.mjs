import assert from "node:assert/strict";
import { constants, generateKeyPairSync, privateDecrypt, randomBytes } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import zlib from "node:zlib";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const root = path.resolve(import.meta.dirname, "../..");
const { packEtf, unpackEtf } = require(path.join(root, "dist/gateway/util/Etf.js"));

const api = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3001}`;
const gatewayUrl = process.env.GATEWAY || "ws://127.0.0.1:8787";
const eventUrl = gatewayUrl.replace(/^ws/, "http");
for (const url of [api, gatewayUrl]) assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "the probe only runs against local servers");

const accounts = Object.fromEntries(
    fs
        .readFileSync(path.join(root, "scripts/dev/.test-account"), "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);

const failures = [];
const check = (label, ok, detail = "") => {
    console.log(`${ok ? "pass" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
    if (!ok) failures.push(label);
};

async function call(method, pathname, token, body) {
    const response = await fetch(`${api}/api/v9${pathname}`, {
        method,
        headers: { "content-type": "application/json", ...(token ? { authorization: token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function postEvent(body) {
    const response = await fetch(eventUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...(process.env.EVENT_SECRET ? { "x-event-secret": process.env.EVENT_SECRET } : {}) },
        body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
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

async function connect(base, encoding, compress) {
    const socket = new WebSocket(`${base}/?encoding=${encoding}&v=9${compress ? `&compress=${compress}` : ""}`);
    const decode = frameDecoder(compress);
    const packets = [];
    const waiters = new Set();
    let closeInfo;
    const bytes = { wire: 0, decoded: 0 };
    socket.on("message", (data) => {
        const frame = Buffer.isBuffer(data) ? data : Buffer.from(data);
        bytes.wire += frame.length;
        for (const message of decode(frame)) {
            bytes.decoded += message.length;
            packets.push(encoding === "etf" ? unpackEtf(message) : JSON.parse(message.toString("utf8")));
        }
        for (const waiter of waiters) waiter();
    });
    const closed = new Promise((resolve) =>
        socket.on("close", (code, reason) => {
            closeInfo = { code, reason: String(reason) };
            for (const waiter of waiters) waiter();
            resolve(closeInfo);
        }),
    );
    const receive = (predicate, label, timeout = 20000) =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                waiters.delete(attempt);
                reject(new Error(`${label} timeout`));
            }, timeout);
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
            waiters.add(attempt);
            attempt();
        });
    const send = (payload) => socket.send(encoding === "etf" ? packEtf(payload) : JSON.stringify(payload));
    await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
    });
    return { socket, receive, send, closed, bytes, lastSeq: () => Math.max(-1, ...packets.map((p) => p.s ?? -1)) };
}

const login = await call("POST", "/auth/login", undefined, { login: accounts.TEST_EMAIL, password: accounts.TEST_PASSWORD, undelete: false, login_source: null });
assert.equal(login.status, 200, `login failed: ${JSON.stringify(login.body)}`);
const token = login.body.token;
const me = (await call("GET", "/users/@me", token)).body;
const guild = (await call("GET", "/users/@me/guilds", token)).body[0];
const channel = (await call("GET", `/guilds/${guild.id}/channels`, token)).body.find((c) => c.type === 0);
assert.ok(guild && channel, "the seeded account needs a guild with a text channel");

const properties = { os: "Linux", browser: "probe", device: "" };
const bigContent = randomBytes(45_000).toString("base64");

for (const [encoding, compress] of [
    ["json", ""],
    ["json", "zlib-stream"],
    ["etf", "zlib-stream"],
    ["json", "zstd-stream"],
    ["etf", "zstd-stream"],
]) {
    const label = `${encoding}${compress ? `+${compress}` : ""}`;
    const client = await connect(gatewayUrl, encoding, compress);
    let sessionId;
    let resumeUrl;
    try {
        const hello = await client.receive((p) => p.op === 10, "HELLO");
        check(`${label} HELLO`, hello.d.heartbeat_interval > 0, `heartbeat_interval ${hello.d.heartbeat_interval}`);
        const started = Date.now();
        client.send({ op: 2, d: { token, capabilities: 30717, properties, presence: { status: "online", since: 0, activities: [], afk: false }, compress: false } });
        const ready = await client.receive((p) => p.t === "READY", "READY", 60000);
        sessionId = ready.d.session_id;
        resumeUrl = ready.d.resume_gateway_url;
        check(
            `${label} READY`,
            ready.d.user?.id === me.id && ready.d.guilds.some((g) => g.id === guild.id),
            `user ${ready.d.user?.id}, ${ready.d.guilds.length} guilds, session ${sessionId}, resume ${resumeUrl}, ${Date.now() - started} ms`,
        );
        client.send({ op: 1, d: ready.s });
        const ack = await client.receive((p) => p.op === 11, "HEARTBEAT_ACK");
        check(`${label} heartbeat ACK`, ack.op === 11);

        const nonce = randomBytes(8).toString("hex");
        const message = {
            id: `${BigInt(Date.now() - 1420070400000) << 22n}`,
            channel_id: channel.id,
            guild_id: guild.id,
            author: { id: me.id, username: me.username, discriminator: me.discriminator, avatar: null },
            content: `workers probe ${nonce}`,
            nonce,
            attachments: [],
            embeds: [],
            mentions: [],
            mention_roles: [],
            pinned: false,
            mention_everyone: false,
            tts: false,
            timestamp: new Date().toISOString(),
            edited_timestamp: null,
            flags: 0,
            type: 0,
        };
        const posted = await postEvent({ event: "MESSAGE_CREATE", channel_id: channel.id, data: message });
        check(`${label} event POST accepted`, posted.status === 202, JSON.stringify(posted.body));
        const dispatch = await client.receive((p) => p.t === "MESSAGE_CREATE" && p.d?.nonce === nonce, "MESSAGE_CREATE");
        check(`${label} MESSAGE_CREATE delivered`, dispatch.d.content === message.content, `seq ${dispatch.s}`);

        const bigNonce = randomBytes(8).toString("hex");
        await postEvent({ event: "MESSAGE_CREATE", channel_id: channel.id, data: { ...message, id: `${BigInt(message.id) + 1n}`, nonce: bigNonce, content: bigContent } });
        const big = await client.receive((p) => p.t === "MESSAGE_CREATE" && p.d?.nonce === bigNonce, "large MESSAGE_CREATE");
        check(`${label} ${bigContent.length} byte dispatch`, big.d.content === bigContent);

        if (label === "json") {
            client.send({ op: 14, d: { guild_id: guild.id, typing: true, activities: true, threads: true, channels: { [channel.id]: [[0, 99]] } } });
            const list = await client.receive((p) => p.t === "GUILD_MEMBER_LIST_UPDATE" && p.d?.guild_id === guild.id, "GUILD_MEMBER_LIST_UPDATE");
            const members = list.d.ops?.[0]?.items?.filter((item) => item.member).length ?? 0;
            check(
                `${label} lazy member list`,
                list.d.ops?.[0]?.op === "SYNC" && members > 0,
                `${list.d.member_count} members, ${members} in the first range, groups ${list.d.groups.map((g) => g.id).join(",")}`,
            );
            client.send({ op: 8, d: { guild_id: [guild.id], query: "", limit: 0 } });
            const chunk = await client.receive((p) => p.t === "GUILD_MEMBERS_CHUNK", "GUILD_MEMBERS_CHUNK");
            check(`${label} request guild members`, chunk.d.members.length > 0, `${chunk.d.members.length} members`);
        }
    } catch (error) {
        check(`${label} gateway session`, false, error.message);
    }
    console.log(`     ${label}: ${client.bytes.wire} bytes on the wire for ${client.bytes.decoded} decoded`);
    const lastSeq = client.lastSeq();
    client.socket.close(4000);
    await client.closed;
    if (!sessionId) continue;
    try {
        const resumed = await connect(resumeUrl, encoding, compress);
        await resumed.receive((p) => p.op === 10, "HELLO after resume");
        resumed.send({ op: 6, d: { token, session_id: sessionId, seq: lastSeq } });
        const reply = await resumed.receive((p) => p.t === "RESUMED" || p.op === 9, "RESUMED");
        check(`${label} RESUME`, reply.t === "RESUMED", reply.t ?? `op ${reply.op}`);
        resumed.socket.close(1000);
        await resumed.closed;
    } catch (error) {
        check(`${label} RESUME`, false, error.message);
    }
}

try {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const encodedKey = publicKey.export({ format: "der", type: "spki" }).toString("base64");
    const remote = new WebSocket(`${gatewayUrl}/remote-auth/?v=2`);
    const frames = [];
    const waiters = new Set();
    remote.on("message", (data) => {
        frames.push(JSON.parse(String(data)));
        for (const waiter of waiters) waiter();
    });
    const next = (op) =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`remote auth ${op} timeout`)), 15000);
            const attempt = () => {
                const index = frames.findIndex((frame) => frame.op === op);
                if (index < 0) return;
                waiters.delete(attempt);
                clearTimeout(timer);
                resolve(frames.splice(index, 1)[0]);
            };
            waiters.add(attempt);
            attempt();
        });
    await new Promise((resolve, reject) => {
        remote.once("open", resolve);
        remote.once("error", reject);
    });
    await next("hello");
    remote.send(JSON.stringify({ op: "init", encoded_public_key: encodedKey }));
    const proof = await next("nonce_proof");
    const nonce = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(proof.encrypted_nonce, "base64"));
    remote.send(JSON.stringify({ op: "nonce_proof", nonce: nonce.toString("base64url") }));
    const init = await next("pending_remote_init");
    await postEvent({ session_id: `remote-auth:${init.fingerprint}`, event: "REMOTE_AUTH_PENDING_LOGIN", data: { user_id: me.id } });
    const login = await next("pending_login");
    check("remote auth handshake and ticket", typeof login.ticket === "string" && login.ticket.split(".").length === 3, `fingerprint ${init.fingerprint}`);
    remote.close(1000);
} catch (error) {
    check("remote auth handshake and ticket", false, error.message);
}

const rejected = await postEvent({ event: "MESSAGE_CREATE", data: {} });
check("event POST without an id is rejected", rejected.status === 400, String(rejected.status));

console.log(failures.length ? `${failures.length} failed: ${failures.join(", ")}` : "all passed");
process.exit(failures.length ? 1 : 0);
