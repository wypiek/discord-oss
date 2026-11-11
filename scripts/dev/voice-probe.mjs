import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { chromiumPath } from "../util/chromium.cjs";

const require = createRequire(`${homedir()}/.cache/fosscord-tools/`);
const { chromium } = require("playwright-core");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);
const port = flag("port", process.env.PORT || "3001");
const wait = Number(flag("wait", "10")) * 1000;
const executablePath = flag("browser") || chromiumPath();
const video = has("video");
const dropVoice = has("drop-voice");
const origin = `http://fosscord.localhost:${port}`;
const api = `http://localhost:${port}/api/v9`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const accounts = Object.fromEntries(
    readFileSync(process.env.TEST_ACCOUNT_FILE || new URL("./.test-account", import.meta.url), "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split("=")),
);
const users = {
    tester: { login: accounts.TEST_EMAIL, password: accounts.TEST_PASSWORD },
    friend: { login: "friend@fosscord.test", password: accounts.FRIEND_PASSWORD },
};
const call = async (token, method, path, body) =>
    fetch(`${api}${path}`, {
        method,
        headers: { "content-type": "application/json", ...(token && { authorization: token }) },
        body: body && JSON.stringify(body),
    }).then((r) => r.json());
const tokens = Object.fromEntries(await Promise.all(Object.entries(users).map(async ([name, body]) => [name, (await call(undefined, "POST", "/auth/login", body)).token])));

const friendGuilds = new Set((await call(tokens.friend, "GET", "/users/@me/guilds")).map((g) => g.id));
const guild = (await call(tokens.tester, "GET", "/users/@me/guilds")).find((g) => friendGuilds.has(g.id));
if (!guild) throw new Error("tester and friend share no guild");
const channels = await call(tokens.tester, "GET", `/guilds/${guild.id}/channels`);
const voice = channels.find((c) => c.type === 2) ?? (await call(tokens.tester, "POST", `/guilds/${guild.id}/channels`, { name: "General", type: 2 }));

const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});

let closingBrowser = false;
browser.on("disconnected", () => {
    if (!closingBrowser) console.log(JSON.stringify({ label: "unexpected-browser-disconnect" }));
});
const pages = {};
const workerRouteHits = new Map();
try {
    for (const [name, token] of Object.entries(tokens)) {
        const context = await browser.newContext({ permissions: ["microphone", "camera"] });
        await context.addInitScript((value) => {
            localStorage.setItem("token", JSON.stringify(value));
            window.__pcs = [];
            window.__voiceSockets = [];
            window.__workerMessages = [];
            window.__workerDiagnostics = [];
            window.__workers = [];
            const NativeWorker = window.Worker;
            window.Worker = new Proxy(NativeWorker, {
                construct(target, args) {
                    const worker = new target(...args);
                    const path = String(args[0]).startsWith("blob:") ? "blob:" : new URL(String(args[0]), location.href).pathname;
                    window.__workers.push({ path, name: args[1]?.name });
                    worker.addEventListener("error", (event) => {
                        if (window.__workerDiagnostics.length < 300)
                            window.__workerDiagnostics.push({
                                event: "worker-error",
                                path,
                                message: event.message?.slice(0, 300),
                            });
                    });
                    worker.addEventListener("message", (event) => {
                        if (event.data?.fosscordVoiceDiagnostic && window.__workerDiagnostics.length < 300)
                            window.__workerDiagnostics.push({ path, ...event.data.fosscordVoiceDiagnostic });
                    });
                    const send = worker.postMessage.bind(worker);
                    worker.postMessage = (data, ...rest) => {
                        if (data && [0, 2, 3, 4].includes(data.type) && window.__workerMessages.length < 128)
                            window.__workerMessages.push({
                                path,
                                type: data.type,
                                userId: data.userId,
                                operation: data.operation,
                                protocolVersion: data.protocolVersion,
                                keyRatchet: !!data.keyRatchet,
                                audioSsrc: data.audioSsrc,
                                videoSsrcs: data.videoSsrcs,
                                audioCodec: data.audioCodec,
                                videoCodec: data.videoCodec,
                            });
                        return send(data, ...rest);
                    };
                    return worker;
                },
            });
            const Native = window.RTCPeerConnection;
            const setLocalDescription = Native.prototype.setLocalDescription;
            Native.prototype.setLocalDescription = function (...args) {
                if (!window.__pcs.includes(this)) window.__pcs.push(this);
                return setLocalDescription.apply(this, args);
            };
            window.RTCPeerConnection = new Proxy(Native, {
                construct(target, ctorArgs) {
                    const pc = new target(...ctorArgs);
                    window.__pcs.push(pc);
                    return pc;
                },
            });
            const NativeSocket = window.WebSocket;
            window.WebSocket = new Proxy(NativeSocket, {
                construct(target, ctorArgs) {
                    const socket = new target(...ctorArgs);
                    if (String(ctorArgs[0]).includes("encoding=")) return socket;
                    const entry = { socket, ops: [], closed: null };
                    window.__voiceSockets.push(entry);
                    socket.addEventListener("message", (event) => {
                        if (typeof event.data === "string") entry.ops.push(JSON.parse(event.data).op);
                        else if (event.data instanceof ArrayBuffer) entry.ops.push(new Uint8Array(event.data)[2]);
                    });
                    socket.addEventListener("close", (event) => (entry.closed = event.code));
                    return socket;
                },
            });
        }, token);
        await context.route(/^https:\/\/([a-z0-9-]+\.)*(discord|discordapp)\.(com|net|media|gg)\//, (route) => route.abort());
        if (has("diagnostics"))
            await context.route("**/assets/5aab2b617a1a39cd.js", async (route) => {
                workerRouteHits.set(name, (workerRouteHits.get(name) ?? 0) + 1);
                let source = readFileSync(new URL("../../assets/cache/5aab2b617a1a39cd.js", import.meta.url), "utf8");
                const replace = (needle, replacement) => {
                    assert.ok(source.includes(needle), `Worker instrumentation anchor missing: ${needle}`);
                    source = source.replace(needle, replacement);
                };
                replace(
                    "let o=t.Encrypt(i,r,u,e.data.byteLength,s);",
                    "let o=t.Encrypt(i,r,u,e.data.byteLength,s);self.__voiceFrames=(self.__voiceFrames||0)+1;if(self.__voiceFrames%100===1)postMessage({fosscordVoiceDiagnostic:{event:'encrypt',frames:self.__voiceFrames,result:o,size:e.data.byteLength,ssrc:r}});",
                );
                replace(
                    "r.pipeThrough(n).pipeTo(t)",
                    "r.pipeThrough(n).pipeTo(t).catch(error=>postMessage({fosscordVoiceDiagnostic:{event:'pipeline-error',error:String(error)}}))",
                );
                replace(
                    "function v(e,r){try{",
                    "function v(e,r){self.__voiceEntries=(self.__voiceEntries||0)+1;if(self.__voiceEntries%100===1)postMessage({fosscordVoiceDiagnostic:{event:'frame-entry',frames:self.__voiceEntries,size:e.data.byteLength,ssrc:e.getMetadata().synchronizationSource}});try{",
                );
                replace("self.onmessage=e=>{O(e)}", 'postMessage({fosscordVoiceDiagnostic:{event:"handler-installed"}});self.onmessage=e=>{O(e)}');
                replace('b="initialized",w)', 'b="initialized",postMessage({fosscordVoiceDiagnostic:{event:"wasm-ready"}}),w)');
                source =
                    'postMessage({fosscordVoiceDiagnostic:{event:"worker-start"}});self.addEventListener("unhandledrejection",event=>postMessage({fosscordVoiceDiagnostic:{event:"worker-rejection",message:String(event.reason).slice(0,300)}}));self.addEventListener("rtctransform",()=>postMessage({fosscordVoiceDiagnostic:{event:"rtctransform"}}));' +
                    source;
                await route.fulfill({ status: 200, contentType: "text/javascript", body: source });
            });
        const page = await context.newPage();
        page.on("crash", () => console.log(JSON.stringify({ label: "page-crash", user: name })));
        page.on("close", () => {
            if (!closingBrowser) console.log(JSON.stringify({ label: "unexpected-page-close", user: name }));
        });
        if (has("diagnostics")) {
            page.on("console", (message) => {
                if (/no ssrc found|no userId found|no user found|no cryptor found|error transforming frame|Failed to.*wasm/i.test(message.text()))
                    console.log(
                        JSON.stringify({
                            label: "worker-warning",
                            user: name,
                            message: message.text().slice(0, 300),
                        }),
                    );
            });
            page.on("requestfailed", (request) => {
                const pathname = new URL(request.url()).pathname;
                if (/\.(js|wasm)$/.test(pathname)) console.log(JSON.stringify({ label: "failed-worker-asset", user: name, path: pathname }));
            });
        }
        await page.goto(`${origin}/channels/@me`);
        pages[name] = page;
    }
    await sleep(15000);

    const invoke = (page, needle, method, arg) =>
        page.evaluate(
            ([needle, method, arg]) => {
                const requires = [];
                window.webpackChunkdiscord_app.push([[Symbol()], {}, (r) => requires.push(r)]);
                for (const req of requires)
                    for (const mid of Object.keys(req.m)) {
                        if (!req.m[mid].toString().includes(needle)) continue;
                        const exports = req(mid);
                        for (const key of Object.keys(exports))
                            if (typeof exports[key]?.[method] === "function") {
                                exports[key][method](arg);
                                return true;
                            }
                    }
                return false;
            },
            [needle, method, arg],
        );

    const stats = async (page) =>
        (
            await Promise.all(
                page.frames().map((frame) =>
                    frame
                        .evaluate(async () => {
                            const rows = [];
                            for (const pc of window.__pcs ?? []) {
                                if (pc.connectionState === "closed") continue;
                                (await pc.getStats()).forEach((r) => {
                                    if (r.type === "inbound-rtp" && r.bytesReceived)
                                        rows.push({
                                            dir: "in",
                                            kind: r.kind,
                                            ssrc: r.ssrc,
                                            bytes: r.bytesReceived,
                                            packets: r.packetsReceived,
                                            lost: r.packetsLost,
                                            nacksSent: r.nackCount,
                                            framesDecoded: r.framesDecoded,
                                            keyFrames: r.keyFramesDecoded,
                                            plisSent: r.pliCount,
                                            fps: r.framesPerSecond,
                                            freezes: r.freezeCount,
                                            freezeSeconds: r.totalFreezesDuration,
                                            width: r.frameWidth,
                                        });
                                    if (r.type === "outbound-rtp" && r.bytesSent)
                                        rows.push({
                                            dir: "out",
                                            kind: r.kind,
                                            ssrc: r.ssrc,
                                            bytes: r.bytesSent,
                                            packets: r.packetsSent,
                                            nacksReceived: r.nackCount,
                                            retransmitted: r.retransmittedPacketsSent,
                                            targetBitrate: r.targetBitrate,
                                            width: r.frameWidth,
                                        });
                                });
                            }
                            return rows;
                        })
                        .catch(() => []),
                ),
            )
        ).flat();

    const sockets = (page) =>
        page.evaluate(() => ({
            peerConnections: window.__pcs.filter((pc) => pc.connectionState !== "closed").map((pc) => pc.connectionState),
            voiceSockets: window.__voiceSockets.map((entry) => ({
                url: entry.socket.url,
                closed: entry.closed,
                ops: entry.ops.filter((op) => ![6].includes(op)),
            })),
        }));

    const report = async (label) => {
        for (const [name, page] of Object.entries(pages)) console.log(JSON.stringify({ label, user: name, channel: voice.name, media: await stats(page) }));
    };

    assert.equal(await invoke(pages.tester, "selectVoiceChannel(e){", "selectVoiceChannel", voice.id), true, "tester voice action found");
    await sleep(3000);
    assert.equal(await invoke(pages.friend, "selectVoiceChannel(e){", "selectVoiceChannel", voice.id), true, "friend voice action found");
    await sleep(3000);
    if (video) await invoke(pages.tester, "setVideoEnabled(e){", "setVideoEnabled", true);
    await sleep(wait);
    await report("connected");
    if (has("diagnostics"))
        for (const [name, page] of Object.entries(pages)) {
            console.log(
                JSON.stringify({
                    label: "worker-overlay",
                    user: name,
                    routeHits: workerRouteHits.get(name) ?? 0,
                    data: await page
                        .evaluate(() => ({
                            workers: window.__workers,
                            diagnostics: window.__workerDiagnostics,
                        }))
                        .catch(() => ({ closed: true })),
                }),
            );
            assert.ok(workerRouteHits.get(name) > 0, `${name} encryption worker overlay intercepted`);
        }
    if (has("diagnostics"))
        for (const [name, page] of Object.entries(pages))
            console.log(
                JSON.stringify({
                    label: "diagnostics",
                    user: name,
                    data: await page.evaluate(async () => ({
                        workers: window.__workers,
                        workerMessages: window.__workerMessages,
                        workerDiagnostics: window.__workerDiagnostics,
                        sockets: window.__voiceSockets.map((entry) => ({
                            closed: entry.closed,
                            ops: entry.ops,
                        })),
                        connections: await Promise.all(
                            window.__pcs.map(async (pc) => ({
                                state: pc.connectionState,
                                transceivers: pc.getTransceivers().map((t) => ({
                                    mid: t.mid,
                                    direction: t.direction,
                                    currentDirection: t.currentDirection,
                                    track: t.sender.track
                                        ? {
                                              kind: t.sender.track.kind,
                                              enabled: t.sender.track.enabled,
                                              state: t.sender.track.readyState,
                                              muted: t.sender.track.muted,
                                          }
                                        : null,
                                    encodings: t.sender.getParameters().encodings,
                                    dtls: t.sender.transport?.state,
                                    transform: !!t.sender.transform,
                                })),
                                stats: [...(await pc.getStats()).values()]
                                    .filter((r) => ["outbound-rtp", "inbound-rtp", "media-source"].includes(r.type))
                                    .map((r) => ({
                                        type: r.type,
                                        kind: r.kind,
                                        ssrc: r.ssrc,
                                        bytesSent: r.bytesSent,
                                        packetsSent: r.packetsSent,
                                        bytesReceived: r.bytesReceived,
                                        packetsReceived: r.packetsReceived,
                                        audioLevel: r.audioLevel,
                                        totalSamplesDuration: r.totalSamplesDuration,
                                    })),
                            })),
                        ),
                    })),
                }),
            );
    for (const [name, page] of Object.entries(pages)) {
        const media = await stats(page);
        assert.ok(
            media.some((r) => r.kind === "audio" && r.dir === "in" && r.packets > 0),
            `${name} received audio`,
        );
        assert.ok(
            media.some((r) => r.kind === "audio" && r.dir === "out" && r.packets > 0),
            `${name} sent audio`,
        );
    }

    const requireMedia = (name, media, kind, dir, before = []) => {
        assert.ok(
            media.some(
                (row) =>
                    row.kind === kind &&
                    row.dir === dir &&
                    row.packets > (before.find((previous) => previous.kind === kind && previous.dir === dir && previous.ssrc === row.ssrc)?.packets ?? 0),
            ),
            `${name} ${dir === "in" ? "received" : "sent"} fresh ${kind} packets`,
        );
    };
    if (video) {
        requireMedia("tester", await stats(pages.tester), "video", "out");
        requireMedia("friend", await stats(pages.friend), "video", "in");
    }

    if (dropVoice) {
        const beforeMedia = Object.fromEntries(await Promise.all(Object.entries(pages).map(async ([name, page]) => [name, await stats(page)])));
        const before = await sockets(pages.tester);
        await pages.tester.evaluate(() => window.__voiceSockets.at(-1).socket.close(4000));
        const friendVideo = has("video-during-drop") && (await invoke(pages.friend, "setVideoEnabled(e){", "setVideoEnabled", true));
        await sleep(Number(flag("resume-wait", "8")) * 1000);
        const after = await sockets(pages.tester);
        const friendSockets = await sockets(pages.friend);
        const resumedSocket = after.voiceSockets.at(-1);
        console.log(
            JSON.stringify({
                label: "voice-drop",
                peerConnectionsBefore: before.peerConnections,
                peerConnectionsAfter: after.peerConnections,
                socketsBefore: before.voiceSockets.length,
                socketsAfter: after.voiceSockets.length,
                resumedSocketOps: resumedSocket?.ops,
                gotResumed: resumedSocket?.ops.includes(9) ?? false,
                reidentified: resumedSocket?.ops.includes(2) ?? false,
                friendSawDisconnect: friendSockets.voiceSockets.some((entry) => entry.ops.includes(13)),
                friendVideo,
            }),
        );
        await sleep(wait);
        await report("after-resume");
        assert.ok(resumedSocket?.ops.includes(9), "tester resumed the voice websocket");
        for (const [name, page] of Object.entries(pages)) {
            const current = await stats(page);
            requireMedia(name, current, "audio", "in", beforeMedia[name]);
            requireMedia(name, current, "audio", "out", beforeMedia[name]);
        }
        if (video) {
            requireMedia("tester", await stats(pages.tester), "video", "out", beforeMedia.tester);
            requireMedia("friend", await stats(pages.friend), "video", "in", beforeMedia.friend);
        }
        if (friendVideo) {
            requireMedia("friend", await stats(pages.friend), "video", "out", beforeMedia.friend);
            requireMedia("tester", await stats(pages.tester), "video", "in", beforeMedia.tester);
        }
    }

    if (has("leave")) {
        const disconnectCount = (sockets) => sockets.voiceSockets.reduce((total, entry) => total + entry.ops.filter((op) => op === 13).length, 0);
        const previousDisconnects = disconnectCount(await sockets(pages.friend));
        const startedAt = Date.now();
        await invoke(pages.tester, "selectVoiceChannel(e){", "selectVoiceChannel", null);
        let seenAfter = null;
        while (Date.now() - startedAt < 10000 && seenAfter === null) {
            if (disconnectCount(await sockets(pages.friend)) > previousDisconnects) seenAfter = Date.now() - startedAt;
            else await sleep(100);
        }
        console.log(JSON.stringify({ label: "leave", friendSawDisconnectAfterMs: seenAfter }));
        assert.notEqual(seenAfter, null, "friend observed tester leave the voice channel");
    }
} finally {
    closingBrowser = true;
    await browser.close();
}
