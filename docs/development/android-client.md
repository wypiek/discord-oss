# Discord's Android client

This page covers what Discord's React Native Android app does on the wire that the web client doesn't, what the server answers today, and how the Meowcord mobile bundle points the app at an instance. The wire details come from [docs.discord.food](https://docs.discord.food), the [Discord developer docs](https://discord.com/developers/docs), `scripts/dev/android-gateway-probe.mjs` and a run of Discord 349.9 Stable patched by KettuManager 1.2.2 in an Android 15 emulator on 2026-10-17. No APK or Discord code is in the repository.

## How the app would reach an instance

The app has `discord.com/api`, `gateway.discord.gg`, `cdn.discordapp.com` and `media.discordapp.net` compiled into its JavaScript bundle. There is no server picker. The mobile mod loaders, [Vendetta](https://github.com/vendetta-mod/Vendetta), [Bunny](https://github.com/bunny-mod/Bunny), [Revenge](https://github.com/notmarek/revenge) and [Kettu](https://codeberg.org/cocobo1/Kettu), install through a manager app or Xposed and run a JavaScript bundle before Discord's own code. [Aliucord](https://github.com/Aliucord/Aliucord) only supports the legacy Kotlin app at version 126.21 and is out of scope.

## The mobile bundle

`client/mobile` is a standalone script that Kettu loads in place of its own mod bundle. It doesn't use Kettu's plugin system, so any loader that runs a custom bundle before Discord's code can load it. `bun run build:mobile` typechecks it and writes `assets/public/mobile/meowcord.js`, which is committed like the E2EE bundle. The instance serves it at `/mobile/meowcord.js` and replaces a placeholder in it with the instance's public API, gateway and CDN endpoints from the config, or with the request's origin when those aren't set. Two query parameters change that:

- `?instance=https://chat.example` makes the bundle use that origin for all four hosts.
- `?debug=1` logs every rewritten URL, up to 100, and the first call of each native method whose arguments changed. The lines start with `[meowcord]` and show up in `adb logcat` under `ReactNativeJS`.

Setting `globalThis.__meowcordInstance` to an origin in a Kettu preload script overrides both.

### How the redirect works

The app runs on Hermes in React Native's bridgeless mode. `nativeModuleProxy` can't be replaced there because it is non-writable and non-configurable, and wrapping `nativeFabricUIManager` in a Proxy crashes the app with SIGSEGV because native code reads the global back as a host object. The bundle instead takes over Metro's `__d` before Discord's bundle defines any module, wraps every module factory and swaps the exports of three modules when they are first required:

- `TurboModuleRegistry`. Every native module it returns is wrapped, and each method call has its arguments rewritten up to five levels deep before it reaches native code. This covers `Networking.sendRequest` for REST and `WebSocketModule.connect` for the gateway.
- `NativeModules`. It gets the same wrapping for the older lookup path.
- `ReactNativeViewConfigRegistry`. Image props named `src`, `source`, `defaultSource` and similar get a `process` function, so Fresco loads avatars, icons and attachments from the instance.

A string argument is rewritten wherever one of the four hosts appears in it, not only when the whole string is a URL. The chat list is native, and `NativeChatModule.updateRows` gets its rows as one serialized JSON string with the avatar and attachment URLs inside it. Look-alike hosts such as `cdn.discordapp.com.evil.test` are left alone. `NativeMediaEngineModule` is not wrapped, because the voice engine breaks with "undefined is not a function" when it is.

### Setup

1. Install KettuManager and let it patch Discord. The patched app is `cocobo1.pupu.app`.
2. In Kettu's developer settings, turn on "Load from custom URL" and set it to `https://<instance>/mobile/meowcord.js`. With root, the same setting can be written before the first launch to `/data/data/cocobo1.pupu.app/files/pyoncord/loader.json` as `{"customLoadUrl":{"enabled":true,"url":"https://<instance>/mobile/meowcord.js"},"loadReactDevTools":false}`. Kettu downloads its default bundle from Codeberg until this is set.
3. Restart the app. Kettu downloads the bundle again on every launch.

The instance needs HTTPS with a certificate Android trusts. Discord's network security config refuses cleartext, and KettuManager's debuggable option didn't make it allow cleartext. For the emulator run a throwaway CA was added to the emulator's system store and a Bun TLS proxy forwarded `https://10.0.2.2:3332` to the dev server.

The first launch after patching crashed once in LSPatch's loader with "Original AppComponentFactory not found". The second launch worked.

### Push

UnifiedPush needs a native broadcast receiver, so plain JavaScript can't register with a distributor. The bundle calls `globalThis.__meowcordUnifiedPush.register({ instance, vapidKey })` when a native module or Xposed hook provides it. It then posts the returned endpoint and keys to `POST /users/@me/devices` as a `webpush` device, using the authorization header it sees on the app's first REST request. Without that bridge it logs "no UnifiedPush distributor bridge, skipping push registration" and does nothing. Kettu has no such bridge, so push on Android still needs a native piece.

## Encrypted DMs

The bundle runs the same E2EE engine as the web client. `client/mobile/src/e2ee` builds `client/e2ee/src/engine.ts`, `hooks.ts`, `link.ts`, `crypto.ts`, `backup.ts` and the rest of the protocol code unchanged, so envelopes, backups, device links and safety numbers are byte for byte the ones the web client makes. `scripts/build-mobile.js` swaps three things at build time:

- The globals `crypto`, `TextEncoder`, `TextDecoder`, `atob`, `btoa`, `document`, `navigator` and `addEventListener` point at `globalThis.__meowcordE2ee`, which the bundle fills before the engine runs.
- `./store` resolves to `client/mobile/src/e2ee/store.ts` when `client/e2ee/src` imports it. The web store keeps `CryptoKey` objects in IndexedDB, which Hermes doesn't have.
- `hash-wasm` resolves to `client/mobile/src/e2ee/argon2.ts`, because Hermes has no WebAssembly.

### WebCrypto on Hermes

`client/mobile/src/e2ee/subtle.ts` is a `crypto.subtle` built on `@noble/curves`, `@noble/ciphers` and `@noble/hashes`. It covers what the engine calls: Ed25519 and X25519 keys in raw and JWK form, Ed25519 sign and verify with strict ZIP 215 off, X25519 with the all-zero result refused, HKDF, HMAC, AES-GCM with a 128-bit tag and SHA-256, SHA-384 and SHA-512. Non-extractable keys can't be exported, and key material lives in a `WeakMap` outside the key object. `@hpke/core` runs on top of it like it does on a browser's WebCrypto.

Random numbers come from `RNGetRandomValues.getRandomBase64`, the native module behind the app's `react-native-get-random-values`, which reads `java.security.SecureRandom`. `client/mobile/src/e2ee/random.ts` also accepts `ExpoCrypto`. The global `crypto.getRandomValues` in the app is a JavaScript polyfill and isn't used. When neither native source answers with plausible bytes, the bundle logs "encryption is off" and refuses to send in encrypted conversations. It never falls back to `Math.random`.

Argon2id comes from `@noble/hashes` and yields to the event loop every 25 ms. The backup's 64 MiB, three-pass setting takes about 28 to 38 seconds on the arm64 emulator, against about 22 seconds when it blocks the UI thread.

### Key storage

Keys are written as JSON files under the app's documents directory in `meowcord-e2ee/` through `NativeFileModule`, which the app ships. Private keys are stored as JWK, since the shim's keys can be serialized and Hermes can't keep a `CryptoKey`. Android's app sandbox is the only protection for these files, the same as the app's own token storage. The app has no MMKV, AsyncStorage or Expo modules. Logging out runs the engine's `forget`, which deletes the keys from the phone like a web logout does. The device stays in the account's device list until it is removed from the web client.

### Hook points

The bundle finds Discord's modules by shape as Metro defines them, never by module id:

- the Flux dispatcher, through `addInterceptor`, `dispatch` and `subscribe`,
- the HTTP client with own `get`, `post`, `put`, `patch` and `del`, used to encrypt sends and edits and decrypt REST responses,
- the gateway store with `getSocket` and `isTryingToConnect`, whose socket's dispatch handlers decrypt `MESSAGE_CREATE` and `MESSAGE_UPDATE` before the app stores them,
- the channel store with `getChannel` and `getDMFromUserId`, to tell DMs from guild channels.

The wrapping is `createHooks` from `client/e2ee/src/hooks.ts`, the same code the web loader uses. The login password the app sends to `/auth/login` is kept in memory for the backup, as on the web. Attachments in encrypted conversations are refused with an error, because the file encryption path needs a service worker.

### Device approval

When the account already has keys, a fresh install logs in, derives the backup key from the login password and unlocks itself. On the emulator that took 42 seconds, and messages sent before the install decrypted. With a recovery-code backup, or when the password changed elsewhere, the device stays locked and asks the account's other devices to approve it. In the default trusted-server mode the web client approves a device signed in to the same account by itself. With trust turned off the web client shows the approval prompt with a short code. The Android app has no UI for that code yet, so the user can only approve from the web client without comparing it, and the code shows up only in `adb logcat` with `?debug=1`.

### Hermes quirks

Two Hermes bugs broke the engine, and `scripts/build-mobile.js` fixes both with Babel after `Bun.build`:

- Hermes gives every closure in a `for (const x of ...)` or `for (let i ...)` loop the last value of the loop variable. The app's own HTTP client builds `get`, `post` and the others in such a loop, so after wrapping, every request went out as `DELETE`. `@babel/plugin-transform-block-scoping` rewrites the bundle to `var` with per-iteration closures.
- An `async` arrow function with a destructured or default parameter receives `undefined` for its arguments. The Argon2 wrapper returned nothing and the backup failed with "AES key must be 16 or 24 or 32 bytes". `@babel/plugin-transform-parameters` moves those parameters into the body.

The build then refuses a bundle that still has `let`, `const`, an async arrow with complex parameters, `indexedDB`, `serviceWorker`, `WebAssembly` or a dynamic `import(`. `TextDecoder` doesn't exist yet when the bundle loads, so `client/mobile/src/e2ee/globals.ts` provides UTF-8 and base64 helpers.

With `?debug=1` the bundle runs known answer tests for every primitive 15 seconds after startup, against values computed with Bun's native WebCrypto and `hash-wasm`, and logs the E2EE status whenever it changes. `scripts/tests/mobile-webcrypto.test.cjs` checks the shim against Bun's WebCrypto in both directions, including an HPKE seal and open across the two.

## What the app sends

| Area | What the Android app does | Source |
| --- | --- | --- |
| Gateway URL | `?encoding=etf&v=9&compress=zstd-stream`, older builds `zlib-stream` | [Gateway](https://docs.discord.food/topics/gateway#encoding-and-compression) |
| ETF | Binary External Term Format. The client sends string map keys and never compresses what it sends. Snowflakes may arrive as 64-bit integers or strings. | [Using ETF encoding](https://docs.discord.food/topics/gateway#using-etf-encoding) |
| zstd-stream | One zstd context for the life of the connection. Each websocket message is one gateway payload and is flushed, but doesn't end the zstd frame. | [Zstd-stream compression](https://docs.discord.food/topics/gateway#zstd-stream-compression) |
| zlib-stream | One shared inflate context, each payload ends with the `00 00 ff ff` sync flush suffix. | same page |
| IDENTIFY | `properties.os` is `Android`, `browser` is `Discord Android`, plus `device`, `os_version` as the SDK level, `client_version` like `280.2 - rn` and `client_build_number`. `capabilities` is a bit field, `client_state` carries cached guild versions. | [Client properties](https://docs.discord.food/reference#client-properties), [capabilities](https://docs.discord.food/topics/gateway#gateway-capabilities) |
| REST headers | `X-Super-Properties` is the same properties object in base64, the user agent is `Discord-Android/<build>;RNA`. | [Client properties](https://docs.discord.food/reference#client-properties) |
| Lazy guilds | OP 14 for one guild and OP 37 for several guilds at once | [Opcodes](https://docs.discord.food/topics/opcodes-and-status-codes) |
| Push | `POST /users/@me/devices` with `provider: "gcm"` and an FCM token, `DELETE` with the same body on logout. `PATCH /users/@me` can carry `push_provider` and `push_token`. | [Push notifications](https://docs.discord.food/topics/push-notifications) |
| Images | Avatars, icons and emojis as `.webp` or `.png` with `?size=` | [Image formatting](https://discord.com/developers/docs/reference#image-formatting) |

## What works today

The probe logs in with Android super properties and user agent, calls the startup endpoints below and then runs the gateway four ways: ETF with zstd-stream, ETF with zlib-stream, plain ETF and JSON with zstd-stream. Every run gets READY with string IDs and real arrays, READY_SUPPLEMENTAL, a heartbeat ACK, a member list for OP 14 and for OP 37, and the MESSAGE_CREATE for a message sent over REST. On the seeded database a full run takes 4,839 bytes on the wire for 20,735 bytes of ETF with zstd-stream, and 4,740 bytes with zlib-stream.

A session that identifies as Android gets the `mobile` platform, so friends see the phone icon in `client_status`.

These startup endpoints answer with 2xx: `/experiments` with a fingerprint, `/auth/location-metadata`, `/users/@me`, `/users/@me/settings-proto/1` and `/2`, `/users/@me/consent`, both affinities lists, connections, billing subscriptions and payment sources, premium subscription slots, gift entitlements, library, mentions, `/users/@me/notification-center/items`, survey, referral eligibility, collectible purchases, email settings, application statistics, `/applications/detectable`, `/sticker-packs`, `/gateway`, `/voice/regions`, promotions, outbound promotions, `POST` and `DELETE /users/@me/devices`, `/science` and `/metrics/v2`.

The CDN serves the stored file whatever extension the URL asks for, so a `.webp` URL for a PNG avatar gets the PNG with `image/png`. Fresco, the image library React Native uses on Android, decodes by content, and the emulator run showed a PNG avatar requested as `.webp`.

## Bugs fixed for this client

- ETF frames from the client failed to decode. The old `harmony-erlpack` decoder turned `NIL_EXT`, the empty list Discord's erlpack writes for `activities: []`, into `undefined`, rejected every atom except `nil`, `true` and `false`, and had no `ATOM_UTF8`, `STRING_EXT`, `LARGE_BIG` or tuple support. An Android-style IDENTIFY was closed with 4002 every time. `src/gateway/util/Etf.ts` replaces it and checks lengths, nesting depth and trailing bytes.
- ETF output differed from JSON output. The encoder wrote `toJSON` results back into the shared payload and then encoded the original object, wrote `nil` for keys JSON drops, broke a map's arity when it skipped a function, sent integers above 2^32 such as millisecond timestamps as floats and wrote empty lists as a zero-length `LIST_EXT`. `Send` now encodes ETF from the exact JSON the json encoding sends, and empty lists use `NIL_EXT` like Discord's erlpack.
- zstd-stream sent every payload as its own finished frame from a fresh context, so nothing was shared between messages. `src/gateway/util/ZstdStream.ts` keeps one compression context per socket and flushes with `ZSTD_e_flush`. A repeated payload now costs a few bytes, and the JSON run above dropped from 5,963 to 4,301 bytes.
- `DELETE /users/@me/devices` and `GET /users/@me/notification-center/items` returned 404.
- Every message the app sent got 400. It sends `mobile_network_type` and `signal_strength` with each message, and the message schema didn't allow `signal_strength`. The schema now accepts both and the route drops them before the message is built.
- `GET /users/@me/settings-proto/3`, `GET /users/@me/devices/sync-token` and `PUT /users/@me/devices/sync` returned 404. Type 3 is `TEST_SETTINGS`, which the client never decodes, so the server answers with an empty proto and doesn't store updates. A sync token is the user id and the time it was issued, signed with an HMAC key derived from the instance's JWT key. It lasts 30 days and stops working when the account's sessions are revoked, for example by a password change. `PUT /users/@me/devices/sync` registers the device token for every account whose sync token checks out and lists the others in `invalid_push_sync_tokens`. One device token can now belong to several accounts, so the unique index on `push_devices` covers provider, token and user. The content inventory request this page used to list as missing is `GET /content-inventory/users/@me`, which already answered.

`scripts/tests/gateway-etf.test.cjs` covers the encoder and decoder byte by byte, the zstd stream, and `Send` producing the same payload for ETF and JSON.

## Verified in the emulator

The run used Discord 349.9 Stable (version code 349009) patched by KettuManager 1.2.2 on an Android 15 arm64 emulator, against a fresh seeded database.

- The app booted with the bundle. Logcat showed Kettu fetching `/mobile/meowcord.js`, the three patched modules and the gateway URL rewritten from `wss://gateway.discord.gg/?encoding=json&v=9&compress=zstd-stream` to the instance.
- Logging in with the seeded test account worked with `Discord-Android/349009;RNA`. The app registered a `gcm` device and opened the gateway.
- The guild list, the DM list, the guild channel and its history loaded.
- A message sent from the app in a guild channel was listed by `GET /channels/<id>/messages` over REST, and a message sent over REST as the second account appeared in the app.
- After the second account set an avatar over REST, the app fetched `/avatars/<id>/<hash>.webp?size=480` from the instance and showed it.
- Encrypted DMs, on 2026-10-17. At login the app created its identity, a device and a password backup in 39 seconds. A Bun script running the unmodified `client/e2ee` engine with Bun's WebCrypto, `hash-wasm` and an in-memory IndexedDB sent an encrypted DM as the other account, and the app showed it as plaintext in the notification, the DM list and the conversation. A DM typed in the app's composer was decrypted by that script. Both rows in `messages` had `🔒 Encrypted message` as content and the envelope in `encrypted`, and neither `pg_dump` of the database nor `server.log` contained either text. After a restart the device came back unlocked in 513 ms. After `pm clear` and a new login, a second device restored from the password backup in 42 seconds and showed both earlier messages.

## What doesn't work yet

- Attachments, stickers from the picker, polls and voice messages in encrypted DMs. Text works.
- Any E2EE UI. There is no Encryption settings page, no safety number screen and no approval prompt, and errors only reach `adb logcat`.
- Signing up. Registration asks for a [Cap](../features/signup.md) proof and the app only knows hCaptcha. Accounts have to be made on the web. Login works as long as `login.requireCaptcha` stays off.
- `POST /messages-log/private-channels/get` answers 404.
- Push, as described above.
- Voice. Nothing has tested the mobile app against `src/webrtc` and the SFU.
- The probe's capabilities value is 30717. Each bit's effect on the mobile READY shape has not been compared against Discord's.

## What can't work

Android push goes through Firebase Cloud Messaging. Sending to an FCM token needs a service account for the Firebase project the app was built with, and that project belongs to Discord. The server stores `gcm` registrations so the app doesn't retry them, but only `webpush` devices get notifications, see [notifications.md](../features/notifications.md). A mod can register a [UnifiedPush](https://unifiedpush.org) endpoint instead. UnifiedPush delivers through a distributor app the user picks, such as ntfy, and accepts the same `aes128gcm` and VAPID requests as Web Push, so the bundle sends `{ "provider": "webpush", "token": "{\"endpoint\":...,\"keys\":{\"p256dh\":...,\"auth\":...}}" }` and the server needs nothing new. Each payload carries the `user_id` it's for, so a device synced to several accounts can route it. The registration is written, the native distributor bridge is not.

## Running the probe

```sh
scripts/dev/worktree-setup.sh 3203 mc_android_gw
PORT=3203 bun scripts/dev/android-gateway-probe.mjs
```

It reads the seeded accounts from `scripts/dev/.test-account`, refuses any host other than localhost and exits with code 1 when a check fails.
