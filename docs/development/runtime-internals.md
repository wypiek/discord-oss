# Runtime internals

This page keeps the event transport, shutdown, background job and JSON worker limits of the server process for contributors. Operators only ever set `EVENT_TRANSMISSION`, `EVENT_SOCKET_PATH` and `JSON_WORKERS`, and a single-process instance needs none of them.

## Unix event transport

`EVENT_TRANSMISSION=unix` uses `EVENT_SOCKET_PATH` as a writable shared directory. The directory must support Unix sockets and hard links. Each reader advertises a `.sock` name linked to its private bound socket. Native close removes the private path, and cleanup removes the advertised name only when its socket identity still matches. A replacement reader's socket is preserved. Startup probes existing socket paths and refuses to replace an active listener.

When `EVENT_TRANSMISSION` is set, which `THREADS` above 1 also does, or RabbitMQ is configured, the API processes share their rate limit counts through the `rate_limits` table. Every process counts in memory and writes the hits it saw to the table in one batch every 250 ms, then takes the shared totals back. Other processes can admit the requests they get within one of those 250 ms rounds before they see that a limit was reached. A single process writes nothing for limits shorter than a minute.

Each Unix writer retains at most 1,024 events or 16 MiB of encoded frames across offline backlog, queued publications and active writes. Admission snapshots the payload and rejects overflow with `IPC_QUEUE_FULL` without evicting accepted events. Capacity is released after write callbacks settle. These limits count retained frames, not kernel buffers or copies per recipient. Offline admission is not durable delivery, and final cleanup discards undelivered backlog.

The `rabbitmq-single` writer also limits pending publications to 1,024 events or 16 MiB of encoded payloads. It snapshots each payload at admission and rejects overflow with `IPC_QUEUE_FULL`. Publications run in admission order, waiting for channel drain after backpressure before publishing the next event. Failures release their reservations and don't block later queued publications. These limits don't bound broker queues, and ordinary channel publication is not a broker confirmation.

The legacy RabbitMQ adapter uses the same pending publication limits and ordered drain. It snapshots data and event type, propagates publication failures and retries channel setup at most once. A buffered publication is already accepted by the channel and is never resent if drain fails. Stopping and final close wait for admitted work before broker cleanup, and final close rejects later admissions.

## Shutdown

The server drains lifecycle work on SIGTERM and SIGINT. The cluster supervisor forwards shutdown to its workers and doesn't restart intentional exits. Compose allows 35 seconds for the server to stop, and the process has a 30 second deadline that exits with status 1 when startup or cleanup can't finish.

Accepted event callbacks and emit hooks return tracked promises across local, process, Unix socket and both RabbitMQ transports. Finalization enters a callback draining phase after component stopping and before database cleanup. It refuses unrelated new callbacks while draining accepted work and callbacks started by that work. Callback failures are isolated and logged without event payloads. Direct Unix and single RabbitMQ reader close also waits for its accepted callback promises. RabbitMQ receipt acknowledgements keep their timing. Concurrent finalization calls share completion, and recursive calls from finalization listeners don't dispatch cleanup again.

JWT key file checks share one active restoration pass. A shutdown request cancels the periodic checker, and component stopping waits for accepted writes or makes one final missing file check. Restoration writes the loaded signing keys, and initialization and restoration wait for both file writes to settle before reporting failure.

## Background jobs

Every job below runs in every process that starts it. `src/bundle/start.ts` forks `THREADS` workers, 1 by default, and each worker runs the API, CDN, gateway and voice server, so with `THREADS=4` each job runs 4 times. No job elects a leader. Jobs that must not repeat work claim rows with `FOR UPDATE SKIP LOCKED`, a lease column, a conditional update or a named lease in the `job_leases` table. Each job keeps an in-process guard so a slow run doesn't overlap the next tick, except the AFK mover and the federation inbox pruning. Every job registers a `stopping` listener on `ProcessLifecycle` that clears its timers and, where it has one, waits for the run in progress. The AFK mover is the exception, and `WebrtcServer.stop()` stops it.

| Job | Source | Every | Work per run | Across processes | On failure |
| --- | --- | --- | --- | --- | --- |
| Scheduled messages | `src/api/util/handlers/ScheduledMessages.ts` | 15 s | 100 due messages | A 5 minute lease in `claim_token` and `claim_until`, renewed every 100 s while sending | A send error stores an `ERROR_*` state. A crashed sender's lease expires and another process retries the message |
| Announcement delivery | `src/api/util/utility/announcementDelivery.ts` | 5 s | 16 deliveries, 4 at a time | A 10 minute lease token, renewed every 30 s | Backoff from 5 s doubling to 5 minutes, failed after 10 attempts |
| Message purge | `src/api/util/handlers/MessagePurge.ts` | 60 s | 500 messages per transaction until the queue is empty | `FOR UPDATE SKIP LOCKED` on queue rows | The queue row stays and the next run retries it |
| Thread auto-archive | `src/api/util/handlers/Thread.ts` | 60 s | Pages of 500 active threads, loading a full thread only when it is due | The archive is a conditional update on `archived = false`, so one process emits each `THREAD_UPDATE` | Logged, retried next run |
| Temporary sessions | `src/api/util/handlers/Instance.ts` | 5 minutes | 500 sessions older than 1 hour | `FOR UPDATE SKIP LOCKED` | Logged, retried next run |
| Attachment file sweep | `src/api/util/handlers/AttachmentFiles.ts` | 30 s | Batches of 200 queued files at least 30 s old until the queue is empty | The `attachment-files` lease, so one process sweeps at a time | The file stays queued and is retried 30 s later |
| Image file sweep | `src/api/util/handlers/ImageFiles.ts` | 30 s | Batches of 200 queued paths at least 30 s old until the queue is empty | The `image-files` lease | The path stays queued and is retried 30 s later |
| Upload slot sweep | `src/api/util/handlers/CloudUploads.ts` | 5 minutes | Batches of 100 slots older than 24 hours | The `cloud-uploads` lease | The slot stays for the next sweep |
| Scheduled event sweep | `src/database/voice/ScheduledEvents.ts` | 30 s | Batches of 100 due events, at most 10 batches | Each status change is an update conditional on the status and start time the process read, so one process emits each `GUILD_SCHEDULED_EVENT_UPDATE` | Logged, retried next run |
| Guild insights rollups | `src/database/insights/GuildInsights.ts` | 1 hour | One day per step, up to 120 days back | `INSERT ... ON CONFLICT DO NOTHING` decides which process writes a day | Logged, retried next run |
| Discovery index | `src/api/util/handlers/Discovery.ts` | 10 minutes | Pages of 500 guilds through every guild | The `discovery-index` lease, held for 9.5 minutes, so one process indexes per interval. Rewriting one server's terms takes an advisory lock on that server | Logged, retried next run |
| Federation registry | `src/api/util/utility/federation.ts` | 5 minutes, and once 10 s after startup | 200 peers, 4 at a time | The `federation-registry` lease, held for 4.5 minutes. The sync 10 s after startup takes its own `federation-startup` lease only while it runs, so a restarted process announces a changed instance id even while the hold from before the restart lasts | Logged, retried next run |
| Federation presence refresh | `src/api/util/utility/federationEvents.ts` | 10 minutes | Every online local user, once per instance that knows them | The `federation-presence` lease, held for 9.5 minutes | Logged, retried next run |
| Federation outbox | `src/api/util/utility/federationEvents.ts` | Per peer, at once while rows remain | 100 events per request, 30 s per request | A `federation-outbox:<instance>` lease while sending. A failure pauses that lease for the backoff, so every process waits it out | Backoff from 2 s doubling to 5 minutes, rows dropped after 24 hours |
| Federation inbox pruning | `src/api/util/utility/federationEvents.ts` | 1 hour | Received event ids older than 48 hours | Deletes are idempotent | Logged |
| Scam domain list | `src/api/util/utility/scamGuard.ts` | Checked every 60 s, fetched every 6 hours by default | One fetch of at most 8 MiB within 20 s | Each process keeps its own list in memory | The error is kept for the admin dashboard and the next fetch waits for its due time |
| Rate limit pruning | `src/api/middlewares/RateLimit.ts` | 60 s | Expired buckets | Deletes are idempotent | Logged |
| Presence sweep | `src/gateway/util/Utils.ts` | 15 s | Every stale session, one `UPDATE ... RETURNING` | The update returns each row to one process | Logged |
| AFK mover | `src/webrtc/util/AfkMover.ts` | 15 s | The voice sessions of its own process | Each process owns its sessions | Logged |
| Poll expiry | `src/api/util/utility/polls.ts` | A timer set to the earliest expiry | Every expired poll, recovered in batches of 100 at startup | `Message.mutate` locks the message row, so one process finalizes each poll and posts its result | Each failure is logged and the next poll runs |

The presence sweep's update has no row limit. Insight rollups compute a day in every process before one of them writes it.

### Leases across processes

`src/database/JobLease.ts` keeps one row per lease in `job_leases`: the name, a random holder token and an expiry in epoch milliseconds. `withJobLease(name, work, holdForMs)` claims the row with `INSERT ... ON CONFLICT DO UPDATE ... WHERE expires_at <= now`, renews it every 20 s while the work runs and deletes it afterwards. With `holdForMs` it keeps the row until that long after the claim, which is how the discovery index, registry sync and presence refresh run once per interval across processes. The hold lives in the database and outlasts a restart, so work that must run after every restart can't share a held lease. A process that stops while it holds a lease leaves the row to expire, 60 s after the last renewal or at the end of the hold. `pauseJob` stores a row with the holder `paused`, and `resumeJob` deletes only such a row. The Workers cron keeps its advisory lock per job and runs the same code, so the leases apply there too.

`scripts/tests/scheduler-concurrency.postgres.cjs` starts two Bun processes against a fresh PostgreSQL database and runs the same job in both at the same moment. Before the fixes it measured these failures:

| Job | What two processes did |
| --- | --- |
| Scheduled event sweep | 60 `GUILD_SCHEDULED_EVENT_UPDATE` events for 30 due events, and 4 instead of 2 for each recurring event, which a stale save could move back to an occurrence that had already ended |
| Attachment file, image file and upload slot sweeps | 120 CDN deletes for 60 queued files each, and a 404 logged for every second delete of an upload slot |
| Discovery index | One process failed with `duplicate key value violates unique constraint "PK_discovery_terms"` and left the rest of its pass undone |
| Federation outbox ids | 82 of 200 events queued in the same milliseconds were lost to an id another process had taken |
| Federation outbox delivery | Both processes sent the same 100 events, and both retried a peer that was down |
| Data package requests | Both requests passed the pending check and built a package, and the first package stayed in storage after the second replaced it |

Each of these now does its work once in that test. Scheduled messages and poll expiry were already correct and the same test covers them. The outbox caps each instance at 10,000 events per process when it queues one, and the process that holds the lease trims the instance's rows to the 10,000 newest after each failed attempt, so all processes together hold at most 10,000 once the next retry runs.

A data package request writes the new package only when the account has no package queued or running in the last hour, so a package that a stopped process left queued no longer blocks new requests. A build that finishes after a newer request replaced it deletes its own file.

A request claims its package with a conditional update that also names the package it read as the previous one. When another request's package finished in between, the claim fails, the request reads the account again and claims over the finished package, so the new build deletes that file when it is ready. A request stops after 5 claims that lose this way, and one that finds a package still queued or running is refused.

The test also covers three jobs that used to lose work across processes. Before the fixes, two processes adding 40 deliveries each to the counters in `federation_deliveries` stored 2 of 160 delivered events, because each one read, changed and saved the row. `FederationDelivery.addCounts` now inserts the row with `ON CONFLICT DO NOTHING` and adds to `delivered`, `dropped` and `queued` in one `UPDATE`, on PostgreSQL and SQLite, and moving an instance merges its counters the same way. Two processes resuming the same instance move both ran its rewrite and both logged the move. `runMove` now runs inside a `federation-move:<move id>` lease, so the second process skips the rewrite and returns the stored move. A process that stops during a rewrite leaves the move `running` and its lease expires 60 s after the last renewal, after which the next `resumeMoves` call in any process claims it and finishes the rewrite.

`serialized` in `federationMirrors.ts` runs federated work for one server, or one user's voice state, in order. It accepts at most 1,024 waiters per key and 10,000 keys with waiters at once, and rejects work past either limit with `FEDERATION_QUEUE_FULL` without queueing it. The inbox answers that with a 503 `busy` error and forgets the event id it was applying, so the sender keeps the events and sends them again after its backoff, and the events applied earlier in the batch are skipped as duplicates.

## JSON workers

Asynchronous JSON conversions start workers on demand. `JSON_WORKERS` accepts integers from 1 through 128, and the default is the CPU count capped at 128. Synchronous conversion starts no workers. Accepted requests keep workers referenced until completion and take part in the shared callback drain. Idle workers are unreferenced and terminated during final cleanup. A worker failure or the 60 second request deadline rejects that worker's pending requests, and later requests start a replacement.

JSON stream decoding keeps UTF-8 characters intact across byte chunks and rejects malformed bytes. Array enumeration parses one entry at a time, and full value decoding still buffers the whole document. Web readers release locks and cancel unfinished input on errors or early return. File readers close on early return and respect `autoClose: false` after normal completion. Enumerable output uses backpressure, closes successful output and aborts failed output with the original error. Undefined, function and symbol entries become `null` in arrays.

Worker deserialization transfers parsed values through structured clone. Numeric values match synchronous `JSON.parse`, including negative zero, overflow and underflow.

Each worker pool accepts at most 1,024 pending requests. Overflow rejects with `JSON_QUEUE_FULL` before allocating a timeout or posting the request. Pending deserialization requests also share a 128 MiB UTF-8 input budget per pool, and serialization snapshots share that budget through weighted graph accounting that counts shared references once per request. Growable buffers reserve their maximum size. This is a logical input budget, not native wire size or process memory.

Whole value decoding from file and web streams enforces the same 128 MiB UTF-8 ceiling while it accumulates text. Incremental array decoding caps each unfinished entry at 128 MiB and resets between entries, so an array can stream past 128 MiB in total. Active whole value and array entry accumulators share a 128 MiB retained text budget and at most 1,024 active reader slots, including readers waiting for their first byte. Overflow rejects with `JSON_QUEUE_FULL` and closes or cancels the reader.
