import { createCipheriv, createDecipheriv } from "node:crypto";
import { createSocket } from "node:dgram";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";

export const NATIVE_MODES = ["aead_aes256_gcm_rtpsize", "aead_xchacha20_poly1305_rtpsize"];
export const NATIVE_CODECS = [
    { name: "opus", type: "audio", priority: 1000, payload_type: 120 },
    { name: "H264", type: "video", priority: 1000, payload_type: 101, rtx_payload_type: 102, encode: true, decode: true },
    { name: "VP8", type: "video", priority: 2000, payload_type: 105, rtx_payload_type: 106, encode: true, decode: true },
];
const NONCE_SUFFIX = 4;
const TAG = 16;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function transportCipher(mode, key) {
    if (key.length !== 32) throw new Error(`key is ${key.length} bytes`);
    const nonce = (suffix) => {
        const full = Buffer.alloc(mode === "aead_aes256_gcm_rtpsize" ? 12 : 24);
        suffix.copy(full, 0, 0, NONCE_SUFFIX);
        return full;
    };
    if (mode === "aead_aes256_gcm_rtpsize")
        return {
            seal(aad, plain, suffix) {
                const cipher = createCipheriv("aes-256-gcm", key, nonce(suffix), { authTagLength: TAG });
                cipher.setAAD(aad);
                return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
            },
            open(aad, sealed, suffix) {
                const decipher = createDecipheriv("aes-256-gcm", key, nonce(suffix), { authTagLength: TAG });
                decipher.setAAD(aad);
                decipher.setAuthTag(sealed.subarray(sealed.length - TAG));
                return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG)), decipher.final()]);
            },
        };
    if (mode === "aead_xchacha20_poly1305_rtpsize")
        return {
            seal: (aad, plain, suffix) => Buffer.from(xchacha20poly1305(key, nonce(suffix), aad).encrypt(plain)),
            open: (aad, sealed, suffix) => Buffer.from(xchacha20poly1305(key, nonce(suffix), aad).decrypt(sealed)),
        };
    throw new Error(`unsupported mode ${mode}`);
}

const counterSuffix = (counter) => {
    const suffix = Buffer.alloc(NONCE_SUFFIX);
    suffix.writeUInt32BE(counter >>> 0);
    return suffix;
};

export const isRtcp = (packet) => packet.length >= 8 && packet[0] >> 6 === 2 && packet[1] >= 192 && packet[1] <= 223;

export function rtpHeader({ payloadType, sequence, timestamp, ssrc, marker = false }) {
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = (marker ? 0x80 : 0) | payloadType;
    header.writeUInt16BE(sequence & 0xffff, 2);
    header.writeUInt32BE(timestamp >>> 0, 4);
    header.writeUInt32BE(ssrc >>> 0, 8);
    return header;
}

export function sealRtp(cipher, header, payload, counter) {
    const suffix = counterSuffix(counter);
    return Buffer.concat([header, cipher.seal(header, payload, suffix), suffix]);
}

export function openRtp(cipher, packet) {
    const headerLength = 12 + 4 * (packet[0] & 0x0f) + (packet[0] & 0x10 ? 4 : 0);
    const header = packet.subarray(0, headerLength);
    let payload = cipher.open(header, packet.subarray(headerLength, packet.length - NONCE_SUFFIX), packet.subarray(packet.length - NONCE_SUFFIX));
    if (packet[0] & 0x10) payload = payload.subarray(header.readUInt16BE(headerLength - 2) * 4);
    if (packet[0] & 0x20 && payload.length) payload = payload.subarray(0, payload.length - payload[payload.length - 1]);
    return {
        marker: (packet[1] & 0x80) !== 0,
        payloadType: packet[1] & 0x7f,
        sequence: packet.readUInt16BE(2),
        timestamp: packet.readUInt32BE(4),
        ssrc: packet.readUInt32BE(8),
        payload,
    };
}

export function sealRtcp(cipher, raw, counter) {
    const suffix = counterSuffix(counter);
    return Buffer.concat([raw.subarray(0, 8), cipher.seal(raw.subarray(0, 8), raw.subarray(8), suffix), suffix]);
}

export function openRtcp(cipher, packet) {
    const header = packet.subarray(0, 8);
    return Buffer.concat([header, cipher.open(header, packet.subarray(8, packet.length - NONCE_SUFFIX), packet.subarray(packet.length - NONCE_SUFFIX))]);
}

export function parseRtcp(raw) {
    const packets = [];
    for (let offset = 0; offset + 4 <= raw.length; ) {
        const count = raw[offset] & 0x1f;
        const type = raw[offset + 1];
        const length = (raw.readUInt16BE(offset + 2) + 1) * 4;
        const body = raw.subarray(offset, Math.min(offset + length, raw.length));
        if (type === 206 && count === 1) packets.push({ type: "pli", mediaSsrc: body.readUInt32BE(8) });
        else if (type === 206 && count === 15 && body.subarray(12, 16).toString() === "REMB") {
            const exponent = body[17] >> 2;
            const mantissa = ((body[17] & 3) << 16) | body.readUInt16BE(18);
            packets.push({ type: "remb", bitrate: mantissa * 2 ** exponent });
        } else if (type === 205 && count === 1) {
            const lost = [];
            for (let i = 12; i + 4 <= body.length; i += 4) {
                const pid = body.readUInt16BE(i);
                const blp = body.readUInt16BE(i + 2);
                lost.push(pid);
                for (let bit = 0; bit < 16; bit++) if (blp & (1 << bit)) lost.push((pid + bit + 1) & 0xffff);
            }
            packets.push({ type: "nack", mediaSsrc: body.readUInt32BE(8), lost });
        } else if (type === 201 || type === 200) {
            const reports = [];
            for (let i = type === 200 ? 28 : 8, n = 0; n < count && i + 24 <= body.length; n++, i += 24)
                reports.push({ ssrc: body.readUInt32BE(i), fractionLost: body[i + 4], totalLost: body.readUIntBE(i + 5, 3), highest: body.readUInt32BE(i + 8) });
            packets.push({ type: type === 200 ? "sr" : "rr", reports });
        } else packets.push({ type: `rtcp-${type}-${count}` });
        offset += length;
    }
    return packets;
}

export function pli(senderSsrc, mediaSsrc) {
    const raw = Buffer.alloc(12);
    raw[0] = 0x81;
    raw[1] = 206;
    raw.writeUInt16BE(2, 2);
    raw.writeUInt32BE(senderSsrc >>> 0, 4);
    raw.writeUInt32BE(mediaSsrc >>> 0, 8);
    return raw;
}

export function nack(senderSsrc, mediaSsrc, sequences) {
    const pairs = [];
    for (const sequence of [...new Set(sequences)].sort((a, b) => a - b)) {
        const last = pairs.at(-1);
        const distance = last ? (sequence - last.pid) & 0xffff : 0;
        if (last && distance > 0 && distance <= 16) last.blp |= 1 << (distance - 1);
        else pairs.push({ pid: sequence, blp: 0 });
    }
    const raw = Buffer.alloc(12 + pairs.length * 4);
    raw[0] = 0x81;
    raw[1] = 205;
    raw.writeUInt16BE(raw.length / 4 - 1, 2);
    raw.writeUInt32BE(senderSsrc >>> 0, 4);
    raw.writeUInt32BE(mediaSsrc >>> 0, 8);
    pairs.forEach((pair, i) => {
        raw.writeUInt16BE(pair.pid, 12 + i * 4);
        raw.writeUInt16BE(pair.blp, 14 + i * 4);
    });
    return raw;
}

export function splitAnnexB(data) {
    const units = [];
    let start = -1;
    for (let i = 0; i + 2 < data.length; i++) {
        if (data[i] !== 0 || data[i + 1] !== 0) continue;
        let codeLength = 0;
        if (data[i + 2] === 1) codeLength = 3;
        else if (data[i + 2] === 0 && data[i + 3] === 1) codeLength = 4;
        if (!codeLength) continue;
        if (start >= 0) units.push(data.subarray(start, i));
        start = i + codeLength;
        i += codeLength - 1;
    }
    if (start >= 0 && start < data.length) units.push(data.subarray(start));
    return units.map((unit) => {
        let end = unit.length;
        while (end > 1 && unit[end - 1] === 0) end--;
        return unit.subarray(0, end);
    });
}

export function accessUnits(data) {
    const frames = [];
    let current = [];
    for (const unit of splitAnnexB(data)) {
        if ((unit[0] & 0x1f) === 9) {
            if (current.length) frames.push(current);
            current = [];
            continue;
        }
        current.push(unit);
    }
    if (current.length) frames.push(current);
    return frames.map((units) => ({ units, keyframe: units.some((unit) => (unit[0] & 0x1f) === 5) }));
}

export function packetizeH264(units, mtu = 1100) {
    const payloads = [];
    for (const unit of units) {
        if (unit.length <= mtu) {
            payloads.push(unit);
            continue;
        }
        const indicator = (unit[0] & 0xe0) | 28;
        const type = unit[0] & 0x1f;
        for (let offset = 1; offset < unit.length; offset += mtu - 2) {
            const chunk = unit.subarray(offset, Math.min(offset + mtu - 2, unit.length));
            const header = (offset === 1 ? 0x80 : 0) | (offset + chunk.length >= unit.length ? 0x40 : 0) | type;
            payloads.push(Buffer.concat([Buffer.from([indicator, header]), chunk]));
        }
    }
    return payloads;
}

export class H264Depacketizer {
    frames = 0;
    keyframes = 0;
    broken = 0;
    chunks = [];
    #units = [];
    #fragment = null;
    #timestamp = null;
    #lastSequence = null;

    push({ payload, timestamp, marker, sequence }) {
        if (this.#lastSequence !== null && ((sequence - this.#lastSequence) & 0xffff) !== 1 && this.#fragment) {
            this.#fragment = null;
            this.broken++;
        }
        this.#lastSequence = sequence;
        if (this.#timestamp !== null && timestamp !== this.#timestamp) this.#flush();
        this.#timestamp = timestamp;
        if (!payload.length) return;
        const type = payload[0] & 0x1f;
        if (type >= 1 && type <= 23) this.#units.push(Buffer.from(payload));
        else if (type === 24)
            for (let i = 1; i + 2 <= payload.length; ) {
                const size = payload.readUInt16BE(i);
                this.#units.push(Buffer.from(payload.subarray(i + 2, i + 2 + size)));
                i += 2 + size;
            }
        else if (type === 28) {
            const start = payload[1] & 0x80;
            const end = payload[1] & 0x40;
            if (start) this.#fragment = [Buffer.from([(payload[0] & 0xe0) | (payload[1] & 0x1f)])];
            if (this.#fragment) this.#fragment.push(Buffer.from(payload.subarray(2)));
            if (end && this.#fragment) {
                this.#units.push(Buffer.concat(this.#fragment));
                this.#fragment = null;
            }
        }
        if (marker) this.#flush();
    }

    #flush() {
        if (this.#units.length) {
            this.frames++;
            if (this.#units.some((unit) => (unit[0] & 0x1f) === 5)) this.keyframes++;
            for (const unit of this.#units) this.chunks.push(Buffer.from([0, 0, 0, 1]), unit);
        }
        this.#units = [];
        this.#timestamp = null;
    }

    annexB() {
        return Buffer.concat(this.chunks);
    }
}

export async function encodeTestPattern(file, { seconds = 30, fps = 30, width = 640, height = 360 } = {}) {
    const encoder = Bun.spawn(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            `testsrc2=size=${width}x${height}:rate=${fps}:duration=${seconds}`,
            "-c:v",
            "libx264",
            "-profile:v",
            "baseline",
            "-pix_fmt",
            "yuv420p",
            "-bf",
            "0",
            "-x264-params",
            "keyint=100000:min-keyint=100000:scenecut=0:aud=1:repeat-headers=1",
            "-b:v",
            "800k",
            "-f",
            "h264",
            file,
        ],
        { stderr: "pipe" },
    );
    if ((await encoder.exited) !== 0) throw new Error(`ffmpeg could not encode the test pattern: ${await new Response(encoder.stderr).text()}`);
}

export async function decodeAnnexB(file) {
    const probe = Bun.spawn(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,width,height", "-of", "json", file], {
        stdout: "pipe",
        stderr: "pipe",
    });
    const [out, errors] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited]);
    const stream = JSON.parse(out || "{}").streams?.[0] ?? {};
    return { framesDecoded: Number(stream.nb_read_frames ?? 0), width: stream.width, height: stream.height, decodeErrors: errors.trim().split("\n").filter(Boolean).length };
}

export async function connectGateway({ port, token, name, properties = { os: "Mac OS X", browser: "Discord Client", release_channel: "ptb" } }) {
    const socket = new WebSocket(`ws://localhost:${port}/?v=9&encoding=json`);
    const events = {};
    const log = [];
    const waiters = new Set();
    let sequence = null;
    let heartbeat;
    socket.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        if (payload.s) sequence = payload.s;
        if (payload.op === 10) {
            socket.send(JSON.stringify({ op: 2, d: { token, capabilities: 16381, properties, compress: false } }));
            heartbeat = setInterval(() => socket.send(JSON.stringify({ op: 1, d: sequence })), payload.d.heartbeat_interval);
        }
        if (payload.t) {
            events[payload.t] = payload.d;
            log.push({ t: payload.t, d: payload.d });
        }
        for (const waiter of [...waiters]) waiter();
    };
    const until = (check, label, timeout = 15000) =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                waiters.delete(waiter);
                reject(new Error(`${name}: timed out waiting for ${label}`));
            }, timeout);
            const waiter = () => {
                const value = check();
                if (!value) return;
                clearTimeout(timer);
                waiters.delete(waiter);
                resolve(value);
            };
            waiters.add(waiter);
            waiter();
        });
    const ready = await until(() => events.READY, "READY");
    return {
        ready,
        events,
        log,
        until,
        send: (op, d) => socket.send(JSON.stringify({ op, d })),
        dispatched: (type, check = () => true) => until(() => [...log].reverse().find((entry) => entry.t === type && check(entry.d))?.d, type),
        close() {
            clearInterval(heartbeat);
            socket.close();
        },
    };
}

export class NativeVoiceClient {
    constructor({ name, mode = NATIVE_MODES[0], codecs = NATIVE_CODECS }) {
        this.name = name;
        this.mode = mode;
        this.codecs = codecs;
        this.h264 = codecs.find((codec) => codec.name === "H264");
        this.ops = {};
        this.waiters = new Set();
        this.counter = 0;
        this.rtcpIn = [];
        this.rtcpUndecryptable = 0;
        this.received = {};
        this.undecryptable = 0;
        this.depacketizers = new Map();
        this.remoteVideo = new Map();
        this.history = new Map();
        this.stats = { videoSent: 0, rtxSent: 0, plisReceived: 0, keyframesSent: 0, nacksReceived: 0, rtxReceived: 0, plisSent: 0, nacksSent: 0 };
    }

    until(op, label, check = () => true, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiters.delete(waiter);
                reject(new Error(`${this.name}: timed out waiting for voice op ${op} (${label})`));
            }, timeout);
            const waiter = () => {
                const found = (this.ops[op] ?? []).findLast(check);
                if (!found) return;
                clearTimeout(timer);
                this.waiters.delete(waiter);
                resolve(found);
            };
            this.waiters.add(waiter);
            waiter();
        });
    }

    send(op, d) {
        this.socket.send(JSON.stringify({ op, d }));
    }

    async connect({ endpoint, serverId, userId, sessionId, token, streams = [], video = false, channelId }) {
        this.socket = new WebSocket(`ws://${endpoint.replace(/^wss?:\/\//, "")}/?v=8`);
        let sequence = -1;
        this.closed = new Promise((resolve) => {
            this.socket.onclose = (event) => resolve({ code: event.code, reason: event.reason });
        });
        this.socket.onmessage = (event) => {
            if (typeof event.data !== "string") return;
            const payload = JSON.parse(event.data);
            if (typeof payload.seq === "number") sequence = payload.seq;
            (this.ops[payload.op] ??= []).push(payload.d);
            if (payload.op === 8) this.heartbeat = setInterval(() => this.send(3, { t: Date.now(), seq_ack: sequence }), payload.d.heartbeat_interval);
            if (payload.op === 12 && payload.d.user_id) this.remoteVideo.set(payload.d.user_id, payload.d);
            for (const waiter of [...this.waiters]) waiter();
        };
        await new Promise((resolve, reject) => {
            this.socket.onopen = resolve;
            this.socket.onerror = reject;
        });
        this.send(0, { server_id: serverId, channel_id: channelId, user_id: userId, session_id: sessionId, token, video, streams, max_dave_protocol_version: 0 });
        this.ready = await this.until(2, "READY");
        if (!this.ready.modes.includes(this.mode)) throw new Error(`${this.name}: server offers ${this.ready.modes.join(", ")}`);
        this.ssrc = this.ready.ssrc;

        this.udp = createSocket("udp4");
        await new Promise((resolve) => this.udp.bind(0, "127.0.0.1", resolve));
        const discovered = new Promise((resolve) => {
            this.udp.on("message", (message) => {
                if (message.length === 74 && message.readUInt16BE(0) === 2) resolve(message);
                else this.onPacket(message);
            });
        });
        const request = Buffer.alloc(74);
        request.writeUInt16BE(1, 0);
        request.writeUInt16BE(70, 2);
        request.writeUInt32BE(this.ssrc, 4);
        this.udp.send(request, this.ready.port, this.ready.ip);
        const response = await Promise.race([discovered, sleep(5000).then(() => null)]);
        if (!response) throw new Error(`${this.name}: no IP discovery response`);
        const address = response.subarray(8, 72).toString().replace(/\0.*$/s, "");
        const port = response.readUInt16BE(72);
        if (port !== this.udp.address().port) throw new Error(`${this.name}: discovery reported port ${port}, socket is on ${this.udp.address().port}`);

        this.send(1, { protocol: "udp", data: { address, port, mode: this.mode }, address, port, mode: this.mode, codecs: this.codecs });
        this.description = await this.until(4, "SESSION_DESCRIPTION");
        if (this.description.mode !== this.mode) throw new Error(`${this.name}: server chose ${this.description.mode}`);
        this.cipher = transportCipher(this.mode, Buffer.from(this.description.secret_key));
        return this;
    }

    write(packet) {
        this.udp.send(packet, this.ready.port, this.ready.ip);
    }

    sendRtp(header, payload) {
        this.write(sealRtp(this.cipher, header, payload, ++this.counter));
    }

    sendRtcp(raw) {
        this.write(sealRtcp(this.cipher, raw, ++this.counter));
    }

    onPacket(packet) {
        if (!this.cipher || packet.length < 12) return;
        if (isRtcp(packet)) {
            let raw;
            try {
                raw = openRtcp(this.cipher, packet);
            } catch {
                this.rtcpUndecryptable++;
                return;
            }
            for (const entry of parseRtcp(raw)) {
                this.rtcpIn.push(entry);
                if (entry.type === "pli") {
                    this.stats.plisReceived++;
                    this.keyframeWanted = true;
                }
                if (entry.type === "nack") {
                    this.stats.nacksReceived++;
                    this.resend(entry);
                }
            }
            return;
        }
        let pkt;
        try {
            pkt = openRtp(this.cipher, packet);
        } catch {
            this.undecryptable++;
            return;
        }
        this.received[pkt.ssrc] = (this.received[pkt.ssrc] ?? 0) + 1;
        const video = [...this.remoteVideo.values()].find((state) => state.video_ssrc === pkt.ssrc || (state.video_ssrc && (state.video_ssrc + 1) >>> 0 === pkt.ssrc));
        if (!video) return;
        if (pkt.ssrc !== video.video_ssrc) {
            if (pkt.payload.length < 2) return;
            this.stats.rtxReceived++;
            pkt = { ...pkt, sequence: pkt.payload.readUInt16BE(0), payload: pkt.payload.subarray(2), ssrc: video.video_ssrc, repaired: true };
        } else if (pkt.payloadType !== this.h264.payload_type) return;
        this.trackVideo(pkt);
    }

    trackVideo(pkt) {
        let state = this.depacketizers.get(pkt.ssrc);
        if (!state) {
            state = {
                depacketizer: new H264Depacketizer(),
                next: pkt.sequence,
                highest: pkt.sequence,
                buffer: new Map(),
                packets: 0,
                recovered: 0,
                skipped: 0,
                late: 0,
                firstAt: Date.now(),
            };
            this.depacketizers.set(pkt.ssrc, state);
        }
        state.packets++;
        const ahead = (pkt.sequence - state.next) & 0xffff;
        if (ahead >= 0x8000 || state.buffer.has(pkt.sequence)) {
            state.late++;
            return;
        }
        if (pkt.repaired || ((pkt.sequence - state.highest) & 0xffff) >= 0x8000) state.recovered++;
        state.buffer.set(pkt.sequence, { ...pkt, at: Date.now() });
        const gap = (pkt.sequence - state.highest) & 0xffff;
        if (gap > 0 && gap < 0x8000) {
            if (gap > 1 && gap < 1000) {
                const lost = [];
                for (let s = (state.highest + 1) & 0xffff; s !== pkt.sequence; s = (s + 1) & 0xffff) lost.push(s);
                this.sendRtcp(nack(this.ssrc, pkt.ssrc, lost));
                this.stats.nacksSent++;
            }
            state.highest = pkt.sequence;
        }
        while (state.buffer.size) {
            const ready = state.buffer.get(state.next);
            if (ready) {
                state.buffer.delete(state.next);
                state.depacketizer.push(ready);
                state.next = (state.next + 1) & 0xffff;
                continue;
            }
            const oldest = Math.min(...[...state.buffer.values()].map((entry) => entry.at));
            if (Date.now() - oldest < 300) break;
            state.skipped++;
            state.next = (state.next + 1) & 0xffff;
        }
        if (!state.depacketizer.keyframes && !state.pliAt && Date.now() - state.firstAt > 1000) {
            state.pliAt = Date.now();
            this.sendRtcp(pli(this.ssrc, pkt.ssrc));
            this.stats.plisSent++;
        }
    }

    resend({ mediaSsrc, lost }) {
        const stream = this.videoStreams?.find((entry) => entry.ssrc === mediaSsrc);
        if (!stream) return;
        for (const sequence of lost) {
            const original = this.history.get(`${mediaSsrc}:${sequence}`);
            if (!original) continue;
            const header = rtpHeader({
                payloadType: this.h264.rtx_payload_type,
                sequence: stream.rtxSequence++,
                timestamp: original.timestamp,
                ssrc: stream.rtx_ssrc,
                marker: original.marker,
            });
            const payload = Buffer.alloc(2 + original.payload.length);
            payload.writeUInt16BE(sequence);
            original.payload.copy(payload, 2);
            this.sendRtp(header, payload);
            this.stats.rtxSent++;
        }
    }

    startAudio() {
        this.send(5, { speaking: 1, delay: 0, ssrc: this.ssrc });
        let sequence = 0;
        this.audioTimer = setInterval(() => {
            sequence++;
            this.sendRtp(rtpHeader({ payloadType: 120, sequence, timestamp: sequence * 960, ssrc: this.ssrc }), Buffer.from([0xfc, 0xff, 0xfe, sequence & 0xff]));
        }, 20);
    }

    startVideo(layers, { type = "video", fps = 30, dropEvery = 0 } = {}) {
        this.videoStreams = layers.map((layer, index) => ({
            ...layer,
            ssrc: this.ready.streams[index].ssrc,
            rtx_ssrc: this.ready.streams[index].rtx_ssrc,
            rid: this.ready.streams[index].rid ?? layer.rid,
            sequence: Math.floor(Math.random() * 30000),
            rtxSequence: Math.floor(Math.random() * 30000),
            frame: 0,
        }));
        const streams = this.videoStreams.map((stream) => ({
            type,
            rid: stream.rid,
            ssrc: stream.ssrc,
            rtx_ssrc: stream.rtx_ssrc,
            active: true,
            quality: stream.quality,
            max_bitrate: 2500000,
            max_framerate: fps,
            max_resolution: { type: "fixed", width: stream.width, height: stream.height },
        }));
        const top = streams.reduce((best, stream) => (stream.quality > best.quality ? stream : best));
        this.send(12, { audio_ssrc: this.ssrc, video_ssrc: top.ssrc, rtx_ssrc: top.rtx_ssrc, streams });
        let tick = 0;
        this.videoTimer = setInterval(() => {
            tick++;
            const restart = this.keyframeWanted;
            this.keyframeWanted = false;
            for (const stream of this.videoStreams) {
                if (restart) stream.frame = 0;
                const frame = stream.frames[stream.frame % stream.frames.length];
                stream.frame++;
                if (frame.keyframe) this.stats.keyframesSent++;
                const payloads = packetizeH264(frame.units);
                const timestamp = Math.round((tick * 90000) / fps);
                payloads.forEach((payload, index) => {
                    const sequence = stream.sequence++ & 0xffff;
                    const marker = index === payloads.length - 1;
                    this.history.set(`${stream.ssrc}:${sequence}`, { payload, timestamp, marker });
                    this.history.delete(`${stream.ssrc}:${(sequence - 2048) & 0xffff}`);
                    this.stats.videoSent++;
                    if (dropEvery && this.stats.videoSent % dropEvery === 0) return;
                    this.sendRtp(rtpHeader({ payloadType: this.h264.payload_type, sequence, timestamp, ssrc: stream.ssrc, marker }), payload);
                });
            }
        }, 1000 / fps);
    }

    stopVideo() {
        clearInterval(this.videoTimer);
        this.send(12, { audio_ssrc: this.ssrc, video_ssrc: 0, rtx_ssrc: 0, streams: [] });
    }

    videoReport() {
        return [...this.depacketizers.entries()].map(([ssrc, state]) => ({
            ssrc,
            packets: state.packets,
            frames: state.depacketizer.frames,
            keyframes: state.depacketizer.keyframes,
            broken: state.depacketizer.broken,
            recovered: state.recovered,
            skipped: state.skipped,
            late: state.late,
        }));
    }

    rtcpSummary() {
        const summary = {};
        for (const entry of this.rtcpIn) summary[entry.type] = (summary[entry.type] ?? 0) + 1;
        const remb = this.rtcpIn.findLast((entry) => entry.type === "remb");
        const rr = this.rtcpIn.findLast((entry) => entry.type === "rr");
        return { ...summary, undecryptable: this.rtcpUndecryptable, lastRemb: remb?.bitrate, lastReceiverReport: rr?.reports };
    }

    close() {
        clearInterval(this.heartbeat);
        clearInterval(this.audioTimer);
        clearInterval(this.videoTimer);
        try {
            this.udp?.close();
        } catch {}
        this.socket?.close();
    }
}
