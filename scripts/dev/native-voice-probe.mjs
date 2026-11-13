import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv } from "node:crypto";
import { createSocket } from "node:dgram";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { chromiumPath } from "../util/chromium.cjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
};
const port = flag("port", process.env.PORT || "3001");
const peer = flag("peer", "native");
const seconds = Number(flag("seconds", "8"));
const mode = flag("mode", "aead_aes256_gcm_rtpsize");
const api = `http://localhost:${port}/api/v9`;
const origin = `http://fosscord.localhost:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const accounts = Object.fromEntries(
    readFileSync(process.env.TEST_ACCOUNT_FILE || new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
);
const users = {
    tester: { login: accounts.TEST_EMAIL, password: accounts.TEST_PASSWORD },
    friend: { login: "friend@fosscord.test", password: accounts.FRIEND_PASSWORD },
};
const call = (token, method, path, body) =>
    fetch(`${api}${path}`, {
        method,
        headers: { "content-type": "application/json", ...(token && { authorization: token }) },
        body: body && JSON.stringify(body),
    }).then((response) => response.json());

const tokens = Object.fromEntries(await Promise.all(Object.entries(users).map(async ([name, body]) => [name, (await call(undefined, "POST", "/auth/login", body)).token])));
const friendGuilds = new Set((await call(tokens.friend, "GET", "/users/@me/guilds")).map((guild) => guild.id));
const guild = (await call(tokens.tester, "GET", "/users/@me/guilds")).find((g) => friendGuilds.has(g.id));
assert.ok(guild, "tester and friend share no guild");
const channels = await call(tokens.tester, "GET", `/guilds/${guild.id}/channels`);
const voice = channels.find((channel) => channel.type === 2) ?? (await call(tokens.tester, "POST", `/guilds/${guild.id}/channels`, { name: "General", type: 2 }));

assert.equal(mode, "aead_aes256_gcm_rtpsize", "the probe only speaks aead_aes256_gcm_rtpsize, the SFU's Go tests cover XChaCha20");
const nonceLength = 12;
const algorithm = "aes-256-gcm";

const seal = (key, header, payload, counter) => {
    const nonce = Buffer.alloc(nonceLength);
    nonce.writeUInt32BE(counter, 0);
    const cipher = createCipheriv(algorithm, key, nonce, { authTagLength: 16 });
    cipher.setAAD(header);
    return Buffer.concat([header, cipher.update(payload), cipher.final(), cipher.getAuthTag(), nonce.subarray(0, 4)]);
};

const open = (key, packet) => {
    const headerLength = 12 + 4 * (packet[0] & 0x0f) + (packet[0] & 0x10 ? 4 : 0);
    const nonce = Buffer.alloc(nonceLength);
    packet.copy(nonce, 0, packet.length - 4);
    const decipher = createDecipheriv(algorithm, key, nonce, { authTagLength: 16 });
    decipher.setAAD(packet.subarray(0, headerLength));
    decipher.setAuthTag(packet.subarray(packet.length - 20, packet.length - 4));
    return Buffer.concat([decipher.update(packet.subarray(headerLength, packet.length - 20)), decipher.final()]);
};

async function nativeUser(name) {
    const token = tokens[name];
    const gateway = new WebSocket(`ws://localhost:${port}/?v=9&encoding=json`);
    const events = {};
    const waiters = [];
    gateway.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.op === 10)
            gateway.send(
                JSON.stringify({ op: 2, d: { token, capabilities: 16381, properties: { os: "Mac OS X", browser: "Discord Client", release_channel: "ptb" }, compress: false } }),
            );
        if (payload.t) events[payload.t] = payload.d;
        for (const waiter of [...waiters]) waiter();
    };
    const until = (check, label) =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${name}: timed out waiting for ${label}`)), 15000);
            const waiter = () => {
                const value = check();
                if (!value) return;
                clearTimeout(timer);
                waiters.splice(waiters.indexOf(waiter), 1);
                resolve(value);
            };
            waiters.push(waiter);
            waiter();
        });
    const ready = await until(() => events.READY, "READY");
    gateway.send(JSON.stringify({ op: 4, d: { guild_id: guild.id, channel_id: voice.id, self_mute: false, self_deaf: false } }));
    const server = await until(() => events.VOICE_SERVER_UPDATE, "VOICE_SERVER_UPDATE");
    const endpoint = server.endpoint.replace(/^wss?:\/\//, "");

    const voiceSocket = new WebSocket(`ws://${endpoint}/?v=8`);
    const ops = {};
    const voiceWaiters = [];
    let seq = -1;
    let heartbeat;
    voiceSocket.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (typeof payload.seq === "number") seq = payload.seq;
        (ops[payload.op] ??= []).push(payload.d);
        if (payload.op === 8) heartbeat = setInterval(() => voiceSocket.send(JSON.stringify({ op: 3, d: { t: Date.now(), seq_ack: seq } })), payload.d.heartbeat_interval);
        for (const waiter of [...voiceWaiters]) waiter();
    };
    const closed = new Promise((resolve) => {
        voiceSocket.onclose = (event) => resolve({ code: event.code, reason: event.reason });
    });
    await new Promise((resolve) => {
        voiceSocket.onopen = resolve;
    });
    const voiceUntil = (op, label) =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${name}: timed out waiting for voice op ${op} (${label})`)), 15000);
            const waiter = () => {
                if (!ops[op]) return;
                clearTimeout(timer);
                voiceWaiters.splice(voiceWaiters.indexOf(waiter), 1);
                resolve(ops[op].at(-1));
            };
            voiceWaiters.push(waiter);
            waiter();
        });
    voiceSocket.send(
        JSON.stringify({
            op: 0,
            d: { server_id: guild.id, user_id: ready.user.id, session_id: ready.session_id, token: server.token, video: false, max_dave_protocol_version: 0 },
        }),
    );
    const voiceReady = await voiceUntil(2, "READY");
    assert.ok(voiceReady.modes.includes(mode), `${name}: server offers ${voiceReady.modes.join(", ")}`);

    const udp = createSocket("udp4");
    await new Promise((resolve) => udp.bind(0, resolve));
    const packets = [];
    const discovered = new Promise((resolve) =>
        udp.on("message", (message) => {
            if (message.length === 74 && message.readUInt16BE(0) === 2) resolve(message);
            else packets.push(message);
        }),
    );
    const request = Buffer.alloc(74);
    request.writeUInt16BE(1, 0);
    request.writeUInt16BE(70, 2);
    request.writeUInt32BE(voiceReady.ssrc, 4);
    udp.send(request, voiceReady.port, voiceReady.ip);
    const response = await Promise.race([discovered, sleep(5000).then(() => null)]);
    assert.ok(response, `${name}: no IP discovery response`);
    const address = response.subarray(8, 72).toString().replace(/\0.*$/, "");
    const observedPort = response.readUInt16BE(72);
    assert.equal(observedPort, udp.address().port, `${name}: discovery reported the wrong port`);

    voiceSocket.send(JSON.stringify({ op: 1, d: { protocol: "udp", data: { address, port: observedPort, mode } } }));
    const description = await voiceUntil(4, "SESSION_DESCRIPTION");
    assert.equal(description.mode, mode);
    const key = Buffer.from(description.secret_key);
    assert.equal(key.length, 32, `${name}: secret_key is ${key.length} bytes`);
    voiceSocket.send(JSON.stringify({ op: 5, d: { speaking: 1, delay: 0, ssrc: voiceReady.ssrc } }));

    let sequence = 0;
    let counter = 0;
    let sent = 0;
    const sender = setInterval(() => {
        const header = Buffer.alloc(12);
        header[0] = 0x80;
        header[1] = 120;
        header.writeUInt16BE(sequence++ & 0xffff, 2);
        header.writeUInt32BE((sequence * 960) >>> 0, 4);
        header.writeUInt32BE(voiceReady.ssrc, 8);
        udp.send(seal(key, header, Buffer.from([0xfc, 0xff, 0xfe, sequence & 0xff]), ++counter), voiceReady.port, voiceReady.ip);
        sent++;
    }, 20);

    return {
        name,
        ssrc: voiceReady.ssrc,
        stats() {
            const received = {};
            let undecryptable = 0;
            for (const packet of packets) {
                if (packet.length < 32) continue;
                try {
                    open(key, packet);
                    const ssrc = packet.readUInt32BE(8);
                    received[ssrc] = (received[ssrc] ?? 0) + 1;
                } catch {
                    undecryptable++;
                }
            }
            return { name, ssrc: voiceReady.ssrc, sent, received, undecryptable, speakingMaps: (ops[5] ?? []).map((d) => [d.user_id, d.ssrc]) };
        },
        closed,
        async stop() {
            clearInterval(sender);
            clearInterval(heartbeat);
            udp.close();
            voiceSocket.close();
            gateway.send(JSON.stringify({ op: 4, d: { guild_id: guild.id, channel_id: null, self_mute: false, self_deaf: false } }));
            await sleep(500);
            gateway.close();
        },
    };
}

async function webUser(name) {
    const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
    const { chromium } = require("playwright-core");
    const browser = await chromium.launch({
        executablePath: flag("browser") || chromiumPath(),
        headless: true,
        args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    });
    const context = await browser.newContext({ permissions: ["microphone"] });
    await context.addInitScript((value) => {
        localStorage.setItem("token", JSON.stringify(value));
        window.__pcs = [];
        const Native = window.RTCPeerConnection;
        window.RTCPeerConnection = new Proxy(Native, {
            construct(target, ctorArgs) {
                const pc = new target(...ctorArgs);
                window.__pcs.push(pc);
                return pc;
            },
        });
    }, tokens[name]);
    const page = await context.newPage();
    await page.goto(`${origin}/channels/@me`);
    await sleep(15000);
    const joined = await page.evaluate((channelId) => {
        const requires = [];
        window.webpackChunkdiscord_app.push([[Symbol()], {}, (r) => requires.push(r)]);
        for (const req of requires)
            for (const mid of Object.keys(req.m)) {
                if (!req.m[mid].toString().includes("selectVoiceChannel(e){")) continue;
                const exports = req(mid);
                for (const key of Object.keys(exports))
                    if (typeof exports[key]?.selectVoiceChannel === "function") {
                        exports[key].selectVoiceChannel(channelId);
                        return true;
                    }
            }
        return false;
    }, voice.id);
    assert.ok(joined, `${name}: voice action not found`);
    return {
        name,
        async stats() {
            const rows = await page.evaluate(async () => {
                const out = [];
                for (const pc of window.__pcs) {
                    if (pc.connectionState === "closed") continue;
                    (await pc.getStats()).forEach((r) => {
                        if (r.type === "inbound-rtp" && r.kind === "audio") out.push({ dir: "in", ssrc: r.ssrc, packets: r.packetsReceived, bytes: r.bytesReceived });
                        if (r.type === "outbound-rtp" && r.kind === "audio") out.push({ dir: "out", ssrc: r.ssrc, packets: r.packetsSent, bytes: r.bytesSent });
                    });
                }
                return out;
            });
            return { name, media: rows };
        },
        async stop() {
            await browser.close();
        },
    };
}

const tester = await nativeUser("tester");
const friend = peer === "web" ? await webUser("friend") : await nativeUser("friend");
await sleep(seconds * 1000);
const testerStats = tester.stats();
const friendStats = await friend.stats();
console.log(JSON.stringify({ mode, peer, tester: testerStats, friend: friendStats }));

assert.equal(testerStats.undecryptable, 0, "tester got packets it couldn't decrypt");
if (peer === "web") {
    const heardNative = friendStats.media.find((row) => row.dir === "in" && row.ssrc === testerStats.ssrc);
    assert.ok(heardNative && heardNative.packets > 20, `web friend heard ${heardNative?.packets ?? 0} packets from the native tester`);
} else {
    assert.ok((testerStats.received[friendStats.ssrc] ?? 0) > 20, "tester heard the friend");
    assert.ok((friendStats.received[testerStats.ssrc] ?? 0) > 20, "friend heard the tester");
    assert.equal(friendStats.undecryptable, 0, "friend got packets it couldn't decrypt");
}
await Promise.all([tester.stop(), friend.stop()]);
console.log(JSON.stringify({ ok: true, mode, peer }));
process.exit(0);
