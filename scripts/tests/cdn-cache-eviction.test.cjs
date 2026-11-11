const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const { Readable } = require("node:stream");
const { AsyncLocalStorage } = require("node:async_hooks");
const ts = require("typescript");

const hour = 60 * 60 * 1000;
const source = ts.transpileModule(fs.readFileSync("src/cdn/util/RuntimeQuotaStorage.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

const usageMigration = { exports: {} };
vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/database/migration/sqlite/1793216604917-StorageRuntimeUsage.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { module: usageMigration, exports: usageMigration.exports },
);

async function fixture(overrides = {}) {
    const { Database } = require("bun:sqlite");
    const native = new Database(":memory:");
    native.exec(`CREATE TABLE storage_runtime_objects (namespace varchar(128) NOT NULL, path varchar(2048) NOT NULL, principal varchar(128) NOT NULL,
        category varchar NOT NULL, budget_principal varchar(128) NOT NULL, bytes bigint NOT NULL DEFAULT 0, reserved_bytes bigint NOT NULL DEFAULT 0,
        pending boolean NOT NULL DEFAULT false, operation_generation varchar NOT NULL DEFAULT '', last_used_at bigint NOT NULL DEFAULT 0, PRIMARY KEY(namespace,path))`);
    native.exec(
        "CREATE TABLE storage_cache_evictions (namespace varchar(128) PRIMARY KEY, objects bigint NOT NULL DEFAULT 0, bytes bigint NOT NULL DEFAULT 0, last_evicted_at bigint)",
    );
    native.exec("CREATE TABLE users (id varchar PRIMARY KEY, bot boolean NOT NULL DEFAULT false)");
    native.exec("CREATE TABLE applications (id varchar PRIMARY KEY, owner_id varchar, bot_user_id varchar)");
    native.exec("INSERT INTO users(id,bot) VALUES ('1',false),('2',true),('3',true)");
    native.exec("INSERT INTO applications(id,owner_id,bot_user_id) VALUES ('2','1','2'),('3',NULL,'3')");
    await new usageMigration.exports.StorageRuntimeUsage1793216604917().up({ query: async (sql) => native.exec(sql) });
    const log = [];
    let lock = Promise.resolve();
    const acquire = async () => {
        let unlock;
        const previous = lock;
        lock = new Promise((resolve) => {
            unlock = resolve;
        });
        await previous;
        return unlock;
    };
    const run = (sql, parameters = []) => {
        log.push(sql);
        const statement = native.prepare(sql.replace(/\$(\d+)/g, "?$1"));
        if (statement.columnNames.length) return statement.all(...parameters);
        statement.run(...parameters);
        return [];
    };
    const database = {
        async query(sql, parameters) {
            const unlock = await acquire();
            try {
                return run(sql, parameters);
            } finally {
                unlock();
            }
        },
        createQueryRunner() {
            let depth = 0;
            let unlock;
            return {
                async connect() {},
                async query(sql, parameters) {
                    if (depth) return run(sql, parameters);
                    return database.query(sql, parameters);
                },
                async startTransaction() {
                    if (!depth) {
                        unlock = await acquire();
                        native.exec("BEGIN");
                    } else native.exec(`SAVEPOINT s${depth}`);
                    depth++;
                },
                async commitTransaction() {
                    depth--;
                    if (depth) return native.exec(`RELEASE s${depth}`);
                    native.exec("COMMIT");
                    unlock();
                },
                async rollbackTransaction() {
                    depth--;
                    if (depth) return native.exec(`ROLLBACK TO s${depth}; RELEASE s${depth}`);
                    native.exec("ROLLBACK");
                    unlock();
                },
                async release() {
                    while (depth) await this.rollbackTransaction();
                },
            };
        },
    };
    class HTTPError extends Error {
        constructor(message, code) {
            super(message);
            this.code = code;
        }
    }
    const clock = { now: 1_000_000 };
    const limits = { instanceBytes: 1000, principalBytes: 1000, cacheBytes: 10, instanceObjects: 1000, principalObjects: 1000, cacheObjects: 1000, ...overrides };
    const module = { exports: {} };
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        Buffer,
        Date: { now: () => clock.now },
        setTimeout,
        clearTimeout,
        console: { ...console, warn() {} },
        require(name) {
            if (name === "@spacebar/database/Sql") return { isSqlite: () => true };
            if (name === "lambert-server/HTTPError") return { HTTPError };
            if (name === "../../database/Database") return { getDatabase: () => database };
            if (name === "../../util/util/Config") return { Config: { get: () => ({ cdn: { storageQuota: limits } }) } };
            if (name === "./storageOwnership") return { storageOwnership: new AsyncLocalStorage() };
            if (name === "./storageInventoryReferences")
                return {
                    StorageInventoryReferences: class {
                        async resolve() {
                            return { principal: "system:legacy-unattributed", category: "legacy-unattributed" };
                        }
                        async persistedPrincipal(principal) {
                            return ["user:1", "user:2", "user:3"].includes(principal);
                        }
                    },
                };
            return require(name);
        },
    });
    const objects = new Map();
    const backend = {
        async *inventory() {
            for (const [path, data] of objects) yield { path, size: data.length };
        },
        async openRead(path) {
            const data = objects.get(path);
            return data ? { size: data.length, stream: Readable.from([data]) } : null;
        },
        async set(path, data) {
            objects.set(path, data);
        },
        async clone(path, destination) {
            objects.set(destination, Buffer.from(objects.get(path)));
        },
        async delete(path) {
            await new Promise((resolve) => setImmediate(resolve));
            objects.delete(path);
        },
        async get(path) {
            return objects.get(path) ?? null;
        },
        async exists(path) {
            return objects.has(path);
        },
        async isFile(path) {
            return objects.has(path);
        },
    };
    const storage = new module.exports.QuotaStorage(backend, "fixture");
    const rows = () => native.prepare("SELECT path,category,bytes,last_used_at FROM storage_runtime_objects ORDER BY path").all();
    const evictions = () => native.prepare("SELECT objects,bytes FROM storage_cache_evictions").get();
    const cache = (path, bytes = 4) => storage.set(path, Buffer.alloc(bytes), "system:cache");
    const usage = () => native.prepare("SELECT scope,key,bytes,objects FROM storage_runtime_usage WHERE objects<>0 OR bytes<>0 ORDER BY scope,key").all();
    const recount = () =>
        native
            .prepare(
                `SELECT 'cache' AS scope,'' AS key,SUM(bytes+reserved_bytes) AS bytes,COUNT(*) AS objects FROM storage_runtime_objects WHERE category='cache' HAVING COUNT(*)>0
                UNION ALL SELECT 'instance','',SUM(bytes+reserved_bytes),COUNT(*) FROM storage_runtime_objects HAVING COUNT(*)>0
                UNION ALL SELECT 'principal',budget_principal,SUM(bytes+reserved_bytes),COUNT(*) FROM storage_runtime_objects GROUP BY budget_principal ORDER BY 1,2`,
            )
            .all();
    return { storage, objects, rows, evictions, cache, clock, log, limits, usage, recount, native };
}

test("a full cache evicts the least recently used object first", async () => {
    const { storage, objects, cache, clock, evictions } = await fixture();
    await cache("cache/a");
    clock.now += 1000;
    await cache("cache/b");
    clock.now += 1000;
    assert.ok(await storage.get("cache/a"));
    clock.now += 1000;
    await cache("cache/c");
    assert.deepEqual([...objects.keys()].sort(), ["cache/a", "cache/c"]);
    assert.deepEqual(evictions(), { objects: 1, bytes: 4 });
    clock.now += 1000;
    await cache("cache/d");
    assert.deepEqual([...objects.keys()].sort(), ["cache/c", "cache/d"]);
    assert.deepEqual(evictions(), { objects: 2, bytes: 8 });
});

test("the object limit evicts as well as the byte limit", async () => {
    const { objects, cache, clock, rows } = await fixture({ cacheBytes: 1000, cacheObjects: 2 });
    for (const name of ["a", "b", "c", "d"]) {
        await cache(`cache/${name}`, 1);
        clock.now += 1000;
    }
    assert.deepEqual([...objects.keys()].sort(), ["cache/c", "cache/d"]);
    assert.equal(rows().length, 2);
});

test("last use is written at most once per object per hour, in one batched statement", async () => {
    const { storage, cache, clock, log, rows } = await fixture({ cacheBytes: 1000 });
    await cache("cache/a");
    await cache("cache/b");
    const written = rows().find((row) => row.path === "cache/a").last_used_at;
    const touches = () => log.filter((sql) => sql.includes("SET last_used_at=")).length;
    clock.now += 1000;
    for (let index = 0; index < 20; index++) await Promise.all([storage.get("cache/a"), storage.get("cache/b")]);
    assert.equal(touches(), 0);
    await storage.flushTouches();
    assert.equal(touches(), 1);
    assert.equal(rows().find((row) => row.path === "cache/a").last_used_at, written + 1000);
    clock.now += hour / 2;
    await storage.get("cache/a");
    await storage.flushTouches();
    assert.equal(touches(), 1);
    clock.now += hour;
    await storage.get("cache/a");
    await storage.flushTouches();
    assert.equal(touches(), 2);
    assert.equal(rows().find((row) => row.path === "cache/a").last_used_at, clock.now);
});

test("uploads, avatars and other categories are never evicted", async () => {
    const { storage, objects, cache, clock, rows } = await fixture({ cacheBytes: 8, instanceBytes: 12 });
    await storage.set("attachments/1/old.png", Buffer.alloc(4), "user:1");
    clock.now += 1000;
    await cache("cache/a");
    clock.now += 1000;
    await cache("cache/b");
    clock.now += 1000;
    await cache("cache/c");
    assert.ok(objects.has("attachments/1/old.png"));
    assert.deepEqual([...objects.keys()].sort(), ["attachments/1/old.png", "cache/b", "cache/c"]);
    await assert.rejects(storage.set("avatars/1/new.png", Buffer.alloc(4), "user:1"), (error) => error.code === 413);
    assert.deepEqual([...objects.keys()].sort(), ["attachments/1/old.png", "cache/b", "cache/c"]);
    assert.deepEqual(
        rows().map((row) => row.category),
        ["upload", "cache", "cache"],
    );
});

test("a bot's uploads count against the account that owns its application", async () => {
    const { storage, objects, usage } = await fixture({ principalBytes: 10 });
    await storage.set("attachments/1/owner.png", Buffer.alloc(6), "user:1");
    await assert.rejects(storage.set("attachments/2/bot.png", Buffer.alloc(6), "user:2"), (error) => error.code === 413);
    await storage.set("attachments/2/bot.png", Buffer.alloc(4), "user:2");
    await storage.set("attachments/3/teamless.png", Buffer.alloc(8), "user:3");
    assert.deepEqual([...objects.keys()].sort(), ["attachments/1/owner.png", "attachments/2/bot.png", "attachments/3/teamless.png"]);
    assert.deepEqual(
        usage().filter((row) => row.scope === "principal"),
        [
            { scope: "principal", key: "user:1", bytes: 10, objects: 2 },
            { scope: "principal", key: "user:3", bytes: 8, objects: 1 },
        ],
    );
});

test("racing cache writes stay under the limit and keep rows and files in step", async () => {
    const { objects, cache, rows, evictions } = await fixture({ cacheBytes: 10, cacheObjects: 3 });
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => cache(`cache/${index}`, 3)));
    assert.equal(results.filter((result) => result.status === "rejected").length, 0);
    const live = rows();
    assert.ok(live.reduce((sum, row) => sum + row.bytes, 0) <= 10);
    assert.ok(live.length <= 3);
    assert.deepEqual([...objects.keys()].sort(), live.map((row) => row.path).sort());
    assert.equal(evictions().objects, 12 - live.length);
});

test("an object being streamed is not evicted", async () => {
    const { storage, objects, cache, clock } = await fixture();
    await cache("cache/a");
    clock.now += 1000;
    await cache("cache/b");
    clock.now += 1000;
    const read = await storage.openRead("cache/a");
    await cache("cache/c");
    assert.deepEqual([...objects.keys()].sort(), ["cache/a", "cache/c"]);
    clock.now += 1000;
    await assert.rejects(cache("cache/d", 8), (error) => error.code === 413);
    assert.deepEqual([...objects.keys()].sort(), ["cache/a", "cache/c"]);
    read.stream.resume();
    await new Promise((resolve) => read.stream.on("close", resolve));
    await storage.flushTouches();
    clock.now += 1000;
    await cache("cache/e");
    assert.deepEqual([...objects.keys()].sort(), ["cache/c", "cache/e"]);
});

test("an object larger than the whole cache evicts nothing and is refused", async () => {
    const { objects, cache, evictions } = await fixture();
    await cache("cache/a");
    await cache("cache/b");
    await assert.rejects(cache("cache/huge", 11), (error) => error.code === 413);
    assert.deepEqual([...objects.keys()].sort(), ["cache/a", "cache/b"]);
    assert.equal(evictions(), null);
});

test("quota checks read maintained usage rows that match a full recount after writes, evictions, moves and deletes", async () => {
    const { storage, cache, clock, log, usage, recount, native } = await fixture({ cacheBytes: 10, cacheObjects: 3 });
    for (let index = 0; index < 8; index++) {
        clock.now += 1000;
        await cache(`cache/${index}`, 3);
    }
    await storage.set("uploads/a", Buffer.alloc(5), "user:1");
    await storage.clone("uploads/a", "uploads/b");
    await storage.move("uploads/b", "uploads/c");
    await storage.delete("uploads/a");
    native.exec("UPDATE storage_runtime_objects SET last_used_at=last_used_at+1");
    assert.deepEqual(usage(), recount());
    assert.ok(usage().some((row) => row.scope === "principal" && row.key === "user:1" && row.objects === 1 && row.bytes === 5));
    assert.equal(
        log.some((sql) => /SUM\(bytes\+reserved_bytes\)/.test(sql)),
        false,
    );
});

test("the usage migration backfills existing rows and can run twice", async () => {
    const { Database } = require("bun:sqlite");
    const native = new Database(":memory:");
    native.exec(`CREATE TABLE storage_runtime_objects (namespace varchar(128) NOT NULL, path varchar(2048) NOT NULL, principal varchar(128) NOT NULL,
        category varchar NOT NULL, budget_principal varchar(128) NOT NULL, bytes bigint NOT NULL DEFAULT 0, reserved_bytes bigint NOT NULL DEFAULT 0,
        pending boolean NOT NULL DEFAULT false, operation_generation varchar NOT NULL DEFAULT '', last_used_at bigint NOT NULL DEFAULT 0, PRIMARY KEY(namespace,path))`);
    native.exec(`INSERT INTO storage_runtime_objects(namespace,path,principal,category,budget_principal,bytes,reserved_bytes) VALUES
        ('n','a','user:1','upload','user:1',5,0),('n','b','system:cache','cache','system:cache',7,2),('m','c','user:2','upload','user:2',1,0)`);
    const migration = new usageMigration.exports.StorageRuntimeUsage1793216604917();
    const runner = { query: async (sql) => native.exec(sql) };
    await migration.up(runner);
    await migration.up(runner);
    const rows = () => native.prepare("SELECT namespace,scope,key,bytes,objects FROM storage_runtime_usage ORDER BY namespace,scope,key").all();
    assert.deepEqual(rows(), [
        { namespace: "m", scope: "instance", key: "", bytes: 1, objects: 1 },
        { namespace: "m", scope: "principal", key: "user:2", bytes: 1, objects: 1 },
        { namespace: "n", scope: "cache", key: "", bytes: 9, objects: 1 },
        { namespace: "n", scope: "instance", key: "", bytes: 14, objects: 2 },
        { namespace: "n", scope: "principal", key: "system:cache", bytes: 9, objects: 1 },
        { namespace: "n", scope: "principal", key: "user:1", bytes: 5, objects: 1 },
    ]);
    native.exec("UPDATE storage_runtime_objects SET category='upload' WHERE path='b'");
    native.exec("DELETE FROM storage_runtime_objects WHERE path='a'");
    assert.deepEqual(
        rows().filter((row) => row.namespace === "n" && row.objects),
        [
            { namespace: "n", scope: "instance", key: "", bytes: 9, objects: 1 },
            { namespace: "n", scope: "principal", key: "system:cache", bytes: 9, objects: 1 },
        ],
    );
});
