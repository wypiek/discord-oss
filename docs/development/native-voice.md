# Native voice

The official Discord desktop apps (Stable, PTB, Canary, Development) use Discord's native voice engine, which talks to the voice server over UDP instead of WebRTC. With `NATIVE_VOICE=true` the voice gateway and the SFU speak that protocol for audio, camera video and Go Live, and native clients and web clients hear and see each other in the same call or stream. Audio was checked with Discord PTB. Video was checked only with the headless native client simulator described below, so the setting stays off by default until a real desktop app has streamed through it.

## Turning it on

Set `NATIVE_VOICE=true` next to `PION_SFU_BIN` or `PION_SFU_IPC`. The server then:

- sends `NATIVE_VOICE: true` in `GLOBAL_ENV`, and `FosscordDesktop` lets the official desktop app pick its native engine instead of forcing the browser one,
- accepts `protocol: "udp"` in SELECT_PROTOCOL.

Without it, or without the Pion SFU, SELECT_PROTOCOL with `udp` is closed with code 4000 and the desktop app keeps the browser engine, as before. Browsers and the Discord OSS Electron app always use WebRTC.

No new port is needed. Native clients use the same UDP port as WebRTC, `WRTC_PORT` in Docker or `WRTC_PORT_MIN` for a native install.

## Voice gateway (`src/webrtc`)

- READY offers `aead_aes256_gcm_rtpsize` and `aead_xchacha20_poly1305_rtpsize`, with the SSRC, IP and port of the SFU. Each stream in IDENTIFY's `streams` gets its own video SSRC and RTX SSRC in READY's `streams`, so a camera with simulcast layers `50` and `100` sends each layer on its own SSRC. The native engine sends on the SSRCs READY gives it.
- SELECT_PROTOCOL `udp` reads the mode from `data.mode` or the top-level `mode` the desktop app also sends, and the Opus and H264 payload types and the H264 RTX payload type from `codecs`. An unknown mode closes the socket with 4016. The server makes a 32-byte key, registers the client with the SFU over the `native` IPC message and answers SESSION_DESCRIPTION with `mode`, `secret_key` as 32 numbers, `audio_codec: "opus"`, `video_codec: "H264"`, `media_session_id` and `dave_protocol_version`. On a Go Live connection it adds `keyframe_interval: 5000`, so a streamer sends a keyframe at least every 5 seconds even if keyframe requests don't reach it. It then publishes the client's audio the way opcode 12 does.
- Opcode 12 publishes the active stream with the highest `quality` and its RTX SSRC. Viewers get opcode 12 with that one stream. A later opcode 12 that makes another layer the top one republishes video on that layer.
- CLIENTS_CONNECT, CLIENT_FLAGS, CLIENT_PLATFORM and the DAVE join are shared with the WebRTC path.
- A native client gets SPEAKING with every other user's SSRC whenever it subscribes to them, so it can tell whose audio a packet is.

## SFU (`extra/pion-sfu/native.go`)

- The socket the ICE mux reads from is wrapped. IP discovery requests, 74 bytes of type `0x0001` and length `70`, are answered with type `0x0002`, the SSRC, the observed address and the observed port. A STUN message can't match, because its length is a multiple of 4. Packets from an address that belongs to a native client, or that carry one of a native client's SSRCs, go to that client. Everything else goes to ICE.
- The `native` IPC message carries `clientId`, `ssrc`, `mode`, a base64 `key` and the payload types. Missing payload types default to 120 for Opus, 101 for H264 and 102 for RTX. The peer's unused peer connection is closed, its audio track is created for the SSRC and the usual `connected` event is sent. A `publish` message for video carries `ssrc` and `rtxSsrc` and creates the native client's video track.
- RTP: the unencrypted part is the 12-byte header, the CSRCs and the 4-byte extension prefix. The last 4 bytes are a counter that starts the nonce, 12 bytes for AES-GCM and 24 for XChaCha20-Poly1305, with the header as AAD and a 16-byte tag. After decryption the extension body and any padding are dropped. Opus enters the same audio track web publishers use. H264 on the video SSRC enters the video track when its payload type is the client's H264 payload type, and other codecs are counted as `wrong_codec` and dropped. RTX packets on the RTX SSRC are unwrapped into the video track with their original sequence number. Packets that don't decrypt are dropped. A packet that decrypts from a new address moves the client to it.
- RTCP: the 8-byte header, with the packet type and the sender SSRC, stays in the clear as AAD. The rest of the compound packet is sealed the same way as RTP, with the 4-byte counter appended. RTP and RTCP share one counter per client, so no nonce repeats. RTCP from a native viewer is applied to the track it names: PLI and FIR ask that publisher for a keyframe, NACK is answered from the packet cache, receiver reports feed the loss-based bitrate cap and REMB is honoured, as for web viewers.
- Feedback to a native publisher goes out as sealed RTCP: PLI when a viewer subscribes or asks, NACK for gaps in its video, and once a second a REMB and a receiver report for its audio and video SSRCs with the fraction lost, the cumulative loss and the extended highest sequence number.
- Sending: web and native subscribers share the fanout. A native subscriber gets a 12-byte header with its own Opus or H264 payload type and the publisher's SSRC, sequence and timestamp, the payload sealed with its own key and a 4-byte counter appended. A native viewer's NACK is answered with RTX on the publisher's SSRC plus one, with the viewer's RTX payload type. Header extensions from web publishers are not sent, and empty padding packets are not forwarded.
- Muting, deafening and moderation work as for web clients. The periodic stats log adds a `stats native=` line per native client with its address, packets, video and RTX packets, wrong codec packets, RTCP received and handled, foreign SSRCs, undecryptable packets, packets sent, video packets sent and RTCP sent.

DAVE frames pass through untouched. The desktop app and web clients encrypt and decrypt them end to end, and the SFU only forwards them. The Go tests check that an H264 payload, including a DAVE trailer, reaches the viewer byte for byte.

## Tests

- `go test ./...` in `extra/pion-sfu` covers IP discovery, both AEAD modes against an independent implementation, an extension header and padding, RTCP and tampered packets, sealed RTCP in both modes, two native clients through a real UDP socket, a web publisher reaching a native subscriber, mute and deafen, native video reaching a native viewer with its own payload type, RTX unwrapping, video in another codec being dropped, a native viewer's PLI and NACK reaching the native streamer as sealed RTCP, a web publisher's video reaching a native viewer, and receiver reports across a sequence wrap.
- `scripts/dev/native-voice-probe.mjs` joins voice like the desktop app does: main gateway, voice gateway v8, IP discovery, SELECT_PROTOCOL `udp` and encrypted RTP. `--peer native` puts both test accounts on the native protocol and checks they hear each other. `--peer web` puts the friend in a headless browser and checks the browser decodes the native user.
- `scripts/dev/native-client.mjs` is a headless native client. It speaks the main gateway, opcode 18 STREAM_CREATE and opcode 20 STREAM_WATCH for Go Live, the voice gateway with SELECT_PROTOCOL `udp` and its codec list, IP discovery and both AEAD modes, sends an H264 test pattern that ffmpeg encodes with a single keyframe at the start, answers PLI by restarting from that keyframe and NACK with RTX, and receives, reorders, NACKs and depacketizes video into a file that ffprobe decodes. It has no DAVE, so it joins with `max_dave_protocol_version: 0`. `scripts/dev/native-client.test.mjs` tests its packet code.
- `scripts/dev/native-video-probe.mjs` runs the scenarios below. Run it through `scripts/dev/outside-app.sh`, because it keeps headless Chromium open for several minutes. `--case` picks scenarios, `--mode` the AEAD mode and `--seconds` how long each one measures.

The web client refuses DAVE version 0, so a browser can't join a call without DAVE. For the cases where a browser sends video to the simulator, the probe turns off `encodedInsertableStreams` and the browser's sender transform, so the simulator gets plain H264 it can decode. A browser receiving from the simulator keeps DAVE on and decodes the simulator's frames, which have no DAVE trailer, as pass-through frames. The probe also replaces `getDisplayMedia`, which Equicord otherwise turns into a source picker, with a 1280x720 canvas.

Measured on 2026-11-14 on a Mac against a local server, 10 seconds per case, 30 fps for the simulator:

| Case | What runs | Result with AES256-GCM | Result with XChaCha20-Poly1305 |
| --- | --- | --- | --- |
| `native-golive-web` | The simulator goes live, a browser watches 4 seconds later | 282 frames decoded at 640x360, no loss, no freezes. The streamer got 5 more PLIs after the viewer joined, 14 receiver reports and 14 REMBs of 10 Mbps. | 281 frames decoded at 640x360, no loss, no freezes, with the same RTCP counts |
| `native-camera-web` | The simulator sends camera layers `50` (320x180) and `100` (640x360) and drops every 40th packet | 289 frames decoded at 640x360 from layer `100` only, 0 packets lost after 26 NACKs answered with 26 RTX packets | 264 frames decoded at 640x360 from layer `100` only, 0 packets lost after 27 RTX repairs, 2 freezes |
| `web-camera-native` | A browser turns its fake camera on | The simulator decoded 114 of the browser's 114 encoded frames at 1280x720 with no decode errors | 112 of 112 frames decoded at 1280x720 with no decode errors |
| `native-golive-native` | One simulator goes live with every 50th packet dropped, another watches | 296 frames decoded at 640x360 with no decode errors. 27 RTX repairs from the streamer, 21 late packets filled in at the viewer, none skipped. | 297 frames decoded at 640x360 with no decode errors, 27 RTX repairs, 21 late packets filled in, none skipped |
| `web-golive-native` | A browser goes live, the simulator watches | 298 frames decoded with no decode errors | 296 frames decoded with no decode errors |

### What only a real desktop app can confirm

- That the desktop app sends H264 with the payload type it lists in `codecs` and announces its layers the way the simulator does.
- That it accepts the sealed RTCP layout above, so PLI, NACK, REMB and receiver reports reach its encoder and bandwidth estimator. If it doesn't, a viewer still gets a keyframe within 5 seconds from `keyframe_interval` on Go Live, but camera viewers may wait for the next keyframe the app sends on its own and the bitrate stays at the app's start rate.
- That `keyframe_interval` is in milliseconds, as the unofficial docs say.
- That it decodes video from web publishers without the header extensions the SFU leaves out, such as playout delay.
- DAVE between the desktop app and web clients for video. Audio DAVE was confirmed with PTB.

On 2026-11-13 Discord PTB on macOS was pointed at a dev server through `WEBAPP_ENDPOINT` and `API_ENDPOINT` in its `settings.json` and joined a voice channel with a web user. PTB chose `aead_aes256_gcm_rtpsize` with DAVE version 1. The web user decoded 1,233 packets from PTB. PTB's native stats showed an inbound Opus stream from the web user with 270 DAVE frames decrypted, no failures and its audio level, and both users showed as speaking.
