const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Database } = require("bun:sqlite");
const { jobLease, loadModule } = require("./helpers/route-harness.cjs");

const MIGRATIONS = "src/database/migration/sqlite";
const EPOCH = 1420070400000;
const HOUR = 60 * 60 * 1000;
const snowflakeAt = (time, increment) => ((BigInt(time - EPOCH) << 22n) | BigInt(increment)).toString();

async function migratedDatabase() {
    const db = new Database(":memory:");
    const runner = {
        query: async (sql, params = []) => db.query(sql).all(...params),
        hasTable: async (name) => !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
    };
    for (const file of fs.readdirSync(MIGRATIONS).sort()) {
        const migration = Object.values(
            loadModule(`${MIGRATIONS}/${file}`, {
                typeorm: {},
                "../../../util/util/Snowflake": { Snowflake: { generate: () => `${Date.now()}${Math.floor(Math.random() * 1e5)}` } },
                "../../../util/util/networking/PublicNetwork": { isPrivateAddress: () => false },
            }),
        )[0];
        await new migration().up(runner);
    }
    return db;
}

function sweeper(db, failing = new Set()) {
    const deleted = [];
    const { sweepExpiredCloudUploads, CLOUD_UPLOAD_TTL_MS } = loadModule(
        "src/api/util/handlers/CloudUploads.ts",
        {
            "../../../util/util/ProcessLifecycle": { ProcessLifecycle: { eventEmitter: { once() {} } } },
            "@spacebar/database": { getDatabase: () => ({ query: async (sql, params = []) => db.query(sql).all(...params) }) },
            "@spacebar/database/JobLease": jobLease(db),
            "@spacebar/util": {
                deleteFile: async (path) => {
                    if (failing.has(path)) throw new Error("storage unavailable");
                    deleted.push(path);
                    db.run(`DELETE FROM "cloud_attachments" WHERE "upload_filename" = ?`, [decodeURIComponent(path.slice("/attachments/".length))]);
                },
                trackBackground: (promise) => promise,
            },
        },
        { setImmediate },
    );
    return { deleted, sweep: sweepExpiredCloudUploads, ttl: CLOUD_UPLOAD_TTL_MS };
}

const upload = (db, id, userId, name, size = null) =>
    db.run(`INSERT INTO "cloud_attachments" ("id", "user_id", "channel_id", "upload_filename", "user_filename", "user_file_size", "size") VALUES (?, ?, 10, ?, ?, 5, ?)`, [
        id,
        userId,
        `10/CLOUD_${userId}_batch/0/${name}`,
        name,
        size,
    ]);
const remaining = (db) =>
    db
        .query(`SELECT "user_filename" FROM "cloud_attachments" ORDER BY "user_filename"`)
        .all()
        .map((row) => row.user_filename);

test("upload slots older than a day are deleted with their files, finished or not, and newer ones stay", async () => {
    const db = await migratedDatabase();
    const now = Date.now();
    const { deleted, sweep, ttl } = sweeper(db);
    assert.equal(ttl, 24 * HOUR);
    upload(db, snowflakeAt(now - 25 * HOUR, 1), "1", "sent.png", 5);
    upload(db, snowflakeAt(now - 25 * HOUR, 2), "1", "abandoned.png");
    upload(db, snowflakeAt(now - 2 * HOUR, 3), "1", "recent.png", 5);
    upload(db, snowflakeAt(now - 25 * HOUR, 4), null, "orphan.png", 5);
    await sweep(now);
    assert.deepEqual(remaining(db), ["recent.png"]);
    assert.deepEqual(deleted.sort(), [
        "/attachments/10/CLOUD_1_batch/0/abandoned.png",
        "/attachments/10/CLOUD_1_batch/0/sent.png",
        "/attachments/10/CLOUD_null_batch/0/orphan.png",
    ]);
});

test("uploads a scheduled message still needs stay until it is sent", async () => {
    const db = await migratedDatabase();
    const now = Date.now();
    const { sweep } = sweeper(db);
    upload(db, snowflakeAt(now - 48 * HOUR, 1), "1", "later.png", 5);
    upload(db, snowflakeAt(now - 48 * HOUR, 2), "2", "later.png", 5);
    const payload = JSON.stringify({ content: "", attachments: [{ id: "0", filename: "later.png", uploaded_filename: "10/CLOUD_1_batch/0/later.png" }] });
    db.run(`INSERT INTO "scheduled_messages" ("id", "user_id", "channel_id", "send_at", "payload", "state") VALUES (1, 1, 10, '2030-01-01', ?, 0)`, [payload]);
    db.run(`INSERT INTO "scheduled_messages" ("id", "user_id", "channel_id", "send_at", "payload", "state") VALUES (2, 2, 10, '2030-01-01', ?, 4)`, [
        payload.replace("CLOUD_1_", "CLOUD_2_"),
    ]);
    await sweep(now);
    assert.deepEqual(
        db
            .query(`SELECT CAST("user_id" AS text) AS user_id FROM "cloud_attachments"`)
            .all()
            .map((row) => row.user_id),
        ["1"],
    );
    db.run(`UPDATE "scheduled_messages" SET "state" = 4`);
    await sweep(now);
    assert.deepEqual(remaining(db), []);
});

test("an upload whose file can't be deleted keeps its row for the next sweep, and held rows don't stop the sweep", async () => {
    const db = await migratedDatabase();
    const now = Date.now();
    const failing = new Set(["/attachments/10/CLOUD_1_batch/0/stuck.png"]);
    const { sweep } = sweeper(db, failing);
    const holds = [];
    for (let i = 0; i < 150; i++) {
        upload(db, snowflakeAt(now - 30 * HOUR, i), "1", `held${i}.png`, 5);
        holds.push({ uploaded_filename: `10/CLOUD_1_batch/0/held${i}.png` });
    }
    db.run(`INSERT INTO "scheduled_messages" ("id", "user_id", "channel_id", "send_at", "payload", "state") VALUES (1, 1, 10, '2030-01-01', ?, 0)`, [
        JSON.stringify({ attachments: holds }),
    ]);
    upload(db, snowflakeAt(now - 26 * HOUR, 1), "1", "stuck.png", 5);
    upload(db, snowflakeAt(now - 26 * HOUR, 2), "1", "expired.png", 5);
    await sweep(now);
    assert.equal(remaining(db).length, 151);
    assert.ok(remaining(db).includes("stuck.png"));
    assert.ok(!remaining(db).includes("expired.png"));
    failing.clear();
    await sweep(now);
    assert.ok(!remaining(db).includes("stuck.png"));
});
