# Cloudflare Workers

Meowcord can run as Cloudflare Workers instead of the Bun server. Nobody has deployed this yet. It was tested with `wrangler dev` on one machine, and the Bun server in [setup.md](setup.md) is still the supported way to host an instance. Voice doesn't work on Workers.

| Worker             | Directory         | What it does                                                                                              |
| ------------------ | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `meowcord`         | `workers/router`  | Takes every request for the instance's domain, serves the web client and the CDN, and forwards the rest. |
| `meowcord-api`     | `workers/api`     | The REST API from `src/api`, and the background jobs on a Cron Trigger.                                   |
| `meowcord-gateway` | `workers/gateway` | The gateway from `src/gateway`, in one Durable Object.                                                     |
| `meowcord-cdn`     | `workers/cdn`     | Optional. The router's CDN code on its own, for an instance with its CDN on a separate host.              |

The router binds the API and the gateway as `API` and `GATEWAY`, and answers 503 when a binding is missing or its Worker throws. The API binds the gateway as `GATEWAY`. The API and the gateway reach PostgreSQL through a Hyperdrive binding named `HYPERDRIVE`. The router, the CDN and the API keep files in the R2 bucket `meowcord-media`, bound as `MEDIA`, and the router and the CDN resize images with the Images binding `IMAGES`. The API and the gateway have no `workers.dev` address, so the router is their only way in.

The background jobs need Workers Paid, because a Cron Trigger on Workers Free gets 10 ms of CPU time and starting the API takes longer.

## Deploy

Run these from the repository root with `bunx wrangler@4.79.0`, the version the Workers were tested with.

1. Build the server and migrate the database. The Workers never run migrations.

    ```sh
    bun install
    bun run build:src
    DATABASE=postgres://user:password@db.example:5432/meowcord bun run apply:migrations
    ```

2. Create the keys, unless you are moving an instance that already has `jwt.key`, `jwt.key.pub` and `federation.key`. Every Worker and any Bun server on the same database need the same JWT pair. The API sends `event.secret` with every event it posts to the gateway. `recovery.key` encrypts the account recovery secrets, so changing it later makes every stored one unreadable. `.gitignore` covers `jwt.key*` and `federation.key*` but not `event.secret`, `recovery.key` or `instance.json`, so don't commit those.

    ```sh
    openssl ecparam -name secp521r1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out jwt.key
    openssl ec -in jwt.key -pubout -out jwt.key.pub
    openssl genpkey -algorithm ed25519 -out federation.key
    openssl rand -hex 32 > event.secret
    openssl rand -hex 32 > recovery.key
    ```

3. Create the Hyperdrive config and the R2 bucket, and put the Hyperdrive id the first command prints in place of the zero id in `workers/api/wrangler.jsonc` and `workers/gateway/wrangler.jsonc`.

    ```sh
    bunx wrangler@4.79.0 hyperdrive create meowcord --connection-string="postgres://user:password@db.example:5432/meowcord"
    bunx wrangler@4.79.0 r2 bucket create meowcord-media
    ```

4. Write the instance configuration as one JSON file in the shape of `config.json`, here `instance.json`. Set `general.serverName`, `api.endpointPublic`, `cdn.endpointPublic` and `gateway.endpointPublic` to the instance's address. The router sends websocket upgrades on any path to the gateway, so `gateway.endpointPublic` can be the instance's own `wss://` address. Also set `security.requestSignature` and `security.cdnSignatureKey`, which the router reads from this file and which have to match the API's.

5. Deploy the gateway and give it its secrets.

    ```sh
    cd workers/gateway
    bunx wrangler@4.79.0 deploy
    bunx wrangler@4.79.0 secret put JWT_PRIVATE_KEY < ../../jwt.key
    bunx wrangler@4.79.0 secret put JWT_PUBLIC_KEY < ../../jwt.key.pub
    bunx wrangler@4.79.0 secret put CONFIG_JSON < ../../instance.json
    bunx wrangler@4.79.0 secret put EVENT_SECRET < ../../event.secret
    cd ../..
    ```

6. Deploy the API. Its build command, `bun build.ts`, bundles the compiled `dist`, so rebuild `dist` before every deploy. Leave out `FEDERATION_KEY` if federation is off.

    ```sh
    cd workers/api
    bun install
    bunx wrangler@4.79.0 deploy
    bunx wrangler@4.79.0 secret put JWT_PRIVATE_KEY < ../../jwt.key
    bunx wrangler@4.79.0 secret put JWT_PUBLIC_KEY < ../../jwt.key.pub
    bunx wrangler@4.79.0 secret put CONFIG_JSON < ../../instance.json
    bunx wrangler@4.79.0 secret put EVENT_SECRET < ../../event.secret
    bunx wrangler@4.79.0 secret put E2EE_RECOVERY_MASTER_KEY < ../../recovery.key
    bunx wrangler@4.79.0 secret put FEDERATION_KEY < ../../federation.key
    cd ../..
    ```

7. Add the instance's domain to `workers/router/wrangler.jsonc` as `"routes": [{ "pattern": "meow.example", "custom_domain": true }]`, then prepare the client and deploy the router.

    ```sh
    bun run generate:client
    bun scripts/workers/prepare-assets.mjs
    cd workers/router
    bunx wrangler@4.79.0 deploy
    bunx wrangler@4.79.0 secret put CONFIG_JSON < ../../instance.json
    ```

## Configuration

The API and the gateway keep the configuration in the database's `config` table, so the admin dashboard can change it. When the table is empty, the first isolate writes `CONFIG_JSON` merged over the defaults into it, and after that both ignore `CONFIG_JSON`. `CONFIG_OVERRIDE` is merged over the table on every load. Each isolate reloads the table once it is older than `CONFIG_TTL_SECONDS`, 30 by default. A save in the dashboard makes the gateway reload at once.

| Name                       | Worker        | Use                                                                                                    |
| -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | API, gateway | The PEM keys from `jwt.key` and `jwt.key.pub`.                                               |
| `EVENT_SECRET`             | API, gateway  | Sent as `x-event-secret` with every event and config reload. Without it the gateway answers 401 to all of them. |
| `CONFIG_JSON`              | all           | The configuration that fills an empty `config` table. The router reads its settings from it.         |
| `CONFIG_OVERRIDE`          | API, gateway  | A JSON object merged over the table on every load.                                                    |
| `CONFIG_TTL_SECONDS`       | API, gateway  | Seconds before an isolate reloads the configuration, 30 by default.                                   |
| `DB_POOL_SIZE`             | API, gateway  | Database connections per request or per hub, 5 by default. Hyperdrive does the real pooling.          |
| `E2EE_RECOVERY_MASTER_KEY` | API           | 32 bytes as hex or base64url. Without it, account recovery answers 503.                               |
| `FEDERATION_KEY`           | API           | The PEM Ed25519 key from `federation.key`. Without it the federation jobs do nothing.                 |
| `JOBS_BUDGET_MS`           | API           | How long one cron run keeps starting jobs, 25000 by default.                                          |
| `STORAGE_LOCATION`         | API           | Where files go when `MEDIA` isn't bound, `/tmp/files` by default. `/tmp` lasts for one request.       |
| `DB_LOGGING`               | gateway       | `true` logs every query.                                                                              |

The router never reads the database. Each of these overrides the ones before it:

1. `CONFIG_JSON`, from which it reads `client`, `general`, `api.endpointPublic`, `cdn.endpointPublic`, `limits.channel`, `limits.e2ee`, `register` and `security`.
2. `CLIENT_SETTINGS`, a JSON object with any of `instanceName`, `instanceId`, `iconUrl`, `logoUrl`, `helpUrl`, `activityApplicationHost`, `loadingTips`, `loadingSvg`, `allowSlowmodeBypass`, `e2eeTrustServer`, `maxGroupDmRecipients`, `emailRequired`, `joinReason` and `cdnEndpoint`.
3. `INSTANCE_NAME`.
4. With `CLIENT_SETTINGS_PATH` set, the JSON the API returns for that path, fetched at most once a minute per isolate.

The instance icon and logo have to be `http` or `https` URLs, not file paths. The CDN code reads `REQUEST_SIGNATURE`, `CDN_SIGNATURE_KEY`, `CDN_SIGN_URLS`, `CDN_SIGNATURE_INCLUDE_IP`, `CDN_SIGNATURE_INCLUDE_USER_AGENT`, `CDN_ENDPOINT_PUBLIC` and `CDN_UPSTREAM`, and falls back to the matching `security`, `cdn` and `externalRequests` values in `CONFIG_JSON`.

## Web client

`scripts/workers/prepare-assets.mjs` builds `workers/router/.deploy/public` from `assets/cache` and `assets/vencord`, after the same release check the Bun server runs. Rerun it after downloading a new client or changing Equicord. In a git worktree, point it at the main checkout with `CLIENT_CACHE_PATH=<checkout>/assets/cache VENCORD_PATH=<checkout>/assets/vencord`. Discord build 633029 gave 12,551 files. Workers Free allows 20,000 files per version and Workers Paid 100,000, and the script leaves out any file over 25 MiB.

The router builds the client page with the same `GLOBAL_ENV` and branding as the Bun server. It doesn't serve the Open Graph preview on invite pages or the add friend card at `/add/<name>`, which read the database, and it doesn't fetch Discord images missing from the cache.

## CDN

The router serves media under the same R2 keys as the Bun server's file and S3 storage, such as `avatars/<user_id>/<hash>`, so a bucket filled from the Bun server's `files` directory works as it is. Signed URLs, uploads and deletes from the Bun API are valid on the Worker. Unless `CDN_UPSTREAM` is `false`, or it is unset and `externalRequests.discordAssetFallback` is off, the Worker fetches missing default assets from `cdn.discordapp.com` once and stores them in R2.

The Worker resizes images and the Bun CDN doesn't. `?size=`, `?width=` and `?height=` are clamped to 16 through 4096 pixels and only scale down. The URL's extension or `?format=` picks WebP, PNG, JPEG or AVIF, `?quality=` sets the quality and `?animated=false` takes the first frame. PNG, JPEG, WebP, AVIF, GIF and APNG files up to 20 MB are transformed, and Cloudflare bills each unique transformation once per calendar month.

Videos are served as stored, because workerd can't run ffmpeg for preview frames. Standard stickers missing from R2, cloud attachment uploads and their clone into a message go to the API Worker, and a sticker answer is cached for 6 hours. The API Worker serves federated media, and `federation-upload` answers 404. Uploads over 100 MB fail, because that is the request body limit on the Free and Pro plans.

## Background jobs

The API Worker's Cron Trigger fires every minute and runs each job whose interval divides the minute. A job that loops over rows stops at its time slice and leaves the rest for the next run. Each job holds a PostgreSQL advisory lock, so two runs never do the same job at once. A Bun server on the same database doesn't take these locks, but the jobs that must not repeat work also claim a lease in `job_leases` or change rows with a conditional update, so a Bun server and the Workers send each update once.

| Interval   | Jobs                                                                                                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 minute   | `scheduled-messages`, `scheduled-events`, `poll-expiry`, `announcement-delivery`, `thread-archiver`, `message-purge`, `rate-limit-prune`, `attachment-files`, `image-files`, `federation-delivery` |
| 5 minutes  | `temporary-sessions`, `cloud-uploads`, `federation-registry`                                                                                                                                       |
| 10 minutes | `discovery-index`, `federation-presence`                                                                                                                                                           |
| 1 hour     | `federation-inbox-prune`, `insight-rollups`                                                                                                                                                        |

The federation jobs run only when `federation.enabled` is on and `FEDERATION_KEY` is set. The `federation-registry` job announces once every 24 hours, so a change that the Bun server announces 30 seconds later, such as a server verified for global discovery, can wait until the next daily announce.

The Workers don't do the federation startup sync that resumes and announces instance moves, the collectibles catalog refresh, delivery of announcements that have attachments, or rate limit counting shared between processes.

## Gateway

All websockets go to one Durable Object, so one gateway handles at most 32,768 sockets on one CPU thread. It speaks json and etf, zlib-stream and zstd-stream, RESUME, lazy member lists and the remote auth handshake. Sessions live in the Durable Object's memory, so when it restarts, for example after a deploy, it sends every client op 7 RECONNECT and the clients identify again.

## What doesn't work

- Voice, video, Go Live and DM calls. They need UDP and the SFU. A voice join still gets a `VOICE_SERVER_UPDATE` pointing at the first entry of `regions.available`, which is `127.0.0.1:3001/voice` by default and doesn't exist on Workers. DM call rings and the timer that ends a stage without speakers live in one API isolate's memory.
- Files the Bun server keeps next to `config.json`, such as the `.e2ee-system` keys and the `.announcement-spool`. The recovery key comes from `E2EE_RECOVERY_MASTER_KEY` instead.
- Storage quotas. The API writes to R2 without the Bun server's quota layer.
- Federation between instances, which wasn't tested.
- On the admin dashboard's System page, the client card shows no client, because the client lives in the router's assets where the API can't see it, and the performance card covers one API isolate since it started.
- Request validation for schemas that don't compile, which fail on the Bun server too.

## Local trial

`scripts/dev/workers-dev.sh <port> <database>` runs the router, the API and the gateway in one `wrangler dev` process on a local PostgreSQL database:

```sh
bun install
bun run build:src
scripts/dev/workers-dev.sh 4100 mc_workers_dev
PORT=4100 bun scripts/dev/seed.mjs
PORT=4100 bun scripts/dev/parity-probe.mjs
```

It creates and migrates the database, generates the keys and secrets once in `workers/.dev`, writes each Worker's `.dev.vars`, prepares the client assets when they are missing and starts `wrangler dev`. R2, the Durable Object and the cache are kept in `workers/.dev/state`, and the log is copied to `workers/.dev/wrangler.log`. Stop the session before `bun run build:src` or a commit that rebuilds `dist`, and start it again afterwards, because Wrangler watches `dist` and a rebuild that starts while `dist` is half written ends the session.
