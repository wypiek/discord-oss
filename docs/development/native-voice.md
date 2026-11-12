# Native voice (work in progress)

The official Discord desktop apps use Discord's native voice engine, which speaks UDP to the voice server instead of WebRTC. The voice gateway in `src/webrtc` only accepts `protocol: "webrtc"` today, so `FosscordDesktop` forces the WebRTC engine in those apps. This page is the plan for stage 1, audio over the native protocol. Nothing below is implemented yet.

## Stage 1: audio

### SFU (`extra/pion-sfu`)

- The SFU keeps its single UDP port. A wrapper around the socket the ICE mux reads from hands two kinds of packets to a native handler and passes everything else to ICE:
  - IP discovery requests: 74 bytes, type `0x0001`, length `70`. STUN can't match, because a STUN length is always a multiple of 4. The handler answers with type `0x0002`, the SSRC, the observed address as a null-terminated string in 64 bytes, and the observed port. It remembers the address for that SSRC.
  - Any packet from an address that belongs to a registered native client.
- A new IPC message `native` carries `clientId`, `ssrc`, `mode` and a base64 `key`. It marks the peer as native, closes its unused peer connection, sets `transport` to nil so no RTCP sinks are made, creates the audio `PublishedTrack` for the SSRC and sends the usual `connected` event.
- Receiving: drop packets shorter than 12 bytes, packets that aren't RTP version 2, and RTCP (`b[1]` 200 to 204). The unencrypted part is the 12-byte header, the CSRCs and the 4-byte extension prefix when the X bit is set. The last 4 bytes are the nonce counter, written big-endian into the start of a 12-byte nonce for `aead_aes256_gcm_rtpsize` or a 24-byte nonce for `aead_xchacha20_poly1305_rtpsize`, with the header as AAD and a 16-byte tag. After decryption, skip the extension body (prefix length times 4 bytes) and any padding, then `ingest` the Opus payload into the audio track. Packets from other SSRCs (video) are dropped until stage 2.
- Sending: `ingest` calls a per-subscriber `forward`. Web subscribers write to their multiplex track as today. Native subscribers get a 12-byte header with payload type 120, the publisher's SSRC, sequence and timestamp, no extensions, the payload sealed with their key and an incrementing 4-byte nonce appended.
- `handlePublish` skips adding a transceiver for native peers. A ticker expires the loss tracker of native tracks, since nothing sends NACKs to native publishers.
- Go tests: IP discovery round trip, both AEAD modes, and forwarding between two fake UDP clients.

### Voice gateway (`src/webrtc`)

- READY offers only `aead_aes256_gcm_rtpsize` and `aead_xchacha20_poly1305_rtpsize`.
- SELECT_PROTOCOL with `protocol: "udp"` checks the mode, makes a 32-byte key, sends `native` over IPC, then answers SESSION_DESCRIPTION with `mode`, `secret_key` as a number array, `audio_codec: "opus"`, `video_codec`, `media_session_id` and `dave_protocol_version`. It then publishes the audio track the way op 12 does, and shares the CLIENTS_CONNECT, CLIENT_FLAGS and CLIENT_PLATFORM code with the WebRTC branch.
- Native subscribers get SPEAKING with each publisher's SSRC, so the client can map SSRCs to users.

### Client and config

- `NATIVE_VOICE=true` turns it on. GLOBAL_ENV gets `NATIVE_VOICE`, and `FosscordDesktop.allowEngine` lets the official app pick its native engine only then. It stays off by default, because camera video and Go Live over the native engine aren't forwarded until stage 2, and with the native engine on, the official app would stream nothing.
- With the native engine active, the DAVE preload and clips wrapper patches are skipped. They only exist for the WebRTC engine inside the official app.

### Testing

Point Discord PTB at a worktree dev server through `WEBAPP_ENDPOINT` and `API_ENDPOINT` in its `settings.json`, after backing that file up, and drive it over CDP next to a headless web client from `voice-probe.mjs`. Restore the file afterwards.

## Stage 2

Camera video and Go Live over the native protocol: op 12 video SSRCs, H264, VP8 and AV1 payloads, RTX, simulcast and the stream server connection.
