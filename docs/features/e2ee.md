# End-to-end encrypted messages

Every DM and group DM encrypts new messages and attachments, and nobody can turn it off. That includes messages from bots, applications and webhooks in private channels. Guild channels are not encrypted. Messages sent before a conversation was encrypted stay in plaintext.

Users set nothing up. Signing up or logging in creates or unlocks the key backup.

## Security model

By default `limits.e2ee.trustServerByDefault` is `true` and the server is trusted. Encryption then protects messages from a stolen database or a passive observer, but the operator can read message content in these cases:

- The server keeps a recovery copy of every user's backup secret, encrypted under a recovery master key that lives outside the database. Whoever holds both the database and that key can open every backup, and with it every message key.
- The server serves the client JavaScript, so a malicious operator can ship a client that leaks keys. Every web E2EE design has this limit.
- The client trusts the server's key directory, so a compromised server could swap a contact's identity key or approve a new device of the same account unseen.

Otherwise the operator sees only metadata: who talks to whom and when, sizes, reactions, pins, typing, read state, replies, mentioned members, stickers loaded from the CDN and the links whose previews a reader asks for.

The advanced option "Review safety number changes and new browser approvals" in User Settings > Encryption turns on strict mode for that browser. Strict mode pins each contact's identity key and blocks sending when it changes until the user reviews the safety number. It asks the user to approve new browsers with a six-digit code, and it never uploads or fetches a recovery copy. Setting `trustServerByDefault` to `false` makes strict mode the default for every browser and turns the recovery endpoints off.

## Cryptography

For each message the sending browser encrypts the payload with a random 256-bit content key in AES-256-GCM. It wraps the content key to each recipient device's signed X25519 prekey with HPKE base mode and signs the envelope with its Ed25519 device key. Every envelope is version 1, and the server refuses any other version. Keys are non-extractable WebCrypto keys in IndexedDB.

| Key | Type | Scope |
| --- | --- | --- |
| Identity key | Ed25519 | One per user. It signs the user's devices, and safety numbers are computed over it. |
| Device key | Ed25519 | One per browser profile and origin. |
| Signed prekey | X25519 | Rotated every 7 days. A retired private prekey is deleted 30 days later. |

There is no per-message forward secrecy beyond prekey rotation.

The additional authenticated data binds the channel, the sender, the sender device and the nonce, so a ciphertext can't be moved to another channel or replayed. The server writes `🔒 Encrypted message` into `content`, so mentions, search and push notifications never see plaintext. Safety numbers are 60 digits in Signal's format, compared by voice or in person. A contact marked as verified stays verified in the user's other browsers.

## Devices

Each browser profile is a device. Other browsers only encrypt to a new device once the user's identity key, from the backup or another browser, signs it.

Each device belongs to the session that registered it, and logging that session out in any way revokes the device. A browser that finds its own device revoked deletes its keys, and User Settings > Log Out deletes them right away. The server revokes a pending device when its session ends or after `limits.e2ee.pendingDeviceTtlHours`. User Settings > Encryption lists the devices, and removing one revokes it and logs its session out.

## Key backup and recovery

The backup lets a new browser sign itself and read older messages. It holds the user's identity private key and a backup private key, sealed under a random 32-byte backup secret, and the server stores one per user. Every envelope also seals its content key to each member's backup public key, so a browser that opens the backup can read the whole history.

### Password

By default the browser seals the backup secret under a key derived from the account password with Argon2id, using 64 MiB, 3 iterations and parallelism 1. A new browser unlocks the backup at login without a prompt, and a password change reseals the secret. Anyone with a copy of the database can guess passwords offline at one Argon2id run per guess, so a weak password makes a weak backup.

### Recovery code

User Settings > Encryption can switch the backup to a recovery code of 32 Crockford base32 characters, about 160 bits, shown once. After the user confirms with "I saved it", the password no longer opens the backup. A user who loses the code and every signed-in browser, with no server recovery copy, loses the history.

### Server recovery copy

In default mode an unlocked browser publishes its backup secret to the server, signed by the identity key. The server stores it encrypted under the recovery master key. A new browser can get the secret back with the current account password, even when the backup uses a recovery code. A copy only exists after a browser published it, and resetting encryption or deleting the account removes it.

The server reads the 32-byte recovery master key from the first of these that is set:

| Source | Notes |
| --- | --- |
| `E2EE_RECOVERY_MASTER_KEY` | 64 hex characters or 32 bytes in base64url. |
| `E2EE_RECOVERY_KEY_FILE` | Path to a file holding the key in either format. |
| `.e2ee-recovery.key` next to `CONFIG_PATH` | The default. Docker keeps it in the `state` volume. |

The server creates the default file with mode 600 the first time it needs the key, but only while no recovery copies exist, because a new key couldn't open them. The file must be a regular file of at most 128 bytes with no group or other permissions, and not a symlink. When the key is missing or invalid, the recovery endpoints answer `503` and store nothing. Back the key up separately from the database, as [setup.md](../self-hosting/setup.md#data-and-backups) describes.

### Approval from another browser

A locked browser can ask the user's other signed-in browsers for the backup secret. The new browser commits to its X25519 key first, so the server can't pick keys that make the codes match. In default mode an unlocked browser approves automatically when the requesting device belongs to a live session of the same account. In strict mode every unlocked browser shows the new login with its location and a six-digit code, and the user picks Approve or Deny. Deny revokes the device and signs its session out.

### Resetting encryption

When nothing can unlock the backup, "Reset encryption" in the unlock dialog or in User Settings > Encryption starts over after asking for the account password. The server revokes every device and deletes the backup, the stored message keys and the recovery copy. The user's own browsers then show old messages as "Sent before encryption was reset". Contacts keep reading what they already received, and contacts in strict mode see a safety number change.

## What users see

When a send can't be encrypted, the draft stays in the composer with an error, and nothing is sent in plaintext. When the check before sending passes but encrypting or the server's checks fail later, the message shows as failed with a notice that says why, and the messages after it still go out.

The server rejects an envelope that skips a member's active device or still names someone who left with `E2EE_DEVICE_MISMATCH`. The browser then reloads the members and their keys, encrypts again and resends, up to 2 times, so a member joining or leaving while a message is on its way doesn't make it fail. Each browser also forgets its member lists when the gateway reconnects or a group is created or left.

A message that can't be decrypted because a key lookup failed, or because it came from a device of the sender that the browser doesn't know yet, is tried again after 2 seconds, then after twice as long each time, 6 times in all, and again whenever the sender's devices or identity change. A message whose signature doesn't check out is never tried again. A member who was added to a group sees "This message wasn't encrypted for you" on messages sent before they joined, because those were encrypted only for the members at the time.

A member who never signed in since encryption existed has no keys and can't read new messages. When every other member is in that state, the browser refuses the send and names them. Otherwise the message goes to the rest with a warning that names them.

These work in encrypted conversations too:

- Attachments, stickers and voice messages. The browser encrypts files in 64 KiB chunks before upload, so the server only sees an opaque `.bin` file of the same size plus 16 bytes per chunk. A service worker at `/e2ee-sw.js` decrypts them for display.
- Waves. The client sends the wave from an empty DM to `POST /channels/:id/greet`, and in an encrypted DM the browser sends it to `/channels/:id/messages` instead, with the sticker inside the envelope.
- Mentions. The sending browser lists up to 100 mentioned members in the envelope in plaintext, so badges and push notifications work.
- Search. The browser decrypts the channel's last 1000 messages and searches them, and the query never reaches the server.
- Link previews. The reader's browser sends up to 5 links to `POST /e2ee/embeds` and gets their previews back. The server stores no embed on the message.

Polls, clips, forwards, components and text-to-speech are not available.

## Members who left a group

Every message is encrypted to every member at send time, so remaining members can still read messages from someone who left. To check their signatures, the server keeps answering key requests about a former member to current members of that channel only.

## Reporting encrypted messages

When a user reports a message in an encrypted conversation, their browser sends the content keys of the reported message and of the messages around it, at most 50 in all. The server checks that the sender's device belonged to the author and was active at the time, verifies the signature and decrypts the stored ciphertext. It saves up to 4000 characters of text and up to 10 file names in the report, the 15 messages before it and the 10 after it, and never stores the keys, so a reporter can't change what the message says. A browser that is still starting waits up to 15 seconds for encryption before it collects the keys.

When a user reports a person with Report User Profile, the browser picks the open DM or group DM that person is in, or else their DM with the reporter, and sends that channel with the content keys of its last 50 messages. The server only saves the conversation when the reporter is a member and the reported person is or was one, and stores its last 25 messages, verified the same way.

The admin dashboard shows a report that passes as "Verified encrypted text", and one with a missing or wrong key or a bad signature as "Encrypted, not verified" with the reason. Each message around it shows its verified text, or "Encrypted, not shared" when the reporter's browser couldn't read it. A user report shows the conversation as "Their conversation with the reporter". Instance automod only acts on a verified report, as [automod.md](automod.md#encrypted-messages) describes.

## Limits

Operators set these under `limits.e2ee` in the config, or on the Encrypted DMs card of the admin dashboard's Site settings page, which has no switch for `trustServerByDefault`. New values apply without a restart.

| Key | Default | Meaning |
| --- | --- | --- |
| `trustServerByDefault` | `true` | `false` makes strict mode the default and turns off recovery copies. |
| `maxEnvelopeBytes` | `65536` | Largest encrypted envelope in bytes. |
| `maxEnvelopeDevices` | `256` | Recipient devices one message can be encrypted for. |
| `pendingDeviceTtlHours` | `168` | Hours before an unapproved device is revoked. |
| `deviceRegistrationsPerHour` | `30` | New devices per account per hour. |
| `deviceUpdatesPerHour` | `60` | Device re-signs per account per hour. |
| `keyQueriesPerMinute` | `60` | Key directory lookups per account per minute. |

## Error codes

The message endpoints answer these codes. The device, identity and backup endpoints use 90005 to 90015, listed in `src/api/util/utility/e2ee.ts`.

| Code | Name | Meaning |
| --- | --- | --- |
| 90001 | `E2EE_DEVICE_MISMATCH` | The envelope skipped an active device of a member, or named a device, backup key or mention of someone who isn't a member. The client reloads the members and keys and retries up to 2 times. |
| 90002 | `E2EE_REQUIRED` | A plaintext message was sent into an encrypted conversation. |
| 90003 | `E2EE_INVALID_ENVELOPE` | The envelope is malformed or has the wrong version. |
| 90004 | `E2EE_UNSUPPORTED` | Polls, forwards, components, text-to-speech or plaintext stickers. The recovery endpoints also answer it when `trustServerByDefault` is `false`. |
| 90007 | `E2EE_RECIPIENT_NO_DEVICES` | A member has no active device. The response lists their `user_ids`. |
| 90016 | `E2EE_PLAINTEXT_ATTACHMENT` | An attachment wasn't an opaque `.bin` file or carried plaintext metadata, such as a clip's fields. |

## Discord's Android app

The mobile bundle handles encrypted text but not attachments, approvals or safety numbers, as [android-client.md](../development/android-client.md#encrypted-dms) describes.

## For contributors

`bun run build:e2ee` bundles the engine in `client/e2ee`, `assets/client_patches/10-e2ee-loader.js` loads it, and the `FosscordE2ee` plugin adds the UI. The loader finds Discord's modules by shape. When it can't find a hook, the client shows "Encryption is unavailable in this client build" and refuses to send in encrypted channels. `bun run generate:client` checks the hooks against every new client build. [client-patches.md](../development/client-patches.md) has the rules for changing it.

Run the browser tests from a terminal or through `scripts/dev/outside-app.sh`:

```sh
PORT=<port> E2EE_TEST_DATABASE_NAME=<db> bun scripts/dev/e2ee-test.mjs
```

`E2EE_ONLY` runs only the phases whose names contain one of its comma-separated parts, such as `E2EE_ONLY="change during a send,report from the message menu"`. Those two phases create their own accounts, so they run on their own. `e2ee-test.mjs` refuses to run unless the database in `.env` is named `E2EE_TEST_DATABASE_NAME`, `fosscord_codex_admin` by default. The unit tests in `scripts/tests/e2ee-*.test.cjs` and `encrypted-report.test.cjs` run with `bun run test`.
