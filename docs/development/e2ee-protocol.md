# Encryption protocol

This is the wire format of encrypted DMs and group DMs, protocol version 1, for anyone writing a client other than the web one. [e2ee.md](../features/e2ee.md) describes what users see and the security model. The reference implementation is `client/e2ee/src`, mainly `crypto.ts`, `engine.ts`, `backup.ts`, `files.ts` and `link.ts`, and the server side is `src/api/util/utility/e2ee.ts` and the routes under `src/api/routes/e2ee` and `src/api/routes/users/@me/e2ee`. The server holds a second implementation in Node's crypto: `src/api/util/utility/systemEncryption.ts` encrypts the official account's messages, and `src/api/util/utility/reports.ts` verifies and decrypts reported ones. It is the shorter of the two to port. When this page and the code disagree, the code wins, and the page is wrong.

`/.well-known/discord-oss` reports the version as `e2ee.protocol`, as [instance-discovery.md](instance-discovery.md) describes.

## Conventions

- Binary values travel as base64url without padding (RFC 4648 section 5).
- Every string that is signed, used as AAD, used as an HKDF info or hashed is UTF-8 with fields joined by a single `\n` and no trailing newline.
- Every label starts with `fosscord-e2ee/v1/`. The prefix keeps the project's old name on purpose, because changing it would break every existing key and message.
- User, channel and message ids are decimal snowflake strings.

## Primitives

| Use | Algorithm |
| --- | --- |
| Signatures | Ed25519 (RFC 8032), 32-byte public keys, 64-byte signatures. |
| Key agreement | X25519 (RFC 7748), 32-byte public keys. |
| Wrapping content keys | HPKE base mode (RFC 9180) with DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 and AES-256-GCM. `enc` is 32 bytes. |
| Message and file encryption | AES-256-GCM with a 12-byte nonce and a 16-byte tag appended to the ciphertext. |
| Key derivation | HKDF-SHA256 with a 32-byte output. |
| Password stretching | Argon2id v1.3 with 64 MiB of memory, 3 iterations, parallelism 1 and a 32-byte output. |

The envelope names this suite as `alg: "x25519-hpke-aes256gcm-ed25519"`.

A **box** is AES-256-GCM output with its nonce in front: `nonce (12 bytes) || ciphertext || tag (16 bytes)`, base64url encoded. A box shorter than 28 bytes is invalid.

## Keys

| Key | Type | Owner | Notes |
| --- | --- | --- | --- |
| Identity key | Ed25519 | One per user | Signs the user's devices, backup key and identity rotations. Safety numbers are computed over it. |
| Device key | Ed25519 | One per client install | Signs messages and the device's prekeys. |
| Signed prekey | X25519 | One current per device | Content keys are wrapped to it. Rotate it every 7 days and keep a retired private prekey for 30 days, so messages wrapped to it can still be read. |
| Backup key | X25519 | One per user | Every message also wraps its content key to each member's backup key, so any device that opens the backup reads the history. |
| Backup secret | 32 random bytes | One per user | Opens the backup. |

The **device id** is the first 16 bytes of SHA-256 over the raw 32-byte device public key, base64url encoded, so 22 characters. The server recomputes it and refuses a device whose id doesn't match.

### Signed statements

| Statement | Signed by | Text |
| --- | --- | --- |
| Device | Identity key | `fosscord-e2ee/v1/device\n<user_id>\n<device_id>\n<device_signing_key>` |
| Prekey | Device key | `fosscord-e2ee/v1/prekey\n<device_id>\n<prekey_id>\n<prekey_public_key>`, with `prekey_id` as a decimal integer. |
| Backup key | Identity key | `fosscord-e2ee/v1/backup-key\n<user_id>\n<backup_public_key>` |
| Identity rotation | Previous identity key | `fosscord-e2ee/v1/identity-rotate\n<user_id>\n<previous_public_key>\n<next_public_key>` |
| Server recovery copy | Identity key | `fosscord-e2ee/v1/server-recovery\n<user_id>\n<identity_key>\n<backup_version>\n<device_id>\n<base64url(SHA-256(backup_secret))>` |

## Key directory

`POST /api/v9/e2ee/keys/query` with `{ "channel_id": "<id>" }` returns the keys of the channel's members and lists their ids in `channel_members`. With `{ "user_ids": [...] }` it returns the keys of the caller's friends and of people who are or were in a DM or group DM with the caller, and leaves other users out. A request covers at most 100 users. Both answer:

```json
{
    "users": {
        "<user_id>": {
            "identity_key": "<base64url>",
            "identity_created_at": "2026-11-01T12:00:00.000Z",
            "previous_identity": { "public_key": "<base64url>", "signature": "<rotation signature>" },
            "backup_key": { "public_key": "<base64url>", "signature": "<backup key signature>" },
            "devices": [
                {
                    "device_id": "<22 characters>",
                    "signing_key": "<base64url>",
                    "identity_signature": "<device statement signature>",
                    "status": "active",
                    "name": "Firefox on Linux",
                    "prekey": { "id": 3, "public_key": "<base64url>", "signature": "<prekey statement signature>" },
                    "revoked_at": null
                }
            ]
        }
    }
}
```

The server is not trusted to vouch for keys. A client keeps a device only when all of these hold, and drops it otherwise:

1. The device id matches its signing key.
2. `identity_signature` verifies against the user's identity key. For a revoked device, the client also tries identity keys it saw for that user before.
3. The prekey statement verifies against the device's signing key.

It keeps the backup key only when its signature verifies against the identity key.

When a contact's identity key changes, a client accepts the new key silently when `previous_identity` is the key it knew and the rotation statement verifies. Otherwise it treats the change as a safety number change. A client in strict mode blocks sending to that contact until the user reviews it. A client in default mode accepts the new key and marks the contact unverified.

## Messages

### Sending

1. Fetch the keys of every member, yourself included, and collect each verified `active` device. Always include your own sending device, even if the directory doesn't list it yet.
2. Pick the binding. A new message uses `n:<nonce>`, where `nonce` is the `nonce` field of the message create request, which then becomes required. An edit uses `m:<message_id>` and sets `mid` in the envelope.
3. Build the AAD: `fosscord-e2ee/v1/msg\n<channel_id>\n<sender_user_id>\n<sender_device_id>\n<binding>`.
4. Draw a random 32-byte content key and a random 12-byte nonce, and encrypt the UTF-8 JSON payload with AES-256-GCM under that AAD. `iv` is the nonce and `ct` is ciphertext and tag.
5. For each device, HPKE seal the content key to its prekey with info `fosscord-e2ee/v1/wrap` and AAD `<message AAD>\n<device_id>`.
6. For each member with a verified backup key, yourself included, HPKE seal the content key to the backup key with info `fosscord-e2ee/v1/backup-wrap` and AAD `<message AAD>\nbackup:<user_id>`.
7. List the ids of members other than yourself that the plaintext mentions as `<@id>` or `<@!id>` outside code spans and code blocks in `mentions`, so the server can notify them. Leave the field out when nobody is mentioned.
8. Sign the canonical form below with the device key.

```json
{
    "v": 1,
    "alg": "x25519-hpke-aes256gcm-ed25519",
    "sender_device": "<device_id>",
    "iv": "<12 bytes>",
    "ct": "<ciphertext and tag>",
    "keys": [{ "user_id": "<id>", "device_id": "<id>", "prekey_id": 3, "enc": "<32 bytes>", "wrapped": "<48 bytes>" }],
    "backup": [{ "user_id": "<id>", "enc": "<32 bytes>", "wrapped": "<48 bytes>" }],
    "mentions": ["<id>"],
    "sig": "<64 bytes>"
}
```

Send it as `encrypted` in `POST /api/v9/channels/<id>/messages`, with `content` empty or `🔒 Encrypted message`, and in `PATCH /api/v9/channels/<id>/messages/<id>` for an edit. `backup` and `mentions` are left out when empty, and `mid` appears only on edits.

### Signature

The signed bytes are the UTF-8 of `JSON.stringify` of this array, with no whitespace:

```
[
  "fosscord-e2ee/v1/sig", channel_id, sender_user_id, binding,
  v, alg, sender_device, mid or null, iv, ct,
  keys sorted by device_id, each as [user_id, device_id, prekey_id, enc, wrapped],
  backup sorted by user_id, each as [user_id, enc, wrapped]       (only when backup is present),
  {"mentions": mentions sorted}                                    (only when mentions is present)
]
```

`v` and `prekey_id` are JSON numbers and everything else is a JSON string. Sorting compares strings by UTF-16 code units, which for these ASCII ids is plain byte order. Strings are escaped as `JSON.stringify` does, which leaves non-ASCII characters unescaped. The ids and base64url values in an envelope are all ASCII.

### Receiving

1. Refuse an envelope whose `v` isn't 1 or whose `alg` differs.
2. When `mid` is set, it must equal the message id, and the binding is `m:<message_id>`. Otherwise the binding is `n:<nonce>` with the message's `nonce` as a string, and a message without a nonce is invalid.
3. Look up `sender_device` among the author's verified devices. A device revoked before the message's snowflake time is refused.
4. Verify `sig`.
5. Find your entry in `keys` and HPKE open it with the private prekey whose id is `prekey_id`. Failing that, open your `backup` entry with your backup key, or a stored backup key as described below.
6. Decrypt `ct` and parse the payload.

The server writes `🔒 Encrypted message` into `content`, sets the `SUPPRESS_EMBEDS` flag and keeps the envelope in the message's `encrypted` field in REST responses and gateway events.

### Payload

```json
{
    "content": "hello <@123>",
    "attachments": [
        {
            "name": "k3j5h2g7f9d1.bin",
            "filename": "holiday.jpg",
            "content_type": "image/jpeg",
            "size": 482113,
            "key": "<32 bytes>",
            "iv": "<12 bytes>",
            "width": 1920,
            "height": 1080,
            "spoiler": false
        }
    ],
    "stickers": [{ "id": "749054660769218631", "name": "Wave", "format_type": 3 }]
}
```

`content` is required, the rest is optional. An attachment may also carry `duration_secs`, `waveform` and `description`. Ignore unknown fields, and drop an attachment that lacks `name`, `filename`, `key`, `iv` or `size`. Payloads from the instance's official account may carry `embeds` with safety notice cards, and clients only draw them for that account.

### Errors

The message endpoints refuse an envelope with these codes. On 90001 a client reloads the members and keys and retries, the web client up to 2 times.

| Code | Status | Meaning |
| --- | --- | --- |
| 90001 | 409 | The envelope skipped an active device of a member, named a device or prekey that isn't current, or named a backup user or mention who isn't a member. |
| 90002 | 400 | Plaintext was sent into an encrypted conversation. |
| 90003 | 400 | The envelope is malformed, too large or has the wrong version, or `mid` was used outside an edit. |
| 90004 | 400 | Polls, forwards, components, text-to-speech and plaintext `sticker_ids` aren't supported. Stickers go in the payload. |
| 90006 | 403 | `sender_device` isn't an active device of the author. |
| 90007 | 400 | A member has no active device. |
| 90016 | 400 | An attachment isn't opaque, as described below. |

## Attachments

1. Draw a random 32-byte key and a 12-byte base nonce per file.
2. Split the file into 65536-byte chunks. An empty file is one empty chunk.
3. Encrypt chunk `i`, counting from 0, with AES-256-GCM. Its nonce is the base nonce with its last 4 bytes, read as a big-endian unsigned integer, XORed with `i`. Its AAD is `fosscord-e2ee/v1/file\n<i>\n<1 if it is the last chunk, else 0>`.
4. Concatenate the chunks, each followed by its tag. The encrypted size is `size + 16 * max(1, ceil(size / 65536))`.
5. Upload it as `application/octet-stream` under a random name matching `^[a-z0-9]{8,64}\.bin$`, with no width, height, description, waveform, title, duration or clip fields.
6. Put `name` (the uploaded name), the real `filename`, `key`, `iv` and the metadata in the payload.

A receiver matches each payload entry to the message attachment whose `filename` equals `name`, downloads it and decrypts it chunk by chunk. The final-chunk flag stops truncation, and the chunk index stops reordering.

## Devices

`GET /api/v9/users/@me/e2ee?device_id=<id>` returns the caller's identity, devices, backup key and the ids of their encrypted channels.

A new install generates its device key and first prekey with id 1 and registers with `POST /api/v9/users/@me/e2ee/devices`:

```json
{
    "device_id": "<id>",
    "signing_key": "<base64url>",
    "identity_signature": "<device statement signature, when this install holds the identity key>",
    "name": "Firefox on macOS",
    "prekey": { "id": 1, "public_key": "<base64url>", "signature": "<prekey statement signature>" }
}
```

A device registered without `identity_signature` is `pending`. Other clients won't encrypt to it until the identity key signs it, either because this install opened the backup or because another device approved it, after which it registers again with the signature and becomes `active`. Each device belongs to the login session that registered it, and ending that session revokes the device.

Rotate the prekey with `PUT /api/v9/users/@me/e2ee/devices/<device_id>/prekey` and `{ "id": <previous id + 1>, "public_key", "signature" }`. `DELETE /api/v9/users/@me/e2ee/devices/<device_id>` revokes a device and logs its session out.

The first install of a user creates the identity with `PUT /api/v9/users/@me/e2ee/identity` and `{ "public_key" }`. Rotating it sends the new `public_key`, `previous_signature` with the rotation statement, and `devices` with a fresh `identity_signature` for every device that should stay active.

## Key backup

`GET /api/v9/users/@me/e2ee/backup` returns:

```json
{
    "version": 4,
    "mode": "password",
    "kdf": { "name": "argon2id", "memory": 65536, "iterations": 3, "parallelism": 1 },
    "salt": "<16 bytes>",
    "wrapped_secret": "<box>",
    "identity_key": "<base64url>",
    "wrapped_identity": "<box>",
    "backup_public_key": "<base64url>",
    "backup_key_signature": "<backup key statement signature>",
    "wrapped_backup_key": "<box>",
    "trust": { "version": 2, "data": "<box or null>" }
}
```

To open it:

1. Derive the wrapping key. In `password` mode that is Argon2id over the UTF-8 password with the salt and the parameters in `kdf`. In `recovery` mode, `kdf.name` is `hkdf-sha256` and the key is HKDF-SHA256 with the normalised recovery code as input, the salt as salt and info `fosscord-e2ee/v1/recovery-code`.
2. Open `wrapped_secret` with AAD `fosscord-e2ee/v1/backup-secret\n<user_id>` to get the 32-byte backup secret.
3. For each label `identity`, `backup-key` and `trust`, the label key is HKDF-SHA256 with the secret as input, 32 zero bytes as salt and info `fosscord-e2ee/v1/backup/<label>`.
4. Open `wrapped_identity` with the `identity` key and AAD `identity\n<user_id>`, and `wrapped_backup_key` with the `backup-key` key and AAD `backup-key\n<user_id>`. Each holds a JWK `{ "kty": "OKP", "crv": "Ed25519" or "X25519", "x", "d" }`.
5. Check that `identity_key` is the user's current identity key and that the backup key statement verifies.

A recovery code is 32 characters from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, shown in groups of 4 joined by `-`. To normalise one, uppercase it, drop everything outside `0-9A-Z`, then map `O` to `0` and both `I` and `L` to `1`.

`PUT /api/v9/users/@me/e2ee/backup` creates the backup, and `PATCH` with the current `version` and new `mode`, `kdf`, `salt` and `wrapped_secret` changes how the secret is wrapped. A stale `version` gets 409 with code 90012.

`trust.data` is a box under the `trust` key with AAD `trust\n<user_id>`. It holds `{ "<user_id>": { "key": "<identity key>", "verified": true, "at": <ms timestamp> } }`, which syncs verified contacts between the user's devices. Save it with `PUT /api/v9/users/@me/e2ee/backup/trust` and `{ "version", "data" }`, and retry on 409.

### Stored message keys

A device that decrypted a message through its prekey, when the envelope had no backup entry for its user, stores the content key so that the user's other devices can read the message later. It HPKE seals the content key to its own backup key with info `fosscord-e2ee/v1/backup-wrap` and AAD `fosscord-e2ee/v1/backup-key\n<user_id>\n<message_id>\n<sig>`, and uploads `{ "keys": [{ "message_id", "enc", "wrapped" }] }` to `POST /api/v9/users/@me/e2ee/backup/keys`, at most 100 at a time. `POST /api/v9/users/@me/e2ee/backup/keys/query` with `{ "message_ids": [...] }` fetches them.

### Server recovery copy

When the instance trusts the server, which is the default, an unlocked device uploads the backup secret with `PUT /api/v9/users/@me/e2ee/backup/escrow` and `{ "identity_key", "backup_version", "device_id", "backup_secret", "signature" }`, signed with the server recovery statement. `GET` on the same path says whether the stored copy matches the current backup, and `POST /api/v9/users/@me/e2ee/backup/escrow/recover` with `{ "password" }` returns `{ "backup_secret" }`. Clients in strict mode never upload or fetch it.

## Approving a new device

A locked device can get the backup secret from one of the user's unlocked devices. Messages go through `POST /api/v9/users/@me/e2ee/link` with `request_id`, `stage`, the sender's `device_id` and the fields below, and reach the user's devices as the gateway events `E2EE_LINK_REQUEST` and `E2EE_LINK_RESPONSE`.

1. **request**: the new device generates an ephemeral X25519 key pair and a random 16-byte `request_id`, and posts `name` and `commit`, the base64url SHA-256 of its raw public key. It does not reveal the key yet, so the server can't choose keys that make the codes match.
2. **offer**: each unlocked device generates its own ephemeral X25519 key pair and posts its `public_key` with `to_device` set to the requester. The requester takes at most 4 offers.
3. **reveal**: about 1.2 seconds after the first offer, the requester posts its `public_key` to each approver. The approver checks it against `commit`.
4. Both sides show a six-digit code. It is the first 4 bytes of SHA-256 over `fosscord-e2ee/v1/sas\n<request_id>\n<requester_public_key>\n<approver_public_key>`, read as a big-endian unsigned integer, modulo 1000000, padded to 6 digits and shown as `123 456`.
5. **approve**: the approver derives the channel key with HKDF-SHA256 over the X25519 shared secret, with the UTF-8 `request_id` as salt and info `fosscord-e2ee/v1/link`. It encrypts the backup secret with AES-256-GCM, a random 12-byte nonce and AAD `fosscord-e2ee/v1/link\n<request_id>\n<requester_public_key>\n<approver_public_key>`, and posts `iv` and `ct`. **deny** revokes the requesting device and ends its session. **cancel** withdraws the request.
6. The requester decrypts the secret, opens the backup, signs its own device with the identity key and registers again.

In default mode an approver may approve without asking when the requesting device belongs to a live session of the same account. In strict mode the user compares the codes and chooses.

## Safety numbers

For each of the two users, compute 30 digits:

1. `digest = SHA-512(0x00 0x00 || identity_key || utf8(user_id))`, with the raw 32-byte key.
2. Repeat 5200 times: `digest = SHA-512(digest || identity_key)`.
3. For each of the first six 5-byte groups of the digest, read the 5 bytes as a big-endian integer, take it modulo 100000 and pad to 5 digits.

The safety number is the two 30-digit strings joined with the smaller one first, 60 digits in all. Clients show it in 12 groups of 5.

## Resetting

`POST /api/v9/users/@me/e2ee/reset` with the account `password` and a new identity `public_key` revokes every device and deletes the backup, the stored message keys and the recovery copy. Messages from before the reset can only be read by devices that still hold their keys. A client tells them apart from other failures by comparing the message's snowflake time with `identity_created_at`.
