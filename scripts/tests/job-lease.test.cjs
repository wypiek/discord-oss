const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Database } = require("bun:sqlite");
const { jobLease, loadModule } = require("./helpers/route-harness.cjs");

function leases() {
    const db = new Database(":memory:");
    const file = fs.readdirSync("src/database/migration/sqlite").find((name) => name.endsWith("-JobLeases.ts"));
    const migration = Object.values(loadModule(`src/database/migration/sqlite/${file}`, { typeorm: {} }))[0];
    return new migration().up({ query: async (sql, params = []) => db.query(sql).all(...params) }).then(() => ({ db, ...jobLease(db) }));
}

test("only one holder runs a job at a time and the lease is released when it finishes", async () => {
    const { db, withJobLease } = await leases();
    let release;
    const blocked = new Promise((resolve) => (release = resolve));
    const first = withJobLease("sweep", () => blocked.then(() => "first"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual({ ...(await withJobLease("sweep", async () => "second")) }, { held: false });
    assert.deepEqual({ ...(await withJobLease("other", async () => "other")) }, { held: true, value: "other" });
    release();
    assert.deepEqual({ ...(await first) }, { held: true, value: "first" });
    assert.equal(db.query(`SELECT count(*) AS count FROM "job_leases"`).get().count, 0);
    assert.deepEqual({ ...(await withJobLease("sweep", async () => "third")) }, { held: true, value: "third" });
});

test("a job that holds its lease for an interval keeps other processes out until the interval ends", async () => {
    const { db, withJobLease } = await leases();
    assert.deepEqual({ ...(await withJobLease("index", async () => 1, 60_000)) }, { held: true, value: 1 });
    assert.deepEqual({ ...(await withJobLease("index", async () => 2, 60_000)) }, { held: false });
    db.run(`UPDATE "job_leases" SET "expires_at" = ?`, [Date.now() - 1]);
    assert.deepEqual({ ...(await withJobLease("index", async () => 3, 60_000)) }, { held: true, value: 3 });
});

test("a failed job releases its lease and passes the error on", async () => {
    const { db, withJobLease } = await leases();
    await assert.rejects(
        withJobLease("sweep", async () => {
            throw new Error("storage unavailable");
        }),
        /storage unavailable/,
    );
    assert.equal(db.query(`SELECT count(*) AS count FROM "job_leases"`).get().count, 0);
});

test("an expired lease of a crashed holder can be taken over", async () => {
    const { db, claimJobLease } = await leases();
    assert.equal(await claimJobLease("sweep", Date.now() + 60_000, "crashed"), "crashed");
    assert.equal(await claimJobLease("sweep", Date.now() + 60_000, "next"), null);
    db.run(`UPDATE "job_leases" SET "expires_at" = ?`, [Date.now() - 1]);
    assert.equal(await claimJobLease("sweep", Date.now() + 60_000, "next"), "next");
    assert.equal(db.query(`SELECT "holder" FROM "job_leases"`).get().holder, "next");
});

test("a paused job stays paused for every process until it is resumed or the pause runs out", async () => {
    const { db, withJobLease, pauseJob, resumeJob } = await leases();
    const paused = await withJobLease("outbox", async () => {
        await pauseJob("outbox", Date.now() + 60_000);
        return "failed";
    });
    assert.equal(paused.value, "failed");
    assert.equal(db.query(`SELECT "holder" FROM "job_leases"`).get().holder, "paused");
    assert.equal((await withJobLease("outbox", async () => "retry")).held, false);
    await resumeJob("outbox");
    assert.equal((await withJobLease("outbox", async () => "retry")).value, "retry");
    await pauseJob("outbox", Date.now() - 1);
    assert.equal((await withJobLease("outbox", async () => "expired")).value, "expired");
});
