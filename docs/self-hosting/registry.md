# Federation registry

The registry publishes one signed JSON document that tells Meowcord instances which instances are approved, what is blocked everywhere and which servers are in global discovery. Instance admins should read [verification.md](verification.md), and [federation-protocol.md](../development/federation-protocol.md) specifies the document and the announce request.

The registry runs at `https://meowcord-registry.tiag.workers.dev`, the default `federation.registry.url`, as a Cloudflare Worker with a D1 database in `extra/registry`. Instances refuse any document that doesn't verify against `federation.registry.publicKey`, by default `f0jm9Szfa52pkT0nWkeZK4D1wa3NUZ9hceWaFQLZYrk` with key id `registry-1`.

## What the Worker does on its own

The Worker serves the document at `GET /v1/registry` and signs a new one when its contents change and at least once a day, valid for 7 days. An announce to `POST /v1/announce` stores the instance as pending, or updates it, with its admin contacts, counts and discovery list. Contacts and counts are never published. The registry only fetches public HTTPS hosts, without redirects, for at most 8 seconds, 64 KiB of a well-known document and 1 MiB of a discovery list.

Every hour at minute 17 the Worker:

- imports `instances.json` from `main` on GitHub. Every instance in it is approved unless an admin blocked or suspended it.
- processes up to 5 [moves](#moves).
- refreshes the well-known document and discovery list of the `REFRESH_BATCH` instances checked longest ago.
- deletes expired nonces, rate limit counters and sign-in state, activity older than 30 days, snapshots and counts older than 120 days, and pending instances that aren't in `instances.json` and haven't announced for 30 days.
- writes the hour's chart row and signs a new document if needed.

## Admin pages

The pages at `/admin` need an hrtID account in the `admins` group, and sign-in allows 20 attempts per client every 10 minutes.

| Page      | What it has |
| --------- | ----------- |
| Overview  | Stats and charts, announce health, which is late after 26 hours and silent after 72, the review queue, errors in the last day, the published document with a button to sign a new one, and the admin group chat. |
| Instances | Approve, suspend or block with a reason, move back to pending, check now, accept a new key. Each entry shows its admin contacts and latest counts. |
| Discovery | Remove a server, list it again or block it. |
| Blocks    | Block or unblock an instance id, or a server or user by canonical id such as `@123@meow.example.com`. |
| Moves     | Every move with its state, proof and keys, and Approve for moves that wait for an admin. |
| Activity  | Announces, checks, imports, errors and admin actions. |

`bun scripts/preview-admin.mjs` in `extra/registry` serves the pages on `http://127.0.0.1:8790/admin`, or on `PORT`, with 90 days of sample data in an in-memory database and no hrtID.

## How to review

Approve an instance when it meets the checklist in [verification.md](verification.md). Servers aren't reviewed one by one. A server an approved instance lists goes into the next document and stays through renames. Removing a server keeps it out until you list it again, and blocking it also stops joins and federation for it.

When an approved instance serves a different key, the registry keeps publishing the old one, marks the instance "new key waiting" and ignores its discovery list. Press Accept the new key only after the instance's admins confirm they changed it, so that someone who takes over a domain can't speak for the instance.

## Admin group chat

The Admin group chat card on the Overview opens a group DM named "Meowcord Admins" between a Meowcord Admins account and the announced contacts of every approved, unblocked instance. Open admin group chat creates the group or adds missing contacts, and lists handles that don't resolve under Not added. Close admin group chat removes everyone and deletes the group. An admin without an active encryption device stays under Not added until they set one up and someone opens the chat again.

To connect the account, sign in on the card with its instance, username or email, password and any TOTP or backup code. Security keys and captchas can't finish this sign-in, so leave `login.requireCaptcha` off on that instance. Each admin gets 10 attempts per 15 minutes. The Worker stores only the token, encrypted with a key derived from `REGISTRY_SIGNING_KEY`. Without a connected account it falls back to the `ADMIN_CHAT_ORIGIN` and `ADMIN_CHAT_TOKEN` secrets, and without those the buttons are disabled.

Group DMs hold 25 people by default, fewer than three instances' contacts. Give the account the BYPASS_RATE_LIMITS right under Users in its instance's admin dashboard, which raises its limit to `limits.channel.maxStaffGroupDmRecipients`, 100 by default, and skips the contact spam checks. Don't give it OPERATOR, because the Worker holds its token.

## Moves

Moves come from `previous_ids` in `instances.json`, see [change-url.md](change-url.md). On each hourly import the registry takes up to 5 unapplied moves and:

1. Refuses the move while the old id still has its own entry, when it has no record of the old id, when the old id already moved elsewhere and when the new id itself moved.
2. Looks for a move statement in the new id's `moved_from` that verifies against the old id's key. An announce from the new id signed with the old key also counts when the key didn't change.
3. Applies the move when it found proof and the key is the same. Otherwise the move waits on the Moves page, and you approve it only after the instance's admins confirm they run both addresses.

Applying a move gives the new id the stricter status of the two, copies every block of the old id to it, moves the discovery servers with their removals, the admin contacts and the counts, and marks the old id `moved`. A move never clears a block or a suspension. Moves that leave `instances.json` before they are applied are forgotten.

## Running it

```sh
cd extra/registry
bun install
bun run test
bun run migrate:remote
bun run deploy
bun scripts/verify-registry.mjs
```

The tests run `wrangler dev` with a throwaway key and database and need no Cloudflare account. The last command checks the live document's signature.

| Setting | Kind | What it is |
| --- | --- | --- |
| `REGISTRY_SIGNING_KEY` | secret | The Ed25519 private key as a 32 byte base64url seed, in Proton Pass at `projects/meowcord/registry_signing_key`. |
| `OIDC_CLIENT_SECRET` | secret | The hrtID client secret. |
| `ADMIN_CHAT_ORIGIN`, `ADMIN_CHAT_TOKEN` | secret | Optional. The https address of the instance that holds the Meowcord Admins account, and that account's token. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `ADMIN_GROUP` | var | hrtID sign-in. Only members of `ADMIN_GROUP`, `admins`, can use the pages. |
| `INSTANCES_JSON_URL` | var | Where the hourly job reads `instances.json`. |
| `REFRESH_BATCH` | var | How many instances the hourly job refreshes, 8 by default. |
| `ALLOW_PRIVATE_HOSTS` | var | `1` lets the registry fetch `localhost` and private addresses over HTTP, for tests only. |

Set secrets with `bunx wrangler secret put <name>`. To rotate the signing key, ship a server release with the new public key before giving the Worker the new secret, because instances only trust the key in their config.
