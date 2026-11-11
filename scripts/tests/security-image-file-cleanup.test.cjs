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
    const cleanup = files.find((file) => file.endsWith("-ImageFileCleanup.ts"));
    assert.ok(cleanup, "the sqlite image cleanup migration exists");
    const load = (file) =>
        Object.values(
            loadModule(`${MIGRATIONS}/${file}`, {
                typeorm: {},
                "../../../util/util/Snowflake": { Snowflake: { generate: () => `${Date.now()}${Math.floor(Math.random() * 1e5)}` } },
                "../../../util/util/networking/PublicNetwork": { isPrivateAddress: () => false },
            }),
        )[0];
    for (const file of files) await new (load(file))().up(runner);
    await new (load(cleanup))().up(runner);
    return db;
}

function insert(db, table, values) {
    const row = { ...values };
    for (const column of db.query(`PRAGMA table_info("${table}")`).all()) {
        if (column.name in row || !column.notnull || column.dflt_value !== null || column.pk) continue;
        row[column.name] = /int|bool/i.test(column.type) ? 0 : /date|time/i.test(column.type) ? "2026-01-01" : "{}";
    }
    if (table === "members") delete row.index;
    const names = Object.keys(row);
    db.query(`INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...Object.values(row));
}

const queued = (db) =>
    db
        .query(`SELECT "path" FROM "image_file_deletes" ORDER BY "path"`)
        .all()
        .map((row) => row.path);

function sweeper(db, deleteFile) {
    const deleted = [];
    const { sweepImageFiles } = loadModule("src/api/util/handlers/ImageFiles.ts", {
        "@spacebar/database/Sql": { isSqlite: () => true, sqlNow: () => "strftime('%Y-%m-%d %H:%M:%f', 'now')" },
        "../../../util/util/ProcessLifecycle": { ProcessLifecycle: { eventEmitter: { once() {} } } },
        "@spacebar/database": { getDatabase: () => ({ query: async (sql, params = []) => db.query(sql).all(...params) }) },
        "@spacebar/database/JobLease": jobLease(db),
        "@spacebar/util": {
            deleteFile:
                deleteFile ??
                (async (path) => {
                    deleted.push(path);
                }),
            trackBackground: (promise) => promise,
        },
    });
    return {
        deleted,
        sweep: async () => {
            db.run(`UPDATE "image_file_deletes" SET "created_at" = '2000-01-01 00:00:00.000'`);
            await sweepImageFiles();
        },
    };
}

const recent = (...hashes) => JSON.stringify(hashes.map((hash, index) => ({ id: `${index}`, storage_hash: hash, description: null })));

test("a replaced avatar stays while the recent avatars list or a report shows it and is deleted after", async () => {
    const db = await migratedDatabase();
    insert(db, "users", { id: "1", username: "a", discriminator: "0", avatar: "a1", banner: "b1", recent_avatars: recent("a1") });
    insert(db, "users", { id: "2", username: "b", discriminator: "0", avatar: "c1" });
    insert(db, "reports", { id: "50", type: "message", snapshot: JSON.stringify({ author: { id: "2", username: "b", avatar: "c1" } }) });

    db.run(`UPDATE "users" SET "avatar" = 'a2', "recent_avatars" = ? WHERE "id" = 1`, [recent("a2", "a1")]);
    db.run(`UPDATE "users" SET "banner" = NULL WHERE "id" = 1`);
    db.run(`UPDATE "users" SET "avatar" = 'c2' WHERE "id" = 2`);
    db.run(`UPDATE "users" SET "avatar" = 'a2' WHERE "id" = 1`);
    assert.deepEqual(queued(db), ["avatars/1/a1", "avatars/2/c1", "banners/1/b1"]);

    const { deleted, sweep } = sweeper(db);
    await sweep();
    assert.deepEqual(deleted, ["/banners/1/b1"]);
    assert.deepEqual(queued(db), []);

    db.run(`UPDATE "users" SET "recent_avatars" = ? WHERE "id" = 1`, [recent("a2")]);
    await sweep();
    assert.deepEqual(deleted, ["/banners/1/b1", "/avatars/1/a1"]);

    db.run(`UPDATE "users" SET "avatar" = NULL, "recent_avatars" = '[]' WHERE "id" = 1`);
    await sweep();
    assert.deepEqual(deleted, ["/banners/1/b1", "/avatars/1/a1", "/avatars/1/a2"]);

    db.run(`DELETE FROM "reports" WHERE "id" = 50`);
    db.run(`UPDATE "users" SET "avatar" = 'c1' WHERE "id" = 2`);
    db.run(`UPDATE "users" SET "avatar" = 'c3' WHERE "id" = 2`);
    await sweep();
    assert.deepEqual(deleted.slice(3).sort(), ["/avatars/2/c1", "/avatars/2/c2"]);
});

test("webhook avatars stay while a message still shows them", async () => {
    const db = await migratedDatabase();
    insert(db, "users", { id: "1", username: "owner", discriminator: "0" });
    insert(db, "guilds", { id: "10", name: "g" });
    insert(db, "channels", { id: "100", guild_id: "10", type: 0 });
    insert(db, "webhooks", { id: "30", type: 1, avatar: "w1", channel_id: "100", guild_id: "10" });
    insert(db, "users", { id: "30", username: "hook", discriminator: "0000", bot: 1, avatar: "w1" });
    insert(db, "messages", { id: "1001", channel_id: "100", author_id: "30", webhook_id: "30", avatar: "w1", type: 0 });
    insert(db, "messages", { id: "1002", channel_id: "100", author_id: "30", webhook_id: "30", avatar: "url1", type: 0 });

    db.run(`UPDATE "webhooks" SET "avatar" = 'w2' WHERE "id" = 30`);
    db.run(`UPDATE "users" SET "avatar" = 'w2' WHERE "id" = 30`);
    const { deleted, sweep } = sweeper(db);
    await sweep();
    assert.deepEqual(deleted, []);

    db.run(`DELETE FROM "messages" WHERE "id" IN (1001, 1002)`);
    await sweep();
    assert.deepEqual(deleted.sort(), ["/avatars/30/url1", "/avatars/30/w1"]);
});

test("guild, channel, role, member, application, game and event images are deleted when replaced, cleared or their row is deleted", async () => {
    const db = await migratedDatabase();
    insert(db, "users", { id: "1", username: "owner", discriminator: "0" });
    insert(db, "guilds", { id: "10", name: "g", icon: "i1", banner: "gb1", splash: "s1", discovery_splash: "d1", profile: JSON.stringify({ custom_banner_hash: "p1" }) });
    insert(db, "channels", { id: "100", guild_id: "10", type: 0, icon: "ci1" });
    insert(db, "roles", { id: "200", guild_id: "10", name: "r", icon: "ri1" });
    insert(db, "members", { id: "1", guild_id: "10", avatar: "ma1", banner: "same" });
    insert(db, "applications", { id: "40", name: "app", owner_id: "1", icon: "ai1", cover_image: "same" });
    insert(db, "custom_games", { id: "60", name: "game", icon_hash: "gi1" });
    insert(db, "guild_scheduled_events", { id: "70", guild_id: "10", name: "e", scheduled_start_time: "2026-01-01", entity_type: 3, image: "e1" });

    db.run(`UPDATE "guilds" SET "icon" = 'i2', "banner" = NULL, "splash" = 's2', "discovery_splash" = 'd2', "profile" = ? WHERE "id" = 10`, [
        JSON.stringify({ custom_banner_hash: "p2" }),
    ]);
    db.run(`UPDATE "channels" SET "icon" = 'ci2' WHERE "id" = 100`);
    db.run(`UPDATE "roles" SET "icon" = NULL WHERE "id" = 200`);
    db.run(`UPDATE "members" SET "avatar" = 'same' WHERE "id" = 1`);
    db.run(`UPDATE "applications" SET "icon" = 'same' WHERE "id" = 40`);
    db.run(`UPDATE "custom_games" SET "icon_hash" = 'gi2' WHERE "id" = 60`);
    db.run(`UPDATE "guild_scheduled_events" SET "image" = 'e2' WHERE "id" = 70`);

    const { deleted, sweep } = sweeper(db);
    await sweep();
    assert.deepEqual(
        deleted.sort(),
        [
            "/app-icons/40/ai1",
            "/app-icons/60/gi1",
            "/banners/10/gb1",
            "/channel-icons/100/ci1",
            "/discovery-splashes/10/d1",
            "/guild-events/70/e1",
            "/guild-space/10/banner/p1",
            "/guilds/10/users/1/avatars/ma1",
            "/icons/10/i1",
            "/role-icons/200/ri1.png",
            "/splashes/10/s1",
        ].sort(),
    );

    deleted.length = 0;
    db.run(`UPDATE "applications" SET "cover_image" = NULL WHERE "id" = 40`);
    db.run(`UPDATE "members" SET "banner" = NULL WHERE "id" = 1`);
    await sweep();
    assert.deepEqual(deleted, []);

    db.run(`DELETE FROM "guilds" WHERE "id" = 10`);
    await sweep();
    assert.deepEqual(
        deleted.sort(),
        [
            "/channel-icons/100/ci2",
            "/discovery-splashes/10/d2",
            "/guild-events/70/e2",
            "/guild-space/10/banner/p2",
            "/guilds/10/users/1/avatars/same",
            "/icons/10/i2",
            "/splashes/10/s2",
        ].sort(),
    );
});

test("hashes that aren't plain names are never turned into a delete", async () => {
    const db = await migratedDatabase();
    insert(db, "users", { id: "1", username: "a", discriminator: "0", avatar: "../../attachments/1/2/x" });
    db.run(`UPDATE "users" SET "avatar" = NULL WHERE "id" = 1`);
    assert.deepEqual(queued(db), ["avatars/1/../../attachments/1/2/x"]);
    const { deleted, sweep } = sweeper(db);
    await sweep();
    assert.deepEqual(deleted, []);
    assert.deepEqual(queued(db), []);
});

test("a failed delete stays queued for a later sweep", async () => {
    const db = await migratedDatabase();
    insert(db, "users", { id: "1", username: "a", discriminator: "0", banner: "b1" });
    db.run(`UPDATE "users" SET "banner" = NULL WHERE "id" = 1`);
    const { sweep } = sweeper(db, async () => {
        throw new Error("cdn down");
    });
    const error = console.error;
    console.error = () => {};
    try {
        await sweep();
    } finally {
        console.error = error;
    }
    assert.deepEqual(queued(db), ["banners/1/b1"]);
});

test("the postgres migration queues the same images as the sqlite one", () => {
    const postgres = fs.readFileSync(
        `src/database/migration/postgres/${fs.readdirSync("src/database/migration/postgres").find((file) => file.endsWith("-ImageFileCleanup.ts"))}`,
        "utf8",
    );
    const sqlite = fs.readFileSync(`${MIGRATIONS}/${fs.readdirSync(MIGRATIONS).find((file) => file.endsWith("-ImageFileCleanup.ts"))}`, "utf8");
    const tables = (source) => [...source.matchAll(/^\s+\["(\w+)", "([\w.]+)"/gm)].map((match) => `${match[1]}.${match[2].replace(".", "_")}`).sort();
    assert.deepEqual(tables(postgres), tables(sqlite));
});
