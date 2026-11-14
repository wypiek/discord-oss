# IP hashing

The database never holds a readable IP address. Every address the server stores is replaced with a keyed hash, so a leaked database dump or a staff member with database access can't recover where people connected from. Moderation keeps working on the hashes: account caps per address, address bans, raid bans and the "accounts on this address" lists all compare hashes.

## What is stored

| Column | Holds |
| --- | --- |
| `users.registration_ip` | Hash of the address the account registered from. |
| `users.registration_ip_group` | Hash of that address's group, for the accounts per address cap. |
| `sessions.last_seen_ip` | Hash of the address the session was last used from. |
| `sessions.last_seen_ip_group` | Hash of that address's group. |
| `bans.ip` | Hash of the address a server-banned member last used. Nothing reads it. |
| `instance_bans.ip_address` | Hash of a banned address. |
| `instance_bans.reason` | A spread ban names its source ban and the source address's fingerprint, never the address. |
| `automod_actions.term` | An accounts per address refusal names the network's fingerprint, never the address. |
| `audit_logs.changes` | A staff action whose request carried an address, such as an IP ban, records `address <fingerprint>`. |
| `rate_limits.id`, `rate_limits.executor_id` | Signed-out rate limits, per-address sign-in lockouts, the daily signups per address count, Cap request limits and help article votes are keyed by the hash. |

## How the hash is made

1. The address is normalized: surrounding spaces are removed, an IPv4-mapped IPv6 address such as `::ffff:203.0.113.7` becomes `203.0.113.7`, and IPv6 is lowercased. A value that isn't an address is not stored.
2. The server computes HMAC-SHA256 of the normalized address with the instance's secret, encodes it as base64url and prefixes `iph1_`. Every hash is 48 characters, for example `iph1_XNlWBfNgS4iIPzowE5uuv3f-Tz1JX2M-F5oARhsJZrI`.
3. The group hash is the same HMAC over the address's group. An IPv4 address is its own group, so both hashes are equal. An IPv6 address is grouped by its /64, written as `2001:db8:1:2::/64`, because one home or phone usually gets a whole /64.

The same address always gives the same hash on one instance, which is what lets bans and caps match. Without the secret, a hash can't be turned back into an address or compared with a guess.

## Fingerprints

A fingerprint is the first 10 characters after `iph1_`. The admin dashboard, spread ban reasons, automod log entries, the staff audit log and server logs show fingerprints instead of addresses. The same fingerprint means the same address. Server logs that used to print an address, such as gateway connections, registration refusals and `LOG_REQUESTS` request lines, print its fingerprint.

## The secret

The server reads the secret, in this order, from:

1. `IP_HASH_SECRET`, at least 32 characters. A shorter value stops the server at startup instead of weakening every hash.
2. The file at `IP_HASH_SECRET_FILE`.
3. `.ip-hash.key` next to `config.json`. Under Docker that is `/data/state/.ip-hash.key` in the `state` volume. For a native install with `CONFIG_PATH=/var/lib/meowcord/config.json` it is `/var/lib/meowcord/.ip-hash.key`.

When neither variable is set and the file doesn't exist, the server writes 32 random bytes as a 43 character base64url string to the file with mode `0600` and prints one line telling you to back it up. The line names the file and never shows the secret. The file's content works unchanged as `IP_HASH_SECRET`.

The secret is never written to the database, because the database is what it protects. `scripts/ops/backup.sh` archives the `state` volume, so a backup made with it holds the secret. Keep that archive apart from database dumps you hand to anyone else.

### Losing or changing the secret

Nothing becomes readable. Old hashes just stop matching new requests:

- IP bans stop matching. Ban the addresses again.
- The accounts per address caps count from zero, because existing accounts carry hashes from the old secret.
- The IP addresses tab shows the old and the new fingerprint of one address as two rows until old sessions end.
- Per-address sign-in lockouts and signed-out rate limits start over.

## What stays in memory only

The live request address is still used while a request runs, and is never stored:

- Rate limiting, which buckets IPv4 by address and IPv6 by /64 before hashing the bucket.
- Reputation and location lookups: AbuseIPDB, StopForumSpam and ipdata at registration, the voice region choice and the location shown on the Devices page.
- Trusted proxy and Cloudflare handling, which picks the client address from headers.
- Range checks against `automod.ipAllowList` and `security.trustedProxies`, and the shared address check that keeps private, loopback and Cloudflare addresses from ever matching a ban.
- CDN URL signatures when `security.cdnSignatureIncludeIp` is on.

## What stays readable on purpose

- Ranges and addresses staff type into configuration, `automod.ipAllowList` and `security.trustedProxies`. They are instance settings, not data about people.
- `sessions.last_seen_location`, the city, region, country and postal code ipdata returned when the session signed in. The Devices page shows it as the session's location. It is empty when ipdata isn't configured.
- In-memory caches of reputation answers, which are lost on restart.

## Upgrading an instance

Migration `IpHashGroups1794163870529` adds the two group columns on PostgreSQL and SQLite. After the migrations, on every start and under the migration lock, the server finds stored values that don't start with `iph1_`, in batches of 500, and replaces them:

- Addresses in `users`, `sessions`, `bans` and `instance_bans` become hashes, and the group columns are filled. Both IPv4 spellings of one address end up as one hash. A value that isn't an address becomes empty.
- Spread ban reasons, accounts per address log entries and staff audit log changes that name an address name its fingerprint.
- `rate_limits` rows keyed by a readable address are deleted, so per-address rate limits, per-address sign-in lockouts, the daily signups per address count and help votes start over once.

The server logs one line with how many rows changed, and nothing when there was nothing to change, so running it again is safe. Existing hashes are left alone. With `APPLY_DB_MIGRATIONS=false` the step is skipped too, and runs in the process that applies migrations.

**This replaces stored IP addresses permanently. There is no way back to the addresses.** Database dumps made before the upgrade still hold them. Delete those dumps when you no longer need them.

## What admins lose and keep

Admins keep how many accounts share an address, opening an address to see and remove its accounts, banning and lifting bans, raid IP bans, the accounts per address caps and their lookup, and finding an address by typing it in full or pasting its hash.

Admins lose seeing addresses, searching by the start of an address, and looking an address up elsewhere. A raid ban can't tell a private or loopback address from a public one any more, so it bans that hash too, but such a ban never matches anyone because the live address is checked first.

## Limits

An attacker who has both the database and the secret can hash all 4.3 billion IPv4 addresses and match them in minutes. The hashing protects a database without the `state` volume and staff without shell access to the server.
