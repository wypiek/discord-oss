# Contributing

**agent contributions are allowed during the alpha.** Use a frontier model such as Opus 5.5, say so in the pull request description, and test your change for bugs and vulnerabilities.

Meowcord isn't ready for general use. Don't host a public instance unless it is labelled unstable and unofficial.

## What we won't merge

- SMS support, Quests, Orbs, ads, sponsored content, upsells, download-the-app prompts or mentions of Nitro and boosting. Every account has Premium, every server is boost level 3 with 33 boosts, nothing can be bought and every Shop item is free. The Equicord plugins in `client/plugins` remove the paid parts of the client.
- Captchas other than [Cap](https://capjs.js.org).
- Anything that hides or turns off pride flags, or adds heterosexual or cisgender flags. `scripts/tests/pride-permanent.test.cjs` enforces this.
- Changes to the README.
- Discord's code. `assets/cache`, `assets/cache_compressed`, `assets/vencord` and `.vencord` hold the downloaded client and builds of it. They are in `.gitignore` and `.dockerignore`, so keep them out of commits and images.

Markdown files belong in `docs`, and screenshots in the gitignored `docs/qa`.

## Development

Install Bun 1.4, PostgreSQL, Git and `lsof`. Voice needs Go at the version in `extra/pion-sfu/go.mod`, and Equicord's own build needs Node.js. The browser scripts need `playwright-core` and Playwright's Chrome headless shell:

```sh
mkdir -p ~/.cache/fosscord-tools
bun add --cwd ~/.cache/fosscord-tools playwright-core
bun ~/.cache/fosscord-tools/node_modules/playwright-core/cli.js install chromium-headless-shell
```

Then, in a fresh clone:

```sh
bun install
bun run generate:client
bun run dev:setup 3001 meowcord_dev_3001
```

`bun install` applies the fixes in `patches/` and turns on the pre-commit hook in `.githooks`. `generate:client` downloads the Discord web client, about 300 MB, into `assets/cache`, compresses it and builds Equicord with our plugins into `assets/vencord`.

`dev:setup <port> <database>` runs `scripts/dev/worktree-setup.sh`. It writes `.env` and `config.json`, builds the SFU when Go is installed, creates the database, builds and starts the server, and seeds two accounts with an empty encrypted DM and a server. It refuses an existing database, existing runtime configuration and occupied ports. In a git worktree it links the client cache and Equicord build from the main checkout. Its `config.json` turns off `security.captcha.blockAutomatedBrowsers`, because the seed script solves Cap in a headless browser.

Open `http://localhost:3001` and log in as `tester@fosscord.test` or `friend@fosscord.test`. The passwords are in `scripts/dev/.test-account`. To open `/admin`, grant the seeded account the operator right with `bun scripts/ops/operator.mjs grant <account-id>`.

`scripts/util/chromium.cjs` picks the newest installed headless shell, and `CHROME_PATH` overrides it. Don't point it at Google Chrome or Brave on macOS, because each launch copies about 1 GB into `/private/var/folders` and leaks it when the browser doesn't close cleanly.

To use SQLite instead of PostgreSQL, see [setup.md](docs/self-hosting/setup.md#sqlite).

### Scripts

| Command | What it does |
| --- | --- |
| `bun run build:src` | Deletes `dist`, compiles `src` into it and draws the default avatars. |
| `bun run build` | `build:src`, then regenerates `assets/schemas.json` and `assets/openapi.json`. |
| `bun run build:equicord` | Rebuilds `assets/vencord` after a change to `client/plugins`, `client/equicord-patches` or `client/vencord.json`. |
| `bun run build:e2ee`, `bun run build:mobile` | Typecheck and bundle `client/e2ee` and `client/mobile`. Commit the output with the source. |
| `bun run lint`, `bun run format` | Lint with Biome, or rewrite files in Biome's format. |
| `bun run test` | Unit tests in `scripts/tests`, `scripts/dev` and `dist`. Build first. |
| `PORT=3001 SERVER_LOG=$PWD/server.log scripts/dev/restart.sh` | Restarts the server on the current build and waits for `/api/ping`. |
| `DB_NAME=<db> PORT=3001 scripts/dev/reset-db.sh` | Stops the server and recreates the database. The default name is `fosscord`. |
| `PORT=3001 bun scripts/dev/seed.mjs` | Registers the test accounts, a DM and a server. |
| `PORT=3001 bun scripts/dev/parity-probe.mjs` | About 150 API checks. A word after it runs only matching checks, which can fail where the full run passes. |
| `PORT=3001 E2EE_TEST_DATABASE_NAME=<db> bun scripts/dev/e2ee-test.mjs` | Encrypted DMs, key backup, recovery and device approval in several browsers. About five minutes. |
| `PORT=3001 bun scripts/dev/voice-probe.mjs` | Two browsers in a voice channel, printing the audio each side sent and received. Needs the SFU. |
| `PORT=3001 bun scripts/dev/security-probe.mjs` | Runs the attacks from [the security review](docs/development/security.md) and prints `pass` for each one blocked. |
| `PORT=3001 bun scripts/dev/probe.mjs <path>` | Opens a client page as the test user and prints its text, console errors and failed requests. `--shot <file>` saves a screenshot and `--as friend` switches account. |
| `PORT=3001 bun run check:client` | Checks that every patch still matches the cached client. The first run clones Equicord into `.vencord`, about 300 MB. |

`scripts/dev` also has smoke tests, load tests, a test bot and an OAuth2 example app.

## Configuration

`CONFIG_PATH` points the server at a JSON file. The server fills in every missing key with its default and writes the file back. Without `CONFIG_PATH`, the configuration lives in the database. The admin dashboard edits the same values. These keys are specific to Meowcord:

| Key | What it controls |
| --- | --- |
| `client.instanceName` | The name that replaces Discord in the client. `Meowcord` by default. |
| `client.icon`, `client.logo` | Square icon and wordmark, as a URL or a path relative to the repository root. The icon falls back to `general.image`, then `assets/icon.png`. |
| `client.helpUrl` | Where help links go. Without it the help button is hidden. |
| `client.experiments` | Client experiment names mapped to the variant to assign. |
| `client.activityApplicationHost` | The host activities load from, see [activities.md](docs/features/activities.md). |
| `security.captcha` | Cap settings, see [signup.md](docs/features/signup.md). |
| `register.requireInvite`, `register.instanceInvites` | Invite-only registration, see [invites.md](docs/features/invites.md). |
| `limits.rate` | Rate limits per IP, globally, per route group and for errors and identify. Each bucket has a `count` and a `window` in seconds. The buckets are stored in the database. |
| `limits.e2ee` | Encryption limits, see [e2ee.md](docs/features/e2ee.md). |
| `security.webPush` | Web Push and its VAPID keys, which the server generates on first start. |
| `guild.safety` | Harmful link domains and raid detection thresholds. |
| `integrations.gifs` | GIF search providers and keys, see [external-services.md](docs/self-hosting/external-services.md). |

[client-patches.md](docs/development/client-patches.md) covers the branding keys, and [setup.md](docs/self-hosting/setup.md#environment) covers the environment variables.

## Branches and worktrees

Branch off `main`, one topic per branch. Give each parallel branch its own worktree, port and database:

```sh
git worktree add ../meowcord-voice -b voice-reconnect
cd ../meowcord-voice
scripts/dev/worktree-setup.sh 3240 meowcord_voice
```

Remove the `assets/vencord` link before running `bun run build:equicord` in a worktree, or the build writes into the main checkout. When the branch is done, stop its server, run `dropdb meowcord_voice` and remove the worktree.

## Commits

Commit in small steps. The subject is a lowercase [conventional commit](https://www.conventionalcommits.org) in the imperative, with an optional scope, no trailing period and no body:

```
fix(e2ee): keep the nonce on nonce-bound encrypted messages
perf(bans): batch bulk bans and paginate the ban list with one joined query
```

The types in use are `feat`, `fix`, `perf`, `docs`, `test`, `chore`, `build`, `refactor` and `style`.

The pre-commit hook runs `biome check` on staged files, `bun run build:src` when `src` changed and `tsc -p client/e2ee` when `client/e2ee` changed. When `src/schemas` changed, it regenerates and stages `assets/schemas.json`. It leaves `assets/openapi.json` alone because parallel branches would conflict on it, so regenerate that on `main` after merging with `bun run build`.

## Code style

- Biome formats with 4-space indents, double quotes and 180 character lines.
- No code comments. Name things so the code reads without them.
- Keep value imports for types that decorated TypeORM properties use, because `emitDecoratorMetadata` needs them.
- Change the client through an Equicord plugin whenever possible. [client-patches.md](docs/development/client-patches.md) has the order of preference and the rules for patches that survive Discord updates.
- Update a feature's row in [parity.md](docs/development/parity.md) when its state changes. Docs are plain sentences that say what happens, with numbers where there are numbers.

### Migrations

Migrations live in `src/database/migration/postgres` and `src/database/migration/sqlite` and run on startup in timestamp order. A schema change needs an equivalent migration for both backends, and the SQLite baseline never changes. Each migration is idempotent, with `IF NOT EXISTS`, `IF EXISTS` or a check before the change. Its timestamp is later than every existing one, with a random suffix such as `1791514025449`. Never touch a table that a later migration creates. Test PostgreSQL migrations on a fresh database from `worktree-setup.sh`, and SQLite with `bun test scripts/tests/sqlite-database.test.cjs`.

## Before you push

```sh
bun run build:src
bun run lint
bun run test
PORT=3001 SERVER_LOG=$PWD/server.log scripts/dev/restart.sh
PORT=3001 bun scripts/dev/parity-probe.mjs
```

The unit tests and the parity probe should end with no failures. Tests that need a database or the cached client skip themselves until `DATABASE_TEST_ADMIN_URL`, their own database variable or `assets/cache` is present. The storage runtime tests need a fresh database named `fosscord_storage_runtime_test_<name>` in `STORAGE_RUNTIME_TEST_DATABASE`. The S3 one needs a database named `fosscord_storage_runtime_s3_test_<name>` in `STORAGE_RUNTIME_S3_TEST_DATABASE`, a local S3 server such as `uvx --from 'moto[server]' moto_server -p 9177` in `STORAGE_RUNTIME_S3_TEST_ENDPOINT=http://127.0.0.1:9177`, `AWS_ACCESS_KEY_ID=synthetic-storage-test`, `AWS_SECRET_ACCESS_KEY=synthetic-storage-test-password`, and `STORAGE_RUNTIME_S3_TEST_SDK` pointing at an installed `@aws-sdk/client-s3`. CI runs the build, lint and tests, plus `bun run typecheck`, `bun run typecheck:workers`, `bun run release:pack` and the SFU's `go test`.

Rate limits persist in the `rate_limits` table. Clear them only on a database you created for the test, with `psql <db> -c "delete from rate_limits"`. Never clear rows or accounts on any other database.

Run these too when your change touches their area:

| After changing | Run |
| --- | --- |
| Messages, channels, sessions, the gateway, `client/e2ee`, `client/plugins/fosscordE2ee` or the `e2ee` routes | `e2ee-test.mjs` |
| `src/webrtc` or `extra/pion-sfu` | `voice-probe.mjs`, and check that both users report audio both ways |
| `client/plugins`, `client/equicord-patches`, `client/vencord.json`, or after downloading a new Discord build | `bun run check:client`, which exits with code 1 when a patch no longer matches |
| Signup verification | `cap-signup-smoke.mjs`, `cap-disabled-smoke.mjs`, `cap-accessibility-smoke.mjs` and `cap-disconnect-smoke.mjs` |
| Dialogs, the admin dashboard, the developer portal, slowmode or Equicord toasts | The matching `*.test.cjs` in `scripts/tests` and `*-smoke.mjs` in `scripts/dev` |

Most smoke scripts need `TEST_ACCOUNT_PATH` pointing at the seeded account file, and the admin ones need the operator right. Run each in Chromium, then with `BROWSER=webkit`, one at a time, because they share the account's rate limits.

## Listing an instance

Public instances are in `instances.json`. Add an entry with `id`, the lowercase host with the port when it isn't 443, plus `name`, `url` and `source_url` or `null`. Run `bun scripts/instances-md.mjs` to regenerate `instances.md`, and open a pull request with both files. `scripts/tests/instances-list.test.cjs` fails when they differ. An instance that moved keeps its entry, changes `id` and `url`, and lists the old ids in `previous_ids`, see [change-url.md](docs/self-hosting/change-url.md). [verification.md](docs/self-hosting/verification.md) lists what we check before approving an instance.

The registry is a Cloudflare Worker in `extra/registry` with its own `package.json`. Run `bun install` and `bun run test` in that folder after changing it.

## Releases

On a clean, committed checkout, `bun run release:pack` writes a source archive and its SHA256 checksum under `releases/`. It refuses tracked runtime configuration and cached client builds. The archive has no Discord client, Equicord build, private configuration, test credentials or databases.

## Task queue

[work-backlog.md](docs/development/work-backlog.md) lists open tasks with a stable ID, priority and acceptance target. Remove a task once its behavior is verified and shipped, and update the doc that describes the feature.
