# Native voice

The official Discord desktop apps (Stable, PTB, Canary, Development) use Discord's native voice engine, which talks to the voice server over UDP instead of WebRTC. With `NATIVE_VOICE=true` the voice gateway and the SFU speak that protocol for audio, and a native client and web clients hear each other in the same call. Camera video and Go Live over the native engine are stage 2 and not forwarded yet, so the setting is off by default.

## Turning it on

Set `NATIVE_VOICE=true` next to `PION_SFU_BIN` or `PION_SFU_IPC`. The server then:

- sends `NATIVE_VOICE: true` in `GLOBAL_ENV`, and `FosscordDesktop` lets the official desktop app pick its native engine instead of forcing the browser one,
- accepts `protocol: "udp"` in SELECT_PROTOCOL.

Without it, or without the Pion SFU, SELECT_PROTOCOL with `udp` is closed with code 4000 and the desktop app keeps the browser engine, as before. Browsers and the Discord OSS Electron app always use WebRTC.

No new port is needed. Native clients use the same UDP port as WebRTC, `WRTC_PORT` in Docker or `WRTC_PORT_MIN` for a native install.

## Voice gateway (`src/webrtc`)

- READY offers `aead_aes256_gcm_rtpsize` and `aead_xchacha20_poly1305_rtpsize`, with the SSRC, IP and port of the SFU.
- SELECT_PROTOCOL `udp` reads the mode from `data.mode` or the top-level `mode` the desktop app also sends. An unknown mode closes the socket with 4016. The server makes a 32-byte key, registers the client with the SFU over the `native` IPC message and answers SESSION_DESCRIPTION with `mode`, `secret_key` as 32 numbers, `audio_codec: "opus"`, `video_codec`, `media_session_id` and `dave_protocol_version`. It then publishes the client's audio the way opcode 12 does.
- CLIENTS_CONNECT, CLIENT_FLAGS, CLIENT_PLATFORM and the DAVE join are shared with the WebRTC path.
- A native client gets SPEAKING with every other user's SSRC whenever it subscribes to them, so it can tell whose audio a packet is.

## SFU (`extra/pion-sfu/native.go`)

- The socket the ICE mux reads from is wrapped. IP discovery requests, 74 bytes of type `0x0001` and length `70`, are answered with type `0x0002`, the SSRC, the observed address and the observed port. A STUN message can't match, because its length is a multiple of 4. Packets from an address that belongs to a native client, or that carry a native client's SSRC, go to that client. Everything else goes to ICE.
- The `native` IPC message carries `clientId`, `ssrc`, `mode` and a base64 `key`. The peer's unused peer connection is closed, its audio track is created for the SSRC and the usual `connected` event is sent.
- Receiving: the unencrypted part is the 12-byte header, the CSRCs and the 4-byte extension prefix. The last 4 bytes are a counter that starts the nonce, 12 bytes for AES-GCM and 24 for XChaCha20-Poly1305, with the header as AAD and a 16-byte tag. After decryption the extension body and any padding are dropped and the Opus payload enters the same audio track web publishers use. RTCP, keepalives and packets that don't decrypt are dropped. A packet that decrypts from a new address moves the client to it.
- Sending: web and native subscribers share the fanout. A native subscriber gets a 12-byte header with payload type 120 and the publisher's SSRC, sequence and timestamp, the payload sealed with its own key and a 4-byte counter appended. Header extensions from web publishers are not sent.
- Muting, deafening and moderation work as for web clients. The periodic stats log adds a `stats native=` line per native client with its address, packets, RTCP, foreign SSRCs, undecryptable packets and packets sent.

DAVE frames pass through untouched. The desktop app and web clients encrypt and decrypt them end to end, and the SFU only forwards them.

## Tests

- `go test ./...` in `extra/pion-sfu` covers IP discovery, both AEAD modes against an independent implementation, an extension header and padding, RTCP and tampered packets, two native clients through a real UDP socket, a web publisher reaching a native subscriber, mute and deafen.
- `scripts/dev/native-voice-probe.mjs` joins voice like the desktop app does: main gateway, voice gateway v8, IP discovery, SELECT_PROTOCOL `udp` and encrypted RTP. `--peer native` puts both test accounts on the native protocol and checks they hear each other. `--peer web` puts the friend in a headless browser and checks the browser decodes the native user. The probe speaks only `aead_aes256_gcm_rtpsize`, and it can't check the browser's audio reaching it because it has no DAVE.

On 2026-11-13 Discord PTB on macOS was pointed at a dev server through `WEBAPP_ENDPOINT` and `API_ENDPOINT` in its `settings.json` and joined a voice channel with a web user. PTB chose `aead_aes256_gcm_rtpsize` with DAVE version 1. The web user decoded 1,233 packets from PTB. PTB's native stats showed an inbound Opus stream from the web user with 270 DAVE frames decrypted, no failures and its audio level, and both users showed as speaking.

## Stage 2

Camera video and Go Live over the native protocol: opcode 12 video SSRCs, H264, VP8 and AV1 payloads, RTX, simulcast and the stream server connection.
