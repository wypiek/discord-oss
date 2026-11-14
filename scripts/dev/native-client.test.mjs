import assert from "node:assert/strict";
import { test } from "node:test";
import { H264Depacketizer, nack, openRtcp, openRtp, packetizeH264, parseRtcp, pli, rtpHeader, sealRtcp, sealRtp, splitAnnexB, transportCipher } from "./native-client.mjs";

const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 7));

test("both transport modes round trip RTP and keep the header in the clear", () => {
    for (const mode of ["aead_aes256_gcm_rtpsize", "aead_xchacha20_poly1305_rtpsize"]) {
        const cipher = transportCipher(mode, key);
        const header = rtpHeader({ payloadType: 101, sequence: 65535, timestamp: 90000, ssrc: 0xfeedbeef, marker: true });
        const packet = sealRtp(cipher, header, Buffer.from("frame"), 7);
        assert.deepEqual(packet.subarray(0, 12), header);
        assert.equal(packet.readUInt32BE(packet.length - 4), 7);
        const opened = openRtp(cipher, packet);
        assert.deepEqual(
            { marker: opened.marker, payloadType: opened.payloadType, sequence: opened.sequence, ssrc: opened.ssrc, payload: opened.payload.toString() },
            { marker: true, payloadType: 101, sequence: 65535, ssrc: 0xfeedbeef, payload: "frame" },
        );
        const tampered = Buffer.from(packet);
        tampered[3] ^= 1;
        assert.throws(() => openRtp(cipher, tampered));
    }
});

test("RTCP feedback is sealed after its 8 byte header and parses back", () => {
    const cipher = transportCipher("aead_xchacha20_poly1305_rtpsize", key);
    const sealed = sealRtcp(cipher, Buffer.concat([pli(1, 2), nack(1, 3, [10, 11, 13, 40])]), 9);
    assert.equal(sealed[1], 206);
    assert.deepEqual(parseRtcp(openRtcp(cipher, sealed)), [
        { type: "pli", mediaSsrc: 2 },
        { type: "nack", mediaSsrc: 3, lost: [10, 11, 13, 40] },
    ]);
});

test("H264 access units survive FU-A packetization", () => {
    const sps = Buffer.from([0x67, 0x42, 0xc0, 0x1e]);
    const idr = Buffer.concat([Buffer.from([0x65]), Buffer.alloc(3000, 0xab)]);
    const units = splitAnnexB(Buffer.concat([Buffer.from([0, 0, 0, 1]), sps, Buffer.from([0, 0, 1]), idr]));
    assert.deepEqual(units, [sps, idr]);
    const payloads = packetizeH264(units, 1100);
    assert.deepEqual(payloads[0], sps);
    assert.ok(payloads.slice(1).every((payload) => (payload[0] & 0x1f) === 28));
    const depacketizer = new H264Depacketizer();
    payloads.forEach((payload, index) => depacketizer.push({ payload, timestamp: 3000, sequence: index, marker: index === payloads.length - 1 }));
    assert.equal(depacketizer.frames, 1);
    assert.equal(depacketizer.keyframes, 1);
    assert.deepEqual(splitAnnexB(depacketizer.annexB()), [sps, idr]);
});
