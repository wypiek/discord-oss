const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { Pool } = require("pg");
const { DataSource } = require("typeorm");

function loadSource(relative) {
    const filename = path.resolve(__dirname, "../..", relative);
    const js = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(js, { module, exports: module.exports, require, console, setInterval, clearInterval }, { filename });
    return module.exports;
}

const { dispatchClaimedScheduledMessage: dispatch } = loadSource("src/api/util/handlers/ScheduledMessageDispatch.ts");
const { ScheduledMessageDeliveryLease1791568734927: Migration } = loadSource("src/database/migration/postgres/1791568734927-ScheduledMessageDeliveryLease.ts");
const { ScheduledMessageId1793152846317: MessageIdMigration } = loadSource("src/database/migration/postgres/1793152846317-ScheduledMessageId.ts");

test("scheduled delivery uses renewable database claims and retains interrupted work", { skip: !process.env.SCHEDULED_TEST_DATABASE }, async (t) => {
    const schema = `scheduled_delivery_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: process.env.SCHEDULED_TEST_DATABASE, max: 1 });
    let pool;
    try {
        await admin.query(`CREATE SCHEMA "${schema}"`);
        pool = new DataSource({
            type: "postgres",
            url: process.env.SCHEDULED_TEST_DATABASE,
            poolSize: 1,
            extra: { options: `-c search_path=${schema}`, connectionTimeoutMillis: 1000 },
        });
        await pool.initialize();
        const query = async (sql, parameters) => pool.query(sql, parameters);
        await query(
            `CREATE TABLE scheduled_messages (id bigint PRIMARY KEY, state smallint NOT NULL DEFAULT 0, send_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL DEFAULT '{}')`,
        );
        const migration = new Migration();
        await migration.up({ query });
        await migration.up({ query });
        const messageIdMigration = new MessageIdMigration();
        await messageIdMigration.up({ query });
        await messageIdMigration.up({ query });
        const insert = async (id, sendAt = new Date(0)) => query(`INSERT INTO scheduled_messages (id, send_at, payload) VALUES ($1, $2, '{"content":"fresh"}')`, [id, sendAt]);
        const row = async (id) => (await query(`SELECT * FROM scheduled_messages WHERE id = $1`, [id]))[0];

        await t.test("pool-size-one delivery can use the same pool and removes only after success", async () => {
            await insert("101");
            assert.equal(
                await dispatch(query, "101", async (scheduled) => {
                    assert.equal(scheduled.payload.content, "fresh");
                    assert.equal((await row("101")).state, 0);
                    return null;
                }),
                true,
            );
            assert.equal(await row("101"), undefined);
        });

        await t.test("concurrent workers cannot deliver the same unexpired claim", async () => {
            await insert("102");
            let release;
            let started;
            const gate = new Promise((resolve) => {
                release = resolve;
            });
            const ready = new Promise((resolve) => {
                started = resolve;
            });
            let sends = 0;
            const first = dispatch(query, "102", async () => {
                sends++;
                started();
                await gate;
                return null;
            });
            await ready;
            assert.equal(
                await dispatch(query, "102", async () => {
                    sends++;
                    return null;
                }),
                false,
            );
            release();
            assert.equal(await first, true);
            assert.equal(sends, 1);
        });

        await t.test("unexpected delivery interruption retains payload and retries after claim expiry", async () => {
            await insert("103");
            await assert.rejects(
                dispatch(query, "103", async () => {
                    throw new Error("interrupted");
                }),
                /interrupted/,
            );
            assert.equal((await row("103")).payload.content, "fresh");
            assert.equal(await dispatch(query, "103", async () => assert.fail("active claim delivered")), false);
            await query(`UPDATE scheduled_messages SET claim_until = now() - interval '1 second' WHERE id = 103`);
            assert.equal(await dispatch(query, "103", async () => null), true);
        });

        await t.test("known failure preserves the queue row as a terminal error without a claim", async () => {
            await insert("104");
            assert.equal(await dispatch(query, "104", async () => 5), false);
            const failed = await row("104");
            assert.equal(failed.state, 5);
            assert.equal(failed.claim_token, null);
            assert.equal(failed.claim_until, null);
        });

        await t.test("worker rechecks due time but explicit send still sends future messages", async () => {
            await insert("105", new Date(Date.now() + 600_000));
            assert.equal(await dispatch(query, "105", async () => assert.fail("future message delivered"), true), false);
            assert.equal(await dispatch(query, "105", async () => null), true);
        });

        await t.test("stale delivery cannot acknowledge a replacement claim", async () => {
            await insert("106");
            assert.equal(
                await dispatch(query, "106", async () => {
                    await query(`UPDATE scheduled_messages SET claim_token = $1 WHERE id = 106`, [randomUUID()]);
                    return null;
                }),
                false,
            );
            assert.ok(await row("106"));
        });

        await t.test("a retry after an interrupted send reuses the message id from the first claim", async () => {
            await insert("107");
            const seen = [];
            await assert.rejects(
                dispatch(
                    query,
                    "107",
                    async (scheduled) => {
                        seen.push(String(scheduled.message_id));
                        throw new Error("crashed after publishing");
                    },
                    false,
                    "900",
                ),
                /crashed after publishing/,
            );
            await query(`UPDATE scheduled_messages SET claim_until = now() - interval '1 second' WHERE id = 107`);
            assert.equal(
                await dispatch(
                    query,
                    "107",
                    async (scheduled) => {
                        seen.push(String(scheduled.message_id));
                        return null;
                    },
                    false,
                    "901",
                ),
                true,
            );
            assert.deepEqual(seen, ["900", "900"]);
        });

        await messageIdMigration.down({ query });
        await messageIdMigration.down({ query });
        await migration.down({ query });
        await migration.down({ query });
        await migration.up({ query });
    } finally {
        if (pool?.isInitialized) await pool.destroy();
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
    }
});
