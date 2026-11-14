import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chromiumPath } from "../util/chromium.cjs";
import { accessUnits, connectGateway, decodeAnnexB, encodeTestPattern, NativeVoiceClient } from "./native-client.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
};
const port = flag("port", process.env.PORT || "3001");
const seconds = Number(flag("seconds", "10"));
const mode = flag("mode", "aead_aes256_gcm_rtpsize");
const cases = flag("case", "native-golive-web,native-camera-web,web-camera-native,native-golive-native,web-golive-native").split(",");
const fps = 30;
const api = `http://localhost:${port}/api/v9`;
const origin = `http://fosscord.localhost:${port}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = (label, data) => console.log(JSON.stringify({ label, ...data }));
const step = (message) => report("step", { message, at: new Date().toISOString() });

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

const work = mkdtempSync(join(tmpdir(), "native-video-"));
const patterns = {};
for (const [name, width, height] of [
    ["high", 640, 360],
    ["low", 320, 180],
]) {
    const file = join(work, `${name}.h264`);
    await encodeTestPattern(file, { seconds: 60, fps, width, height });
    patterns[name] = { frames: accessUnits(readFileSync(file)), width, height };
}
assert.ok(patterns.high.frames[0].keyframe && patterns.high.frames.slice(1).every((frame) => !frame.keyframe), "the test pattern has one keyframe at the start");

async function nativeUser(name) {
    const gateway = await connectGateway({ port, token: tokens[name], name });
    const userId = gateway.ready.user.id;
    const sessionId = gateway.ready.session_id;
    const clients = [];
    const open = async (options) => {
        const client = new NativeVoiceClient({ name, mode });
        clients.push(client);
        await client.connect({ userId, sessionId, ...options });
        return client;
    };
    return {
        name,
        userId,
        gateway,
        async joinVoice(streams = []) {
            gateway.send(4, { guild_id: guild.id, channel_id: voice.id, self_mute: false, self_deaf: false, self_video: streams.length > 0 });
            const server = await gateway.dispatched("VOICE_SERVER_UPDATE");
            const client = await open({ endpoint: server.endpoint, serverId: guild.id, channelId: voice.id, token: server.token, streams, video: streams.length > 0 });
            client.startAudio();
            return client;
        },
        async goLive() {
            const streamKey = `guild:${guild.id}:${voice.id}:${userId}`;
            gateway.send(18, { type: "guild", guild_id: guild.id, channel_id: voice.id, preferred_region: null });
            const created = await gateway.dispatched("STREAM_CREATE", (d) => d.stream_key === streamKey);
            const server = await gateway.dispatched("STREAM_SERVER_UPDATE", (d) => d.stream_key === streamKey);
            gateway.send(22, { stream_key: streamKey, paused: false });
            const client = await open({
                endpoint: server.endpoint,
                serverId: created.rtc_server_id,
                channelId: created.rtc_channel_id,
                token: server.token,
                streams: [{ type: "screen", rid: "100", quality: 100 }],
                video: true,
            });
            return { client, streamKey };
        },
        async watch(streamKey) {
            gateway.send(20, { stream_key: streamKey });
            const created = await gateway.dispatched("STREAM_CREATE", (d) => d.stream_key === streamKey);
            const server = await gateway.dispatched("STREAM_SERVER_UPDATE", (d) => d.stream_key === streamKey);
            return open({ endpoint: server.endpoint, serverId: created.rtc_server_id, channelId: created.rtc_channel_id, token: server.token, streams: [], video: true });
        },
        async leave() {
            for (const client of clients) client.close();
            gateway.send(4, { guild_id: guild.id, channel_id: null, self_mute: false, self_deaf: false });
            await sleep(500);
            gateway.close();
        },
    };
}

const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");
let browser;

async function webUser(name, { plainSender = false } = {}) {
    browser ??= await chromium.launch({
        executablePath: flag("browser") || chromiumPath(),
        headless: true,
        args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
    });
    const context = await browser.newContext({ permissions: ["microphone", "camera"] });
    await context.route(/^https:\/\/([a-z0-9-]+\.)*(discord|discordapp)\.(com|net|media|gg)\//, (route) => route.abort());
    await context.addInitScript(
        ([token, plainSender]) => {
            localStorage.setItem("token", JSON.stringify(token));
            window.__traffic = [];
            const record = (socket, dir, data) => {
                if (typeof data !== "string" || window.__traffic.length > 2000) return;
                try {
                    const payload = JSON.parse(data);
                    if ([1, 3, 6, 11].includes(payload.op) && !payload.t) return;
                    window.__traffic.push({
                        at: Date.now(),
                        socket: socket.url.includes("encoding=") ? "gateway" : `voice-${socket.__id}`,
                        dir,
                        op: payload.op,
                        t: payload.t,
                        d: payload.op === 4 || payload.t === "READY" ? undefined : payload.d,
                    });
                } catch {}
            };
            const NativeSocket = window.WebSocket;
            window.WebSocket = new Proxy(NativeSocket, {
                construct(target, ctorArgs) {
                    const socket = new target(...ctorArgs);
                    socket.__id = window.__traffic.filter((entry) => entry.dir === "open").length + 1;
                    window.__traffic.push({ at: Date.now(), socket: `voice-${socket.__id}`, dir: "open", url: String(ctorArgs[0]) });
                    socket.addEventListener("message", (event) => record(socket, "in", event.data));
                    socket.addEventListener("close", (event) =>
                        window.__traffic.push({
                            at: Date.now(),
                            socket: socket.url.includes("encoding=") ? "gateway" : `voice-${socket.__id}`,
                            dir: "close",
                            code: event.code,
                            reason: event.reason,
                        }),
                    );
                    const send = socket.send.bind(socket);
                    socket.send = (data) => {
                        record(socket, "out", data);
                        return send(data);
                    };
                    return socket;
                },
            });
            window.__pcs = [];
            const Native = window.RTCPeerConnection;
            window.RTCPeerConnection = new Proxy(Native, {
                construct(target, ctorArgs) {
                    if (plainSender && ctorArgs[0]) ctorArgs[0] = { ...ctorArgs[0], encodedInsertableStreams: false };
                    const pc = new target(...ctorArgs);
                    window.__pcs.push(pc);
                    return pc;
                },
            });
            const fakeDisplay = async () => {
                const canvas = document.createElement("canvas");
                canvas.width = 1280;
                canvas.height = 720;
                const context = canvas.getContext("2d");
                let frame = 0;
                setInterval(() => {
                    frame++;
                    context.fillStyle = `hsl(${(frame * 7) % 360} 70% 40%)`;
                    context.fillRect(0, 0, canvas.width, canvas.height);
                    context.fillStyle = "white";
                    context.font = "64px sans-serif";
                    context.fillText(`screen ${frame}`, 80, 360);
                }, 33);
                const stream = canvas.captureStream(30);
                Object.defineProperty(stream.getVideoTracks()[0], "label", { value: `window:${window.__displaySource ?? 1}:0` });
                return stream;
            };
            Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { configurable: true, get: () => fakeDisplay, set() {} });
            if (!plainSender) return;
            const transform = Object.getOwnPropertyDescriptor(RTCRtpSender.prototype, "transform");
            Object.defineProperty(RTCRtpSender.prototype, "transform", {
                configurable: true,
                get() {
                    return transform.get.call(this);
                },
                set() {},
            });
        },
        [tokens[name], plainSender],
    );
    const page = await context.newPage();
    await page.goto(`${origin}/channels/@me`);
    await sleep(15000);
    const invoke = (needle, method, arg) =>
        page.evaluate(
            ([needle, method, arg]) => {
                const requires = [];
                window.webpackChunkdiscord_app.push([[Symbol()], {}, (r) => requires.push(r)]);
                for (const req of requires)
                    for (const mid of Object.keys(req.m)) {
                        if (!req.m[mid].toString().includes(needle)) continue;
                        const exports = req(mid);
                        for (const key of Object.keys(exports)) {
                            const value = exports[key];
                            if (method && typeof value?.[method] === "function") {
                                value[method](arg);
                                return true;
                            }
                            if (!method && typeof value === "function" && value.toString().includes(needle)) {
                                value(arg);
                                return true;
                            }
                        }
                    }
                return false;
            },
            [needle, method, arg],
        );
    return {
        name,
        page,
        joinVoice: () => invoke("selectVoiceChannel(e){", "selectVoiceChannel", voice.id),
        camera: (enabled) => invoke("setVideoEnabled(e){", "setVideoEnabled", enabled),
        goLive: () =>
            page.evaluate(
                async ([guildId, channelId]) => {
                    const requires = [];
                    window.webpackChunkdiscord_app.push([[Symbol()], {}, (r) => requires.push(r)]);
                    let engine;
                    let start;
                    for (const req of requires)
                        for (const mid of Object.keys(req.m)) {
                            const source = req.m[mid].toString();
                            if (!source.includes("getMediaEngine") && !source.includes('type:"STREAM_START"')) continue;
                            let exports;
                            try {
                                exports = req(mid);
                            } catch {
                                continue;
                            }
                            for (const value of Object.values(exports ?? {})) {
                                if (!engine && typeof value?.getMediaEngine === "function" && typeof value.getMediaEngine()?.getDesktopSource === "function")
                                    engine = value.getMediaEngine();
                                if (!start && typeof value === "function" && value.toString().includes('type:"STREAM_START"')) start = value;
                            }
                        }
                    if (!engine || !start) return `engine ${!!engine}, start ${!!start}`;
                    const sourceId = await Promise.race([
                        engine.getDesktopSource({ width: 1280, height: 720 }, false),
                        new Promise((resolve) => setTimeout(() => resolve(null), 10000)),
                    ]);
                    if (!sourceId) return "no desktop source";
                    start(guildId, channelId, { pid: null, sourceId, sourceName: null });
                    return true;
                },
                [guild.id, voice.id],
            ),
        updateQuality: (settings) => invoke('type:"STREAM_UPDATE_SETTINGS"', null, settings),
        traffic: () => page.evaluate(() => window.__traffic),
        watch: (ownerId) => invoke('type:"STREAM_WATCH",streamKey:', null, { streamType: "guild", guildId: guild.id, channelId: voice.id, ownerId }),
        async stats() {
            return page.evaluate(async () => {
                const rows = [];
                for (const pc of window.__pcs) {
                    if (pc.connectionState === "closed") continue;
                    (await pc.getStats()).forEach((r) => {
                        if (r.type === "inbound-rtp" && r.kind === "video")
                            rows.push({
                                dir: "in",
                                kind: "video",
                                ssrc: r.ssrc,
                                packets: r.packetsReceived,
                                lost: r.packetsLost,
                                nacks: r.nackCount,
                                plis: r.pliCount,
                                framesDecoded: r.framesDecoded,
                                keyFramesDecoded: r.keyFramesDecoded,
                                width: r.frameWidth,
                                height: r.frameHeight,
                                freezes: r.freezeCount,
                            });
                        if (r.type === "outbound-rtp" && r.kind === "video")
                            rows.push({
                                dir: "out",
                                kind: "video",
                                ssrc: r.ssrc,
                                packets: r.packetsSent,
                                framesEncoded: r.framesEncoded,
                                width: r.frameWidth,
                                keyFramesEncoded: r.keyFramesEncoded,
                            });
                    });
                }
                for (const pc of window.__pcs) {
                    if (pc.connectionState === "closed") continue;
                    (await pc.getStats()).forEach((r) => {
                        if (r.type === "inbound-rtp" && r.kind === "audio") rows.push({ dir: "in", kind: "audio", ssrc: r.ssrc, packets: r.packetsReceived });
                        if (r.type === "outbound-rtp" && r.kind === "audio") rows.push({ dir: "out", kind: "audio", ssrc: r.ssrc, packets: r.packetsSent });
                    });
                }
                rows.push({ connections: window.__pcs.map((pc) => pc.connectionState) });
                return rows;
            });
        },
        close: () => context.close(),
    };
}

const results = [];
const check = (name, condition, detail) => {
    results.push({ case: name, ok: !!condition, detail });
    report("check", { case: name, ok: !!condition, detail });
};

async function nativeGoLiveToWeb() {
    const name = "native-golive-web";
    const friend = await webUser("friend");
    const tester = await nativeUser("tester");
    try {
        assert.ok(await friend.joinVoice(), "friend voice action");
        await tester.joinVoice();
        const { client } = await tester.goLive();
        client.startVideo([{ rid: "100", quality: 100, ...patterns.high }], { type: "screen", fps });
        await sleep(4000);
        const before = client.stats.plisReceived;
        assert.ok(await friend.watch(tester.userId), "friend watch action");
        await sleep(seconds * 1000);
        const streamSsrc = client.videoStreams[0].ssrc;
        const rows = await friend.stats();
        const row = rows.find((r) => r.dir === "in" && r.ssrc === streamSsrc);
        report(name, { streamSsrc, web: rows, native: client.stats, rtcp: client.rtcpSummary(), plisBeforeWatching: before });
        check(name, row && row.framesDecoded > fps * (seconds - 3) && row.width === patterns.high.width, row);
        check(`${name}:keyframe-request`, client.stats.plisReceived > before, { plisReceived: client.stats.plisReceived, before });
        check(`${name}:receiver-reports`, client.rtcpSummary().rr > 0, client.rtcpSummary());
    } finally {
        await tester.leave();
        await friend.close();
    }
}

async function nativeCameraToWeb() {
    const name = "native-camera-web";
    const friend = await webUser("friend");
    const tester = await nativeUser("tester");
    try {
        assert.ok(await friend.joinVoice(), "friend voice action");
        await sleep(3000);
        const client = await tester.joinVoice([
            { type: "video", rid: "50", quality: 50 },
            { type: "video", rid: "100", quality: 100 },
        ]);
        assert.notEqual(client.ready.streams[0].ssrc, client.ready.streams[1].ssrc, "each simulcast layer has its own ssrc");
        client.startVideo(
            [
                { rid: "50", quality: 50, ...patterns.low },
                { rid: "100", quality: 100, ...patterns.high },
            ],
            { fps, dropEvery: 40 },
        );
        await sleep(seconds * 1000);
        const top = client.videoStreams[1].ssrc;
        const low = client.videoStreams[0].ssrc;
        const rows = await friend.stats();
        const row = rows.find((r) => r.dir === "in" && r.ssrc === top);
        report(name, { top, low, web: rows, native: client.stats, rtcp: client.rtcpSummary() });
        check(name, row && row.framesDecoded > fps * (seconds - 3) && row.width === patterns.high.width, row);
        check(`${name}:only-top-layer`, !rows.some((r) => r.dir === "in" && r.ssrc === low), rows);
        check(`${name}:rtx-repair`, client.stats.nacksReceived > 0 && client.stats.rtxSent > 0 && (row?.lost ?? 1) <= client.stats.videoSent / 40 / 4, client.stats);
    } finally {
        await tester.leave();
        await friend.close();
    }
}

async function webCameraToNative() {
    const name = "web-camera-native";
    const friend = await webUser("friend", { plainSender: true });
    const tester = await nativeUser("tester");
    try {
        const client = await tester.joinVoice();
        assert.ok(await friend.joinVoice(), "friend voice action");
        await sleep(4000);
        assert.ok(await friend.camera(true), "friend camera action");
        await sleep(seconds * 1000);
        const rows = await friend.stats();
        const outbound = rows.find((r) => r.dir === "out" && r.kind === "video");
        const friendId = (await call(tokens.friend, "GET", "/users/@me")).id;
        const announced = client.remoteVideo.get(friendId);
        const state = client.depacketizers.get(announced?.video_ssrc);
        const file = join(work, "web-camera.h264");
        writeFileSync(file, state?.depacketizer.annexB() ?? Buffer.alloc(0));
        const decoded = await decodeAnnexB(file);
        report(name, {
            announced,
            web: rows,
            native: client.videoReport(),
            decoded,
            rtcp: client.rtcpSummary(),
            undecryptable: client.undecryptable,
            plisSent: client.stats.plisSent,
        });
        check(name, announced && decoded.framesDecoded > 10 * (seconds - 4) && decoded.width === outbound?.width && decoded.decodeErrors === 0, { decoded, outbound });
        check(`${name}:clean-transport`, client.undecryptable === 0 && client.rtcpSummary().undecryptable === 0, { undecryptable: client.undecryptable });
    } finally {
        await tester.leave();
        await friend.close();
    }
}

async function nativeGoLiveToNative() {
    const name = "native-golive-native";
    const tester = await nativeUser("tester");
    const friend = await nativeUser("friend");
    try {
        await tester.joinVoice();
        await friend.joinVoice();
        const { client, streamKey } = await tester.goLive();
        client.startVideo([{ rid: "100", quality: 100, ...patterns.high }], { type: "screen", fps, dropEvery: 50 });
        await sleep(3000);
        const before = client.stats.plisReceived;
        const viewer = await friend.watch(streamKey);
        await sleep(seconds * 1000);
        const streamSsrc = client.videoStreams[0].ssrc;
        const state = viewer.depacketizers.get(streamSsrc);
        const file = join(work, "native-golive.h264");
        writeFileSync(file, state?.depacketizer.annexB() ?? Buffer.alloc(0));
        const decoded = await decodeAnnexB(file);
        report(name, {
            streamSsrc,
            announced: viewer.remoteVideo.get(tester.userId),
            viewer: viewer.videoReport(),
            decoded,
            streamer: client.stats,
            viewerStats: viewer.stats,
            rtcp: client.rtcpSummary(),
        });
        check(name, decoded.framesDecoded > fps * (seconds - 3) && decoded.width === patterns.high.width && decoded.decodeErrors === 0, decoded);
        check(`${name}:keyframe-request`, client.stats.plisReceived > before && (state?.depacketizer.keyframes ?? 0) > 0, { plisReceived: client.stats.plisReceived, before });
        const viewerVideo = viewer.videoReport().find((entry) => entry.ssrc === streamSsrc);
        check(`${name}:rtx-repair`, client.stats.rtxSent > 0 && viewerVideo?.recovered > 0 && viewerVideo.skipped === 0 && viewerVideo.broken === 0, {
            streamer: client.stats,
            viewer: viewerVideo,
        });
    } finally {
        await friend.leave();
        await tester.leave();
    }
}

async function webGoLiveToNative() {
    const name = "web-golive-native";
    const friend = await webUser("friend", { plainSender: true });
    const tester = await nativeUser("tester");
    try {
        await tester.joinVoice();
        assert.ok(await friend.joinVoice(), "friend voice action");
        await sleep(4000);
        step("friend goes live");
        assert.equal(await friend.goLive(), true, "friend go live action");
        step("friend is live");
        await sleep(4000);
        const friendId = (await call(tokens.friend, "GET", "/users/@me")).id;
        const viewer = await tester.watch(`guild:${guild.id}:${voice.id}:${friendId}`);
        step("tester watches");
        await sleep(seconds * 1000);
        const rows = await friend.stats();
        const announced = viewer.remoteVideo.get(friendId);
        const state = viewer.depacketizers.get(announced?.video_ssrc);
        const file = join(work, "web-golive.h264");
        writeFileSync(file, state?.depacketizer.annexB() ?? Buffer.alloc(0));
        const decoded = await decodeAnnexB(file);
        report(name, { announced, web: rows, native: viewer.videoReport(), decoded, plisSent: viewer.stats.plisSent, rtcp: viewer.rtcpSummary() });
        check(name, announced && decoded.framesDecoded > 5 * (seconds - 4) && decoded.decodeErrors === 0, { decoded });
    } finally {
        await tester.leave();
        await friend.close();
    }
}

const scenarios = {
    "native-golive-web": nativeGoLiveToWeb,
    "native-camera-web": nativeCameraToWeb,
    "web-camera-native": webCameraToNative,
    "native-golive-native": nativeGoLiveToNative,
    "web-golive-native": webGoLiveToNative,
};
try {
    for (const name of cases) {
        assert.ok(scenarios[name], `unknown case ${name}`);
        try {
            await scenarios[name]();
        } catch (error) {
            check(name, false, { error: String(error?.stack ?? error) });
        }
        await sleep(2000);
    }
} finally {
    await browser?.close();
    rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((result) => !result.ok);
report("summary", { mode, passed: results.length - failed.length, failed: failed.map((result) => result.case) });
process.exit(failed.length ? 1 : 0);
