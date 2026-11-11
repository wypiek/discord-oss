const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { Client } = require("pg");

const enabled = process.env.SCHEDULER_CONCURRENCY_TEST === "1";
const options = { skip: !enabled, timeout: 60_000 };
const PROCESSES = 2;
const SNOWFLAKE_EPOCH = 1420070400000n;
let admin, client, databaseName, databaseUrl, entities, db, cdn, cdnUrl, storageLocation;
let createdDatabase = false;
const deletes = [];

const snowflake = (time, sequence) => (((BigInt(time) - SNOWFLAKE_EPOCH) << 22n) | BigInt(sequence)).toString();

before(async () => {
    if (!enabled) return;
    assert.ok(process.env.DATABASE_TEST_ADMIN_URL, "Provide a PostgreSQL connection with database creation permission");
    storageLocation = fs.mkdtempSync(path.join(os.tmpdir(), "meowcord-job-storage-"));
    admin = new Client({ connectionString: process.env.DATABASE_TEST_ADMIN_URL });
    await admin.connect();
    databaseName = `meowcord_job_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    createdDatabase = true;
    const url = new URL(process.env.DATABASE_TEST_ADMIN_URL);
    url.protocol = "postgres:";
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    process.env.DATABASE = databaseUrl;
    process.env.APPLY_DB_MIGRATIONS = "true";
    process.env.DB_POOL_SIZE = "4";
    delete process.env.DB_SYNC;
    delete process.env.DB_LOGGING;
    entities = require("../../dist/database");
    db = await entities.initDatabase();
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    cdn = http.createServer(async (req, res) => {
        deletes.push(decodeURIComponent(req.url));
        await new Promise((resolve) => setTimeout(resolve, 10));
        const cloud = /^\/attachments\/\d+\/[^/]+\/[^/]+\/[^/]+$/.test(req.url);
        if (cloud) {
            const upload = decodeURIComponent(req.url.slice("/attachments/".length));
            const removed = await client.query(`DELETE FROM "cloud_attachments" WHERE "upload_filename" = $1 RETURNING "id"`, [upload]);
            if (!removed.rowCount) {
                res.writeHead(404).end("Attachment not found");
                return;
            }
        }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ success: true }));
    });
    await new Promise((resolve) => cdn.listen(0, "127.0.0.1", resolve));
    cdnUrl = `http://127.0.0.1:${cdn.address().port}`;
});

after(async () => {
    if (!enabled) return;
    try {
        await new Promise((resolve) => (cdn ? cdn.close(resolve) : resolve()));
        await client?.end();
        if (db?.isInitialized) await db.destroy();
        if (createdDatabase) {
            const began = Date.now();
            let connections;
            do {
                const result = await admin.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1", [databaseName]);
                connections = result.rows[0].count;
                if (connections) await new Promise((resolve) => setTimeout(resolve, 25));
            } while (connections && Date.now() - began < 5000);
            await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
        }
    } finally {
        await admin?.end();
        if (storageLocation) fs.rmSync(storageLocation, { recursive: true, force: true });
    }
});

function runOnce(job, startAt, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, "scheduler-concurrency-runner.cjs")], {
            env: {
                ...process.env,
                DATABASE: databaseUrl,
                APPLY_DB_MIGRATIONS: "false",
                DB_POOL_SIZE: "4",
                SCHEDULER_JOB: job,
                SCHEDULER_CDN_URL: cdnUrl,
                SCHEDULER_START_AT: String(startAt),
                ...env,
            },
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", reject);
        child.on("exit", (code) => {
            const lines = stdout
                .split("\n")
                .filter((line) => line.startsWith("{"))
                .map((line) => JSON.parse(line));
            if (code !== 0) return reject(new Error(`${job} exited with ${code}\n${stdout}\n${stderr}`));
            resolve({ lines, stderr });
        });
    });
}

async function runConcurrently(job, env) {
    deletes.length = 0;
    const startAt = Date.now() + 4000;
    const runs = await Promise.all(Array.from({ length: PROCESSES }, () => runOnce(job, startAt, env)));
    return {
        runs,
        events: runs.flatMap(({ lines }) => lines.filter((line) => line.kind === "event").map((line) => line.value)),
        sends: runs.flatMap(({ lines }) => lines.filter((line) => line.kind === "send").map((line) => line.value)),
        federated: runs.flatMap(({ lines }) => lines.filter((line) => line.kind === "federated").map((line) => line.value.id)),
        deletes: [...deletes],
    };
}

const counts = (values) => values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map());
const duplicates = (values) => [...counts(values)].filter(([, count]) => count > 1);

async function owner() {
    return entities.User.register({ username: `job_owner_${randomUUID().slice(0, 8)}` });
}

test("two processes start and end each due scheduled event once", options, async () => {
    const user = await owner();
    const guild = await entities.Guild.createGuild({ name: "Scheduler concurrency", owner_id: user.id, source_guild_id: null });
    const now = Date.now();
    const ids = [];
    for (let index = 0; index < 30; index++) {
        const ending = index % 2 === 1;
        const event = await entities.GuildScheduledEvent.create({
            id: snowflake(now, index + 1),
            guild_id: guild.id,
            creator_id: user.id,
            name: `Event ${index}`,
            scheduled_start_time: new Date(now - 60 * 60 * 1000),
            scheduled_end_time: new Date(ending ? now - 60 * 1000 : now + 60 * 60 * 1000),
            status: ending ? 2 : 1,
            entity_type: 3,
            entity_metadata: { location: "Somewhere" },
            privacy_level: 2,
        }).save();
        ids.push(event.id);
    }
    const { events } = await runConcurrently("scheduled-events");
    assert.deepEqual(duplicates(events.map((event) => event.id)), [], "each event changes status once");
    assert.equal(events.length, 30);
    const rows = await client.query(`SELECT CAST("id" AS text) AS id, "status" FROM "guild_scheduled_events" WHERE "guild_id" = $1`, [guild.id]);
    for (const row of rows.rows) assert.equal(row.status, ids.indexOf(row.id) % 2 === 1 ? 3 : 2);
});

test("two processes move each overdue recurring event to its next occurrence once", options, async () => {
    const user = await owner();
    const guild = await entities.Guild.createGuild({ name: "Scheduler recurrence", owner_id: user.id, source_guild_id: null });
    const start = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (let index = 0; index < 30; index++)
        await entities.GuildScheduledEvent.create({
            id: snowflake(Date.now(), 100 + index),
            guild_id: guild.id,
            creator_id: user.id,
            name: `Recurring ${index}`,
            scheduled_start_time: start,
            scheduled_end_time: new Date(start.getTime() + 60 * 60 * 1000),
            status: 1,
            entity_type: 3,
            entity_metadata: { location: "Somewhere" },
            privacy_level: 2,
            recurrence_rule: { frequency: 2, interval: 1, start: start.toISOString() },
            exceptions: [],
        }).save();
    const { events } = await runConcurrently("scheduled-events");
    const perEvent = counts(events.map((event) => event.id));
    assert.equal(perEvent.size, 30);
    for (const [id, count] of perEvent) assert.equal(count, 2, `event ${id} starts once and completes once`);
    const rows = await client.query(`SELECT "status", "scheduled_start_time" FROM "guild_scheduled_events" WHERE "guild_id" = $1`, [guild.id]);
    for (const row of rows.rows) {
        assert.equal(row.status, 1);
        assert.equal(new Date(row.scheduled_start_time).getTime(), start.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
});

test("two processes delete each replaced image file once", options, async () => {
    const paths = Array.from({ length: 60 }, (_, index) => `avatars/${snowflake(Date.now(), index)}/${randomUUID().replaceAll("-", "")}`);
    for (const file of paths) await client.query(`INSERT INTO "image_file_deletes" ("path", "created_at") VALUES ($1, now() - interval '5 minutes')`, [file]);
    const result = await runConcurrently("image-files");
    assert.deepEqual(duplicates(result.deletes), [], "each image is deleted once");
    assert.equal(result.deletes.length, paths.length);
    const left = await client.query(`SELECT count(*)::int AS count FROM "image_file_deletes"`);
    assert.equal(left.rows[0].count, 0);
});

test("two processes delete each removed attachment file once", options, async () => {
    const channel = snowflake(Date.now(), 4000);
    for (let index = 0; index < 60; index++)
        await client.query(
            `INSERT INTO "attachment_file_deletes" ("attachment_id", "channel_id", "message_id", "filename", "created_at") VALUES ($1, $2, NULL, $3, now() - interval '5 minutes')`,
            [snowflake(Date.now(), 1000 + index), channel, `file-${index}.txt`],
        );
    const result = await runConcurrently("attachment-files");
    assert.deepEqual(duplicates(result.deletes), [], "each attachment file is deleted once");
    assert.equal(result.deletes.length, 60);
    const left = await client.query(`SELECT count(*)::int AS count FROM "attachment_file_deletes"`);
    assert.equal(left.rows[0].count, 0);
});

test("two processes delete each expired upload slot once", options, async () => {
    const old = Date.now() - 25 * 60 * 60 * 1000;
    const channel = snowflake(Date.now(), 4001);
    for (let index = 0; index < 60; index++)
        await client.query(`INSERT INTO "cloud_attachments" ("id", "user_id", "channel_id", "upload_filename", "user_filename") VALUES ($1, NULL, NULL, $2, $3)`, [
            snowflake(old, index),
            `${channel}/${randomUUID()}/${index}/file-${index}.txt`,
            `file-${index}.txt`,
        ]);
    const result = await runConcurrently("cloud-uploads");
    assert.deepEqual(duplicates(result.deletes), [], "each upload slot is deleted once");
    assert.equal(result.deletes.length, 60);
    const left = await client.query(`SELECT count(*)::int AS count FROM "cloud_attachments"`);
    assert.equal(left.rows[0].count, 0);
});

test("two processes rebuild the discovery search index at once without failing on each other's terms", options, async () => {
    const user = await owner();
    const ids = [];
    for (let index = 0; index < 40; index++) {
        const guild = await entities.Guild.createGuild({ name: `Concurrency search ${index} alpha beta gamma`, owner_id: user.id, source_guild_id: null });
        ids.push(guild.id);
    }
    await client.query(`DELETE FROM "discovery_terms"`);
    const { runs } = await runConcurrently("discovery-index");
    const changed = runs.map(({ lines }) => lines.find((line) => line.kind === "done").value);
    assert.ok(changed.every((value) => Number.isInteger(value)));
    const terms = await client.query(`SELECT CAST("guild_id" AS text) AS id, count(*)::int AS count FROM "discovery_terms" WHERE "guild_id" = ANY($1) GROUP BY "guild_id"`, [ids]);
    assert.equal(terms.rows.length, ids.length);
});

test("one of two processes rebuilds the discovery search index per interval and the other skips its turn", options, async () => {
    const user = await owner();
    for (let index = 0; index < 5; index++) await entities.Guild.createGuild({ name: `Interval search ${index}`, owner_id: user.id, source_guild_id: null });
    await client.query(`DELETE FROM "discovery_terms"`);
    const { runs } = await runConcurrently("discovery-index-interval");
    const results = runs.map(({ lines }) => lines.find((line) => line.kind === "done").value);
    assert.deepEqual(results.map((result) => result.held).sort(), [false, true]);
    assert.ok(results.find((result) => result.held).value >= 5);
    const lease = await client.query(`SELECT "expires_at" FROM "job_leases" WHERE "name" = 'discovery-index'`);
    assert.ok(Number(lease.rows[0].expires_at) > Date.now() + 8 * 60 * 1000);
    const again = await runConcurrently("discovery-index-interval");
    assert.deepEqual(
        again.runs.map(({ lines }) => lines.find((line) => line.kind === "done").value.held),
        [false, false],
    );
});

test("two processes queue federated events at the same moment without losing any to an id collision", options, async () => {
    const users = [];
    for (let index = 0; index < 100; index++) users.push((await owner()).id);
    await client.query(`DELETE FROM "federation_outbox"`);
    const { runs } = await runConcurrently("federation-enqueue", { SCHEDULER_USERS: JSON.stringify(users) });
    assert.deepEqual(
        runs.map(({ lines }) => lines.find((line) => line.kind === "done").value),
        [0, 0],
    );
    const queued = await client.query(`SELECT count(*)::int AS count FROM "federation_outbox" WHERE "instance" = 'peer.test'`);
    assert.equal(queued.rows[0].count, users.length * PROCESSES);
});

test("two processes deliver each queued federated event once", options, async () => {
    await client.query(`DELETE FROM "federation_outbox"`);
    for (let index = 0; index < 150; index++)
        await client.query(`INSERT INTO "federation_outbox" ("id", "instance", "wire", "created_at") VALUES ($1, 'peer.test', $2, now())`, [
            String(1_000_000 + index),
            JSON.stringify({ event: "PRESENCE_UPDATE", data: {}, recipients: [] }),
        ]);
    const { federated } = await runConcurrently("federation-delivery");
    assert.deepEqual(duplicates(federated), [], "each event is sent once");
    const left = await client.query(`SELECT count(*)::int AS count FROM "federation_outbox"`);
    assert.equal(left.rows[0].count + federated.length, 150);
});

test("when the other instance is down, one process tries it and the other waits out the same backoff", options, async () => {
    await client.query(`DELETE FROM "federation_outbox"`);
    await client.query(`DELETE FROM "job_leases"`);
    for (let index = 0; index < 20; index++)
        await client.query(`INSERT INTO "federation_outbox" ("id", "instance", "wire", "created_at") VALUES ($1, 'peer.test', $2, now())`, [
            String(2_000_000 + index),
            JSON.stringify({ event: "PRESENCE_UPDATE", data: {}, recipients: [] }),
        ]);
    const { runs } = await runConcurrently("federation-delivery", { SCHEDULER_FEDERATION_DOWN: "1" });
    const attempts = runs.flatMap(({ lines }) => lines.filter((line) => line.kind === "attempt"));
    assert.equal(attempts.length, 1);
    const lease = await client.query(`SELECT "holder", "expires_at" FROM "job_leases" WHERE "name" = 'federation-outbox:peer.test'`);
    assert.equal(lease.rows[0].holder, "paused");
    assert.ok(Number(lease.rows[0].expires_at) > Date.now());
    const left = await client.query(`SELECT count(*)::int AS count FROM "federation_outbox"`);
    assert.equal(left.rows[0].count, 20);
});

test("events that several processes queued for an instance that is down are trimmed to the 10,000 newest", options, async () => {
    await client.query(`DELETE FROM "federation_outbox"`);
    await client.query(`DELETE FROM "job_leases"`);
    await client.query(
        `INSERT INTO "federation_outbox" ("id", "instance", "wire", "created_at") SELECT 3000000 + n, 'peer.test', '{"event":"PRESENCE_UPDATE","data":{},"recipients":[]}', now() FROM generate_series(1, 25000) AS n`,
    );
    const { runs } = await runConcurrently("federation-delivery", { SCHEDULER_FEDERATION_DOWN: "1" });
    assert.equal(runs.flatMap(({ lines }) => lines.filter((line) => line.kind === "attempt")).length, 1);
    const left = await client.query(`SELECT count(*)::int AS count, min("id")::text AS oldest FROM "federation_outbox"`);
    assert.equal(left.rows[0].count, 10_000);
    assert.equal(left.rows[0].oldest, String(3000000 + 15001));
    const stats = await client.query(`SELECT "dropped" FROM "federation_deliveries" WHERE "instance" = 'peer.test'`);
    assert.ok(Number(stats.rows[0].dropped) >= 15_000);
});

test("two processes counting deliveries for one instance at once keep every increment", options, async () => {
    await client.query(`DELETE FROM "federation_deliveries"`);
    const rounds = 40;
    await runConcurrently("federation-count", { SCHEDULER_ROUNDS: String(rounds) });
    const stats = await client.query(`SELECT "delivered"::int AS delivered, "dropped"::int AS dropped FROM "federation_deliveries" WHERE "instance" = 'peer.test'`);
    assert.deepEqual(stats.rows[0], { delivered: 2 * rounds * PROCESSES, dropped: rounds * PROCESSES });
});

async function queueMove(from, to, status) {
    const id = snowflake(Date.now(), Math.floor(Math.random() * 4000));
    await client.query(
        `INSERT INTO "federation_moves" ("id", "from_id", "to_id", "at", "source", "status", "created_at") VALUES ($1, $2, $3, now() - interval '1 hour', 'registry', $4, now())`,
        [id, from, to, status],
    );
    await client.query(
        `INSERT INTO "federated_objects" ("canonical", "local_id", "instance", "created_at") SELECT '@' || n || '@' || $1::text, $2::text || '-' || n, $1::text, now() FROM generate_series(1, 1500) AS n`,
        [from, id.slice(0, 10)],
    );
    return id;
}

const moved = (runs) => runs.flatMap(({ lines }) => lines.filter((line) => line.kind === "moved"));

test("two processes resuming the same instance move run its rewrite once", options, async () => {
    await client.query(`DELETE FROM "job_leases"`);
    const id = await queueMove("old-a.test", "new-a.test", "pending");
    const { runs } = await runConcurrently("federation-move-resume");
    assert.equal(moved(runs).length, 1, JSON.stringify(moved(runs)));
    const row = await client.query(`SELECT "status" FROM "federation_moves" WHERE "id" = $1`, [id]);
    assert.equal(row.rows[0].status, "applied");
    const left = await client.query(`SELECT count(*)::int AS count FROM "federated_objects" WHERE "instance" = 'old-a.test'`);
    assert.equal(left.rows[0].count, 0);
});

test("a move that a stopped process left running finishes once its claim expires", options, async () => {
    await client.query(`DELETE FROM "job_leases"`);
    const id = await queueMove("old-b.test", "new-b.test", "running");
    await client.query(`INSERT INTO "job_leases" ("name", "holder", "expires_at") VALUES ($1, 'stopped-process', $2)`, [`federation-move:${id}`, Date.now() + 60_000]);
    const blocked = await runConcurrently("federation-move-resume");
    assert.equal(moved(blocked.runs).length, 0);
    assert.equal((await client.query(`SELECT "status" FROM "federation_moves" WHERE "id" = $1`, [id])).rows[0].status, "running");
    await client.query(`UPDATE "job_leases" SET "expires_at" = $2 WHERE "name" = $1`, [`federation-move:${id}`, Date.now() - 1]);
    const { runs } = await runConcurrently("federation-move-resume");
    assert.equal(moved(runs).length, 1);
    assert.equal((await client.query(`SELECT "status" FROM "federation_moves" WHERE "id" = $1`, [id])).rows[0].status, "applied");
});

async function guildChannel(name) {
    const user = await owner();
    const guild = await entities.Guild.createGuild({ name, owner_id: user.id, source_guild_id: null });
    await entities.Member.create({
        id: user.id,
        guild_id: guild.id,
        joined_at: new Date(),
        deaf: false,
        mute: false,
        pending: false,
        bio: "",
        settings: {},
        roles: [entities.Role.create({ id: guild.id })],
    }).save();
    const channel = await entities.Channel.findOneOrFail({ where: { guild_id: guild.id, type: 0 } });
    return { user, guild, channel };
}

test("two processes send each due scheduled message once", options, async () => {
    const { user, channel } = await guildChannel("Scheduler messages");
    const ids = [];
    for (let index = 0; index < 20; index++) {
        const scheduled = await entities.ScheduledMessage.create({
            id: snowflake(Date.now(), 200 + index),
            user_id: user.id,
            channel_id: channel.id,
            send_at: new Date(Date.now() - 60 * 1000),
            payload: { content: `Scheduled ${index}` },
            state: 0,
        }).save();
        ids.push(scheduled.id);
    }
    const { sends } = await runConcurrently("scheduled-messages");
    assert.deepEqual(duplicates(sends.map((send) => send.message_id)), [], "each message is sent once");
    assert.equal(sends.length, ids.length);
    const left = await client.query(`SELECT count(*)::int AS count FROM "scheduled_messages" WHERE "id" = ANY($1)`, [ids]);
    assert.equal(left.rows[0].count, 0);
});

test("two processes post each expired poll's result once", options, async () => {
    const { user, guild, channel } = await guildChannel("Scheduler polls");
    const ids = [];
    for (let index = 0; index < 20; index++) {
        const message = await entities.Message.create({
            id: snowflake(Date.now(), 300 + index),
            channel_id: channel.id,
            guild_id: guild.id,
            author_id: user.id,
            type: 0,
            content: "",
            timestamp: new Date(),
            embeds: [],
            attachments: [],
            reactions: [],
            components: [],
            sticker_items: [],
            mentions: [],
            mention_roles: [],
            mention_channels: [],
            poll: {
                question: { text: `Poll ${index}` },
                answers: [
                    { answer_id: 1, poll_media: { text: "Yes" } },
                    { answer_id: 2, poll_media: { text: "No" } },
                ],
                expiry: new Date(Date.now() - 60 * 1000),
                allow_multiselect: false,
                layout_type: 1,
                results: { is_finalized: false, answer_counts: [] },
            },
        }).save();
        ids.push(message.id);
    }
    const { sends } = await runConcurrently("poll-expiry");
    assert.deepEqual(duplicates(sends.map((send) => send.reference)), [], "each result is posted once");
    assert.deepEqual(sends.map((send) => send.reference).sort(), [...ids].sort());
});

test("two data package requests from the same account at once build one package", options, async () => {
    const user = await owner();
    const { runs } = await runConcurrently("harvest-request", { SCHEDULER_USER: user.id, STORAGE_LOCATION: storageLocation });
    const results = runs.map(({ lines }) => lines.find((line) => line.kind === "done").value);
    assert.equal(results.filter((result) => result === "refused").length, 1, `one request is refused: ${JSON.stringify(results)}`);
    const stored = await client.query(`SELECT "account_preferences"->'harvest' AS harvest FROM "users" WHERE "id" = $1`, [user.id]);
    assert.equal(
        stored.rows[0].harvest.harvest_id,
        results.find((result) => result !== "refused"),
    );
    assert.equal(stored.rows[0].harvest.status, 3);
    const packages = fs.readdirSync(path.join(storageLocation, "harvests", user.id));
    assert.deepEqual(packages, [`${stored.rows[0].harvest.harvest_id}.zip`]);
});
