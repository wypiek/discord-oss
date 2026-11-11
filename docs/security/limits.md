# Upload and fetch limits

This page lists the limits the server puts on uploads, on URLs it fetches for users and on images it decodes, with the config keys and environment variables that change them and what a user sees when one is hit. Config keys go in `config.json` or the admin dashboard and environment variables in `.env`, see [setup.md](../self-hosting/setup.md).

## Attachments

| Key                                  | Default | Effect                                                                                                                       |
| ------------------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `cdn.maxAttachmentSize`              | 500 MiB | Largest file the client can upload. A larger file is refused with "Request entity too large" before the upload starts.        |
| `limits.message.maxAttachments`      | 15      | Files per message, and per upload request up to a hard cap of 100.                                                           |
| `limits.message.maxAttachmentSize`   | 1 GiB   | Largest file in a multipart message request, the path bots use.                                                              |

The client uploads files to upload slots first and then sends the message. Each user may hold at most:

| Uploads                                              | Count | Bytes                                       |
| ---------------------------------------------------- | ----- | ------------------------------------------- |
| Unfinished uploads                                   | 32    | The larger of `cdn.maxAttachmentSize` and 1 GiB |
| All uploads made in the last 24 hours, finished or not | 512   | The larger of `cdn.maxAttachmentSize` and 2 GiB |

Past either limit the server answers 429 with "Too many pending uploads. Finish or cancel an upload first." Finishing an upload frees its unfinished slot but not its place in the second row. The server deletes every upload slot and its file 24 hours after the slot was created, whether or not a message used it, so a user over the second limit gets their place back a day later. Sending a message copies the file into the message, so the message keeps its attachment. Uploads that a scheduled message still has to send are kept until it is sent or fails.

Creating an upload slot needs View Channel and Attach Files in the channel. Only the user who uploaded a file can attach it to a message, only in the channel where they uploaded it, and only while they still have both permissions.

## Images, stickers and sounds

| Upload                                                                 | Largest file                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Avatars, banners, icons, splashes, emojis, role icons and other images | About 7.5 MiB, the base64 data URI that fits in the 10 MiB JSON body   |
| Guild stickers                                                         | 512 KiB, as on Discord                                                 |
| Soundboard sounds                                                      | 512 KB                                                                 |
| Data packages                                                          | No fixed limit. Each account keeps one, and a new one replaces it      |

A sticker over 512 KiB is refused with 413 while it is being read, so the server never holds more than that in memory for one sticker. There is no config key for the size of these images. The JSON body limit is the only cap on them, and every image counts toward the storage quota of the account that uploaded it.

## Upload memory on the CDN

Each CDN process buffers uploads in memory and admits them against a byte budget and a concurrency cap:

| Variable                         | Default         | Accepted values             |
| -------------------------------- | --------------- | --------------------------- |
| `CDN_UPLOAD_BUFFER_BUDGET_BYTES` | 1073741824, 1 GiB | A positive integer in bytes |
| `CDN_UPLOAD_MAX_CONCURRENT`      | 16              | 1 to 64                     |

A client upload reserves twice its file size plus 64 KiB, so the default budget fits one 500 MiB file at a time. To raise `cdn.maxAttachmentSize`, raise the budget to at least twice the new size plus 64 KiB. Uploads from the API to the CDN reserve up to 100 MiB plus 64 MiB each.

An upload that can never fit the budget gets 413. When the budget or the concurrency cap is in use, the CDN answers 503 with `Retry-After: 1`. An invalid value in either variable makes every upload fail with 503 until it is fixed. The budget covers upload buffers only, not the whole process, and each CDN process has its own pool, so size it for the memory each process has left.

## Video previews and uploads from the API

The server renders video preview frames with ffmpeg for attachments and the `/external` media proxy, at most 4 at a time per process. A request takes one of the 4 slots before it reads or downloads the video, so a busy server answers 503 with `Retry-After: 1` instead of downloading up to 50 MiB first. Each frame has 15 seconds and a 64 MiB input limit.

The API holds files that bots, webhooks and interaction responses send in memory until it passes them to the CDN, at most 100 MiB per request across all files, since the CDN refuses a single file over 100 MiB from the API anyway. Webhooks and interaction responses also allow at most 10 files of 25 MiB each, and the interaction callback checks its token before it reads any file. When a bot or the API sends files with a message, the API uploads them to the CDN one after another. Each file has 30 seconds, and all the files of one message share a deadline of `cdn.uploadDeadlineSeconds`, 60 by default, so a slow CDN can't hold a request open for 30 seconds per file.

## Storage quotas

`cdn.storageQuota` caps total storage on local disk or S3, with these defaults:

| Key                | Default |
| ------------------ | ------- |
| `instanceBytes`    | 100 GiB |
| `instanceObjects`  | 100,000 |
| `principalBytes`   | 10 GiB per account |
| `principalObjects` | 10,000 per account |
| `cacheBytes`       | 1 GiB   |
| `cacheObjects`     | 10,000  |

Uploads by webhooks, applications and bot accounts count toward the account that owns them, so creating more bots doesn't give anyone more storage. A write past an instance or account limit fails with 413 "Storage quota exceeded". The cache holds Discord assets the CDN fetches on demand and evicts the least recently used ones instead of failing. [setup.md](../self-hosting/setup.md) covers sizing.

The CDN checks and reserves the limits for a write while it holds a lock for the whole storage location, so writes from several CDN processes can't race past a limit together. An upload that fails or is abandoned before the file is written reserves nothing. When a write to local disk or S3 fails, the CDN reads the path back at once, records the size of whatever file is there and gives the rest of the reservation back. On S3 a write that the CDN gave up on can still finish in the bucket after that check, and the CDN counts that file only from the next write or delete of the same path or the next restart. When the bucket can't be read after a failed write, the reservation stays until the CDN restarts and compares the bucket with its records, and until then writes to the same path answer 503.

The defaults let one account fill a tenth of the instance, so 10 accounts at their limit stop every upload on the instance. Raise `instanceBytes` and `instanceObjects` to what the disk or bucket can hold. Images that a guild or an admin uploads count toward the account that uploaded them, and there is no limit per guild. Background jobs such as announcements write to a shared `system:managed` account with the same per-account limits. When an avatar, banner, icon, splash or event image is replaced or removed, or the user, guild, channel, role, member, webhook, application or event that held it is deleted, the API deletes the old file and gives its space back about a minute later. It keeps a file while anything still shows it: the user's last 10 avatars, which they can switch back to, a report that shows the reported user's avatar, and webhook messages that show the avatar they were sent with. A webhook avatar that a message set through `avatar_url` is deleted with the last message that shows it. Files replaced before this cleanup existed stay in storage.

## Fetching URLs that users pick

The server fetches link previews, webhook avatars, the `/external` media proxy, Web Push endpoints and similar URLs that users and bots choose. Every one of these fetches goes through `PUBLIC_FETCH_PROXY`, which [external-services.md](../self-hosting/external-services.md) describes. Link previews, webhook avatars and Web Push also need `externalRequests.thirdParty`, which is off by default.

The server resolves each hostname itself, refuses it when any address is private or reserved, and connects only to the address it checked. It checks every redirect the same way, follows at most 3 by default, and drops cookies and authorization headers when a redirect changes origin. It refuses URLs with credentials, schemes other than HTTP and HTTPS, and compressed responses, so a site has to send its bytes without a content encoding. `security.allowPrivateNetworkRequests`, off by default, lifts the private address check and nothing else.

| Fetch                          | Bytes                                                       | Time       |
| ------------------------------ | ----------------------------------------------------------- | ---------- |
| Link previews and their media  | `limits.message.maxEmbedDownloadSize`, default 5 MiB, at most 32 MiB | 15 seconds |
| `/external` media proxy        | 50 MiB                                                      | 15 seconds |
| Image proxy                    | 10 MiB                                                      | 5 seconds  |
| Other callers                  | 5 MiB                                                       | 15 seconds |

A fetch that breaks a limit fails, and the message simply has no embed for that link.

## Images the server decodes

The server decodes images itself for instance branding, email images and the colors of burst reactions. These limits are fixed:

| Use                         | Bytes | Time        | Image size                                   |
| --------------------------- | ----- | ----------- | -------------------------------------------- |
| Branding and email images   | 8 MiB | 5 seconds   | 8,192 pixels per side, 16,777,216 pixels, 256 GIF frames |
| Burst reaction colors       | 1 MiB | 1.5 seconds | 1,024 pixels per side, 1,048,576 pixels      |

A branding image over a limit falls back to the default artwork, and an email image is served unconverted. A burst reaction over a limit, or arriving while 32 color jobs are already running, gets fallback colors. BigTIFF files are refused.

Branding versions include the file's modification time and size, so replacing `client.icon` or `client.logo` at the same path refreshes the rendered images.

## Gateway buffers

Each gateway connection keeps its last 250 events, up to 8 MiB, so a client that reconnects can resume without missing any. A connection that drops is held for 90 seconds and queues up to 5,000 events or 16 MiB for the resume. Two config keys cap what all of these buffers hold together:

| Key                                         | Default | What it caps                                     |
| ------------------------------------------- | ------- | ------------------------------------------------ |
| `limits.gateway.retainedDispatchBytes`      | 1 GiB   | Kept and queued events across the whole process  |
| `limits.gateway.retainedDispatchBytesPerUser` | 64 MiB  | Kept and queued events across one account's connections |

When a budget is full, a live connection drops its oldest kept events, and a dropped connection that is waiting for a resume is released. A client that then tries to resume from before an event that was dropped gets an invalid session and identifies again, so it never resumes with a gap. Bytes are measured as the JSON size of each event.

A new connection has 30 seconds to identify or resume. `limits.gateway.pendingConnectionsPerIp`, 50 by default, caps how many connections from one address can wait at the same time, and the next one is closed with code 4008. Set it to 0 to turn the cap off. Behind a reverse proxy, set `security.forwardedFor` so the gateway sees each client's own address, or every client shares the proxy's.

