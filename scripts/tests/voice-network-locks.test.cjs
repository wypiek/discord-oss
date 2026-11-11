const { test } = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");

const { entity, IsNull, load } = require("./federation-fake-orm.cjs");
const voiceUtil = require("../../src/util/util/federation/Voice.ts");
const protocol = require("../../src/util/util/federation/Protocol.ts");
const ids = require("../../src/util/util/federation/Ids.ts");

const HOST_DELAY = 400;
const host = "host.example";
const user = "1290000000000000100";
const session = "0123456789abcdef0123456789abcdef";

function federationHarness() {
    const db = {
        Channel: entity("Channel"),
        Guild: entity("Guild"),
        Member: entity("Member", ["id", "guild_id"]),
        Recipient: entity("Recipient", ["channel_id", "user_id"]),
        User: entity("User"),
        VoiceState: entity("VoiceState", ["user_id"]),
    };
    db.VoiceState.prototype.toPublicVoiceState = function () {
        return { ...this };
    };
    const { serialized } = load("src/api/util/utility/federationMirrors.ts", {
        typeorm: {},
        "@spacebar/database": {},
        "@spacebar/schemas": {},
        "@spacebar/util": {},
        "./federationIds": {},
        "./federationQuota": {},
    });
    const relays = {};
    const fetches = [];
    const emitted = [];
    const answers = [];
    const voice = load("src/api/util/utility/federationVoice.ts", {
        "node:module": { createRequire: () => () => ({}) },
        "node:path": require("node:path"),
        ws: { __esModule: true, default: class {}, WebSocketServer: class {} },
        typeorm: { IsNull },
        "@spacebar/database": db,
        "@spacebar/util": {
            ...protocol,
            ...ids,
            ...voiceUtil,
            FederatedVoice: {
                connected: new Set(),
                setRelay: (relay) => (relays.voice = relay),
                setStreamRelay: () => {},
                setRemoteCalls: () => {},
                apply: async () => null,
            },
            Config: { get: () => ({ federation: { enabled: true } }) },
            emitEvent: async (event) => emitted.push(event),
            isPublicUrl: async () => true,
            publicTunnel: async () => null,
        },
        "./federation": { instanceUrl: () => "https://home.example" },
        "./federationIds": { canonicalOf: async (id) => `${id}@${host}`, fromWire: async (value) => value, toWire: async (value) => value },
        "./federationMirrors": { mirrorInstance: async (kind, id) => (kind === "guild" && id === "200" ? host : null), serialized },
        "./federationNetwork": {
            ownInstance: () => "home.example",
            signedFetch: async (instance, method, path, body) => {
                fetches.push(body);
                await sleep(HOST_DELAY);
                return answers.shift() ?? { status: 200, body: { voice_state: { channel_id: body.channel_id ? "700" : null, self_mute: body.self_mute } } };
            },
        },
        "./federationRelay": {},
        "./federationShadows": { profileOf: () => ({}), upsertShadows: async () => undefined },
    });
    voice.startFederatedVoice();
    db.Channel.rows.push({ id: "700", guild_id: "200" });
    db.User.rows.push({ id: user, federated_instance: null });
    return { db, voice, serialized, relay: (body) => relays.voice(user, session, body), fetches, emitted, answers };
}

const timed = async (work) => {
    const started = performance.now();
    await work;
    return performance.now() - started;
};

test("inbox voice events don't wait for a relay to a slow host", async () => {
    const { db, voice, serialized, relay } = federationHarness();
    db.VoiceState.rows.push({ user_id: user, guild_id: "200", channel_id: "700", session_id: session });
    const others = Array.from({ length: 9 }, (_, i) => `12900000000000002${String(i).padStart(2, "0")}`);
    for (const id of others) {
        db.User.rows.push({ id, federated_instance: host });
        db.VoiceState.rows.push({ user_id: id, guild_id: "200", channel_id: "700", session_id: "remote" });
    }
    const relaying = relay({ guild_id: "200", channel_id: "700", self_mute: true, self_deaf: false });
    await sleep(20);
    const inGuildOrder = (work) => serialized("guild:200", work);
    const [ownEcho, nextGuildEvent, serverUpdate] = await Promise.all([
        timed(
            inGuildOrder(() =>
                voice.applyRemoteVoiceState({ user_id: user, channel_id: "700", session_id: voiceUtil.hostVoiceSession(session), self_mute: true }, { guild_id: "200" }),
            ),
        ),
        timed(inGuildOrder(() => voice.applyRemoteVoiceState({ user_id: others[0], channel_id: "700", session_id: "remote", self_mute: true }, { guild_id: "200" }))),
        timed(voice.applyVoiceServerUpdate({ token: "fresh" }, { guild_id: "200" }, [user, ...others])),
    ]);
    await relaying;
    console.log(
        `[voice locks] host delay ${HOST_DELAY} ms: relaying user's own event ${ownEcho.toFixed(1)} ms, next event of the server ${nextGuildEvent.toFixed(1)} ms, server update for 10 users ${serverUpdate.toFixed(1)} ms`,
    );
    assert.ok(ownEcho < HOST_DELAY / 4, `the relaying user's event waited ${ownEcho} ms`);
    assert.ok(nextGuildEvent < HOST_DELAY / 4, `the next event of the server waited ${nextGuildEvent} ms`);
    assert.ok(serverUpdate < HOST_DELAY / 4, `the server update waited ${serverUpdate} ms`);
    assert.equal(db.VoiceState.rows.find((row) => row.user_id === user).token, "fresh");
});

test("a host event that arrives during the relay wins over the relay answer", async () => {
    const { db, voice, relay } = federationHarness();
    db.VoiceState.rows.push({ user_id: user, guild_id: "200", channel_id: "700", session_id: session, mute: false });
    const relaying = relay({ guild_id: "200", channel_id: "700", self_mute: true, self_deaf: false });
    await sleep(20);
    await voice.applyRemoteVoiceState({ user_id: user, channel_id: "700", session_id: voiceUtil.hostVoiceSession(session), self_mute: true, mute: true }, { guild_id: "200" });
    await relaying;
    const row = db.VoiceState.rows.find((entry) => entry.user_id === user);
    assert.equal(row.mute, true, "the server mute from the host stays");
    assert.equal(row.self_mute, true);
});

test("relays of one user still reach the host in order", async () => {
    const { db, relay, fetches } = federationHarness();
    db.VoiceState.rows.push({ user_id: user, guild_id: "200", channel_id: "700", session_id: session });
    await Promise.all([
        relay({ guild_id: "200", channel_id: "700", self_mute: true, self_deaf: false }),
        relay({ guild_id: "200", channel_id: "700", self_mute: false, self_deaf: false }),
        relay({ guild_id: "200", channel_id: null, self_mute: false, self_deaf: false }),
    ]);
    assert.deepEqual(
        fetches.map((body) => [body.self_mute, body.leave]),
        [
            [true, false],
            [false, false],
            [false, true],
        ],
    );
    assert.equal(db.VoiceState.rows.find((row) => row.user_id === user).channel_id, null);
});

test("a refused leave still leaves locally after a host event", async () => {
    const { db, voice, relay, answers } = federationHarness();
    db.VoiceState.rows.push({ user_id: user, guild_id: "200", channel_id: "700", session_id: session });
    answers.push({ status: 502, body: { error: "unreachable" } });
    const relaying = relay({ guild_id: "200", channel_id: null, self_mute: false, self_deaf: false });
    await sleep(20);
    await voice.applyRemoteVoiceState({ user_id: user, channel_id: "700", session_id: voiceUtil.hostVoiceSession(session), mute: true }, { guild_id: "200" });
    await relaying;
    assert.equal(db.VoiceState.rows.find((row) => row.user_id === user).channel_id, null);
});

const STALL = 5;
const ROOM_SIZE = 25;
const opcodes = { SESSION_DESCRIPTION: 4, SPEAKING: 5, VIDEO: 12, CLIENTS_CONNECT: 11, CLIENT_DISCONNECT: 13, MEDIA_SINK_WANTS: 15, CLIENT_FLAGS: 18, CLIENT_PLATFORM: 20 };

async function fakeSfu(delay) {
    const socketPath = path.join(os.tmpdir(), `meowcord-voice-locks-${process.pid}-${Math.random().toString(16).slice(2)}.sock`);
    const stats = { inFlight: 0, maxInFlight: 0, subscribes: 0 };
    const server = net.createServer((socket) => {
        let buffer = Buffer.alloc(0);
        const reply = (id, payload) => {
            const body = Buffer.from(JSON.stringify({ id, type: "response", payload }));
            const header = Buffer.alloc(4);
            header.writeUInt32BE(body.length);
            socket.write(Buffer.concat([header, body]));
        };
        socket.on("data", (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32BE(0)) {
                const message = JSON.parse(buffer.subarray(4, 4 + buffer.readUInt32BE(0)).toString());
                buffer = buffer.subarray(4 + buffer.readUInt32BE(0));
                const { payload } = message;
                if (payload.type === "join") reply(message.id, { type: "joined", clientId: payload.clientId });
                if (payload.type !== "subscribe") continue;
                stats.subscribes++;
                stats.inFlight++;
                stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
                setTimeout(() => {
                    stats.inFlight--;
                    reply(message.id, { type: "subscribed", clientId: payload.clientId, ssrc: 4242 });
                }, delay);
            }
        });
    });
    await new Promise((resolve) => server.listen(socketPath, resolve));
    return { socketPath, stats, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function voiceRoom(size, sfuDelay, sendDelay = 0) {
    const sfu = await fakeSfu(sfuDelay);
    const previous = process.env.PION_SFU_IPC;
    process.env.PION_SFU_IPC = sfu.socketPath;
    const { IpcClient } = require("../../src/webrtc/pion/IpcClient.ts");
    const { PionMediaServer } = load(
        "src/webrtc/pion/PionMediaServer.ts",
        {
            "node:child_process": require("node:child_process"),
            "node:crypto": require("node:crypto"),
            "node:events": require("node:events"),
            "@spacebar/util": { turnSecret: () => "", turnSettings: () => ({ enabled: false }) },
            "./IpcClient": { IpcClient },
        },
        { process },
    );
    const mediaServer = new PionMediaServer();
    await mediaServer.start("127.0.0.1", 3539);
    if (previous === undefined) delete process.env.PION_SFU_IPC;
    else process.env.PION_SFU_IPC = previous;
    const sent = [];
    const Send = async (socket, data) => {
        sent.push({ to: socket.user_id, op: data.op });
        if (sendDelay) await sleep(sendDelay);
    };
    const sockets = [];
    for (let i = 0; i < size; i++) {
        const socket = { user_id: `1290000000000001${String(i).padStart(3, "0")}`, type: "guild-voice", version: 8, readyState: 1 };
        socket.webRtcClient = await mediaServer.join("700", socket.user_id, socket, "guild-voice");
        socket.webRtcClient.webrtcConnected = true;
        socket.webRtcClient.initIncomingSSRCs({ audio_ssrc: 1000 + i });
        sockets.push(socket);
    }
    return {
        sfu,
        sockets,
        sent,
        webrtc: { mediaServer, Send, VoiceOPCodes: opcodes },
        close: async () => {
            await mediaServer.stop();
            await sfu.close();
        },
    };
}

test("publishing audio subscribes the room without one SFU round trip per member in a row", async () => {
    const room = await voiceRoom(ROOM_SIZE, STALL);
    try {
        const { onVideo } = load("src/webrtc/opcodes/Video.ts", {
            "@spacebar/database": { Stream: {} },
            "@spacebar/webrtc": room.webrtc,
            "@spacebar/schemas": { validateSchema: (name, data) => data },
        });
        const [publisher] = room.sockets;
        const elapsed = await timed(onVideo.call(publisher, { op: 12, d: { audio_ssrc: 1000, video_ssrc: 0, rtx_ssrc: 0, streams: [] } }));
        console.log(
            `[voice locks] audio publish in a room of ${ROOM_SIZE} with ${STALL} ms per SFU reply: ${elapsed.toFixed(1)} ms, at most ${room.sfu.stats.maxInFlight} subscribes in flight`,
        );
        assert.equal(room.sfu.stats.subscribes, ROOM_SIZE - 1);
        for (const socket of room.sockets.slice(1)) assert.ok(socket.webRtcClient.isSubscribedToTrack(publisher.user_id, "audio"));
        assert.equal(room.sent.filter((entry) => entry.op === opcodes.VIDEO).length, ROOM_SIZE - 1);
        assert.ok(elapsed < (ROOM_SIZE - 1) * STALL * 0.5, `publishing took ${elapsed} ms`);
    } finally {
        await room.close();
    }
});

test("joining and leaving don't wait for each member's socket in turn", async () => {
    const room = await voiceRoom(ROOM_SIZE, 0, STALL);
    try {
        const dave = { DAVE_PROTOCOL_VERSION: 1, DaveSession: { find: () => undefined, get: () => ({ join: async () => {} }) } };
        const { onSelectProtocol } = load("src/webrtc/opcodes/SelectProtocol.ts", {
            "@spacebar/schemas": { validateSchema: (name, data) => data },
            "@spacebar/webrtc": room.webrtc,
            "../dave/DaveSession": dave,
            "../util/DaveIdentity": { daveIds: () => ({}) },
        });
        const { VoiceSessions } = load("src/webrtc/util/VoiceSessions.ts", {
            "@spacebar/database": {},
            "../dave/DaveSession": dave,
            "./Constants": { VoiceOPCodes: opcodes },
            "./MediaServer": { mediaServer: room.webrtc.mediaServer },
            "./Send": { Send: room.webrtc.Send, write: async () => {} },
            "./WebRtcWebSocket": {},
        });
        const [joining] = room.sockets;
        room.webrtc.mediaServer.onOffer = async () => ({ sdp: "", selectedVideoCodec: "H264" });
        joining.maxDaveVersion = 0;
        const joined = await timed(onSelectProtocol.call(joining, { op: 1, d: { protocol: "webrtc", sdp: "", codecs: [] } }));
        assert.deepEqual(
            room.sent.filter((entry) => entry.to === room.sockets[1].user_id).map((entry) => entry.op),
            [opcodes.CLIENTS_CONNECT, opcodes.CLIENT_FLAGS, opcodes.CLIENT_PLATFORM],
        );
        assert.equal(room.sent.filter((entry) => entry.to === joining.user_id).length, 2 + 2 * (ROOM_SIZE - 1));
        room.sent.length = 0;
        const left = await timed(VoiceSessions.end(joining));
        assert.equal(room.sent.filter((entry) => entry.op === opcodes.CLIENT_DISCONNECT).length, ROOM_SIZE - 1);
        console.log(`[voice locks] ${STALL} ms per socket write in a room of ${ROOM_SIZE}: join ${joined.toFixed(1)} ms, leave ${left.toFixed(1)} ms`);
        assert.ok(joined < (ROOM_SIZE - 1) * STALL, `joining took ${joined} ms`);
        assert.ok(left < (ROOM_SIZE - 1) * STALL * 0.5, `leaving took ${left} ms`);
    } finally {
        await room.close();
    }
});
