const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Database } = require("bun:sqlite");
const { jobLease, loadModule } = require("./helpers/route-harness.cjs");

const MIGRATIONS = "src/database/migration/sqlite";

async function migratedDatabase() {
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const runner = {
        query: async (sql, params = []) => db.query(sql).all(...params),
        hasTable: async (name) => !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
    };
    const files = fs.readdirSync(MIGRATIONS).sort();
    assert.ok(
        files.some((file) => file.endsWith("-AttachmentFileCleanup.ts")),
        "the sqlite attachment cleanup migration exists",
    );
    const load = (file) =>
        Object.values(
            loadModule(`${MIGRATIONS}/${file}`, {
                typeorm: {},
                "../../../util/util/Snowflake": { Snowflake: { generate: () => `${Date.now()}${Math.floor(Math.random() * 1e5)}` } },
                "../../../util/util/networking/PublicNetwork": { isPrivateAddress: () => false },
            }),
        )[0];
    for (const file of files) await new (load(file))().up(runner);
    await new (load(files.find((file) => file.endsWith("-AttachmentFileCleanup.ts"))))().up(runner);
    return db;
}

const guild = (db, id) =>
    db.run(
        `INSERT INTO "guilds" ("id", "features", "large", "name", "premium_tier", "unavailable", "welcome_screen", "widget_enabled", "nsfw", "channel_ordering") VALUES (?, '[]', 0, 'g', 3, 0, '{}', 0, 0, '[]')`,
        [id],
    );
const channel = (db, id, guildId) => db.run(`INSERT INTO "channels" ("id", "guild_id", "created_at", "type", "nsfw", "flags") VALUES (?, ?, '2026-01-01', 0, 0, 0)`, [id, guildId]);
const message = (db, id, channelId, snapshots = "[]") =>
    db.run(`INSERT INTO "messages" ("id", "channel_id", "embeds", "reactions", "type", "message_snapshots") VALUES (?, ?, '[]', '[]', 0, ?)`, [id, channelId, snapshots]);
const attachment = (db, id, messageId, channelId) =>
    db.run(`INSERT INTO "attachments" ("id", "filename", "size", "message_id", "channel_id") VALUES (?, ?, 1, ?, ?)`, [id, `file ${id}.txt`, messageId, channelId]);
const forwardOf = (attachments) => JSON.stringify([{ message: { content: "", attachments: attachments.map((a) => ({ ...a, filename: `file ${a.id}.txt`, url: "x" })) } }]);
const queued = (db) =>
    db
        .query(`SELECT CAST("attachment_id" AS text) AS id FROM "attachment_file_deletes" ORDER BY "attachment_id"`)
        .all()
        .map((row) => row.id);

function sweeper(db) {
    const deleted = [];
    const { sweepAttachmentFiles } = loadModule("src/api/util/handlers/AttachmentFiles.ts", {
        "@spacebar/database/Sql": { isSqlite: () => true, sqlNow: () => "strftime('%Y-%m-%d %H:%M:%f', 'now')" },
        "../../../util/util/ProcessLifecycle": { ProcessLifecycle: { eventEmitter: { once() {} } } },
        "@spacebar/database": { getDatabase: () => ({ query: async (sql, params = []) => db.query(sql).all(...params) }) },
        "@spacebar/database/JobLease": jobLease(db),
        "@spacebar/util": {
            deleteFile: async (path) => {
                deleted.push(path);
            },
            trackBackground: (promise) => promise,
        },
    });
    return {
        deleted,
        sweep: async () => {
            db.run(`UPDATE "attachment_file_deletes" SET "created_at" = '2000-01-01 00:00:00.000'`);
            await sweepAttachmentFiles();
        },
    };
}

const paths = (channelId, messageId, id) => [`/attachments/${channelId}/${id}/file%20${id}.txt`, `/attachments/${channelId}/${messageId}/file%20${id}.txt`];

test("deleting messages, channels and guilds queues their attachment files, and forwards and reports hold them", async () => {
    const db = await migratedDatabase();
    guild(db, "10");
    guild(db, "20");
    channel(db, "100", "10");
    channel(db, "200", "10");
    channel(db, "300", "20");
    for (const [id, channelId] of [
        ["1001", "100"],
        ["1002", "100"],
        ["1003", "100"],
        ["1004", "100"],
        ["1005", "100"],
        ["1006", "300"],
        ["1007", "100"],
        ["1008", "100"],
    ]) {
        message(db, id, channelId);
        attachment(db, `${Number(id) + 1000}`, id, channelId);
    }
    message(db, "3002", "200", forwardOf([{ id: "2002", channel_id: "100", message_id: "1002" }]));
    message(db, "3003", "200", forwardOf([{ id: "2003", channel_id: "100", message_id: "1003" }]));
    message(db, "3004", "200", '[{"message":{"attachments":[{"id":"abc"},5,"x",{"id":"99999999999999999999"}]}},7,null]');
    message(db, "3005", "200", "not json");
    db.run(`INSERT INTO "reports" ("id", "type", "channel_id", "message_id", "snapshot") VALUES ('4007', 'message', '100', '1007', ?)`, [
        JSON.stringify({ content: "", attachments: [{ id: "2007", filename: "file 2007.txt", url: "x" }] }),
    ]);

    assert.deepEqual(
        db
            .query(
                `SELECT CAST("attachment_id" AS text) AS id, CAST("holder_message_id" AS text) AS message, CAST("holder_report_id" AS text) AS report FROM "attachment_holds" ORDER BY "attachment_id"`,
            )
            .all()
            .map((row) => ({ ...row })),
        [
            { id: "2002", message: "3002", report: null },
            { id: "2003", message: "3003", report: null },
            { id: "2007", message: null, report: "4007" },
        ],
    );

    db.run(`DELETE FROM "messages" WHERE "id" = '1001'`);
    db.run(`DELETE FROM "messages" WHERE "id" IN ('1002', '1003', '3003')`);
    db.run(`DELETE FROM "messages" WHERE "id" IN ('1004', '1005')`);
    db.run(`DELETE FROM "guilds" WHERE "id" = '20'`);
    db.run(`DELETE FROM "messages" WHERE "id" = '1007'`);
    db.run(`DELETE FROM "attachments" WHERE "id" = '2008'`);
    attachment(db, "2008", "1008", "100");
    assert.deepEqual(queued(db), ["2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008"]);

    const { deleted, sweep } = sweeper(db);
    await sweep();
    assert.deepEqual(
        deleted.sort(),
        [
            ...paths("100", "1001", "2001"),
            ...paths("100", "1003", "2003"),
            ...paths("100", "1004", "2004"),
            ...paths("100", "1005", "2005"),
            ...paths("300", "1006", "2006"),
        ].sort(),
    );
    assert.deepEqual(queued(db), []);

    deleted.length = 0;
    db.run(`DELETE FROM "messages" WHERE "id" = '3002'`);
    assert.deepEqual(queued(db), ["2002"]);
    await sweep();
    assert.deepEqual(deleted.sort(), paths("100", "1002", "2002").sort());
    assert.ok(db.query(`SELECT 1 FROM "attachment_holds" WHERE "attachment_id" = 2007`).get(), "the report still holds its evidence");
});

test("a forward of a forward keeps holding the file after the first forward is deleted", async () => {
    const db = await migratedDatabase();
    guild(db, "10");
    channel(db, "100", "10");
    message(db, "1001", "100");
    attachment(db, "2001", "1001", "100");
    message(db, "3001", "100", forwardOf([{ id: "2001", channel_id: "100", message_id: "1001" }]));
    db.run(`DELETE FROM "messages" WHERE "id" = '1001'`);
    message(db, "3002", "100", forwardOf([{ id: "2001", channel_id: "100", message_id: "1001" }]));
    db.run(`DELETE FROM "messages" WHERE "id" = '3001'`);
    const { deleted, sweep } = sweeper(db);
    await sweep();
    assert.deepEqual(deleted, []);
    db.run(`DELETE FROM "messages" WHERE "id" = '3002'`);
    await sweep();
    assert.deepEqual(deleted.sort(), paths("100", "1001", "2001").sort());
});

test("a failed file delete stays queued for a later sweep", async () => {
    const db = await migratedDatabase();
    guild(db, "10");
    channel(db, "100", "10");
    message(db, "1001", "100");
    attachment(db, "2001", "1001", "100");
    db.run(`DELETE FROM "messages" WHERE "id" = '1001'`);
    db.run(`UPDATE "attachment_file_deletes" SET "created_at" = '2000-01-01 00:00:00.000'`);
    const { sweepAttachmentFiles } = loadModule("src/api/util/handlers/AttachmentFiles.ts", {
        "@spacebar/database/Sql": { isSqlite: () => true, sqlNow: () => "strftime('%Y-%m-%d %H:%M:%f', 'now')" },
        "../../../util/util/ProcessLifecycle": { ProcessLifecycle: { eventEmitter: { once() {} } } },
        "@spacebar/database": { getDatabase: () => ({ query: async (sql, params = []) => db.query(sql).all(...params) }) },
        "@spacebar/database/JobLease": jobLease(db),
        "@spacebar/util": {
            deleteFile: async () => {
                throw new Error("cdn down");
            },
            trackBackground: (promise) => promise,
        },
    });
    const error = console.error;
    console.error = () => {};
    try {
        await sweepAttachmentFiles();
    } finally {
        console.error = error;
    }
    assert.deepEqual(queued(db), ["2001"]);
});

test("removing an attachment row no longer deletes its file directly", () => {
    const source = fs.readFileSync("src/database/entities/Attachment.ts", "utf8");
    assert.doesNotMatch(source, /BeforeRemove|deleteFile/);
});
