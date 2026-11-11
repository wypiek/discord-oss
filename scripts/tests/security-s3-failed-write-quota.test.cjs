const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const { Readable } = require("node:stream");
const { AsyncLocalStorage } = require("node:async_hooks");
const ts = require("typescript");
const { Database } = require("bun:sqlite");

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

async function fixture() {
    const native = new Database(":memory:");
    native.exec(`CREATE TABLE storage_runtime_objects (namespace varchar(128) NOT NULL, path varchar(2048) NOT NULL, principal varchar(128) NOT NULL,
        category varchar NOT NULL, budget_principal varchar(128) NOT NULL, bytes bigint NOT NULL DEFAULT 0, reserved_bytes bigint NOT NULL DEFAULT 0,
        pending boolean NOT NULL DEFAULT false, operation_generation varchar NOT NULL DEFAULT '', last_used_at bigint NOT NULL DEFAULT 0, PRIMARY KEY(namespace,path))`);
    native.exec(
        "CREATE TABLE storage_cache_evictions (namespace varchar(128) PRIMARY KEY, objects bigint NOT NULL DEFAULT 0, bytes bigint NOT NULL DEFAULT 0, last_evicted_at bigint)",
    );
    native.exec("CREATE TABLE users (id varchar PRIMARY KEY, bot boolean NOT NULL DEFAULT false)");
    native.exec("CREATE TABLE applications (id varchar PRIMARY KEY, owner_id varchar, bot_user_id varchar)");
    native.exec("INSERT INTO users(id,bot) VALUES ('1',false)");
    await new usageMigration.exports.StorageRuntimeUsage1793216604917().up({ query: async (sql) => native.exec(sql) });
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
    const limits = { instanceBytes: 100, principalBytes: 10, cacheBytes: 10, instanceObjects: 100, principalObjects: 10, cacheObjects: 10 };
    const module = { exports: {} };
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        Buffer,
        Date,
        setTimeout,
        clearTimeout,
        console,
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
                            return principal === "user:1";
                        }
                    },
                };
            return require(name);
        },
    });
    const objects = new Map();
    const remote = { failure: "", readFailure: false };
    const backend = {
        remoteGenerationConfirmation: true,
        async *inventory() {
            for (const [path, entry] of objects) yield { path, size: entry.data.length, generation: entry.generation };
        },
        async openRead(path) {
            if (remote.readFailure) throw new Error("bucket unreachable");
            const entry = objects.get(path);
            return entry ? { size: entry.data.length, generation: entry.generation, stream: Readable.from([entry.data]) } : null;
        },
        async set(path, data, _principal, generation) {
            if (remote.failure === "before") throw new Error("connection reset before the upload finished");
            objects.set(path, { data, generation });
            if (remote.failure === "after") throw new Error("success response lost");
        },
        async clone(path, destination, generation) {
            if (remote.failure === "before") throw new Error("copy failed");
            objects.set(destination, { data: Buffer.from(objects.get(path).data), generation });
        },
        async delete(path) {
            objects.delete(path);
        },
        async get(path) {
            return objects.get(path)?.data ?? null;
        },
        async exists(path) {
            return objects.has(path);
        },
        async isFile(path) {
            return objects.has(path);
        },
    };
    const storage = new module.exports.QuotaStorage(backend, "s3-fixture");
    const row = (path) => {
        const found = native.prepare("SELECT bytes,reserved_bytes,pending FROM storage_runtime_objects WHERE path=?").get(path);
        return found ? { ...found } : null;
    };
    const usage = () =>
        native
            .prepare("SELECT scope,key,bytes,objects FROM storage_runtime_usage WHERE objects<>0 OR bytes<>0 ORDER BY scope,key")
            .all()
            .map((entry) => ({ ...entry }));
    return { storage, remote, row, usage };
}

test("a failed S3 write that never reached the bucket gives its reservation back at once", async () => {
    const { storage, remote, row, usage } = await fixture();
    remote.failure = "before";
    await assert.rejects(storage.set("avatars/1/a", Buffer.alloc(8), "user:1"), /connection reset/);
    assert.equal(row("avatars/1/a"), null);
    assert.deepEqual(usage(), []);
    remote.failure = "";
    await storage.set("avatars/1/a", Buffer.alloc(8), "user:1");
    assert.deepEqual(row("avatars/1/a"), { bytes: 8, reserved_bytes: 0, pending: 0 });
});

test("a failed S3 write over an existing object keeps the old size and frees the reservation", async () => {
    const { storage, remote, row, usage } = await fixture();
    await storage.set("avatars/1/a", Buffer.alloc(3), "user:1");
    remote.failure = "before";
    await assert.rejects(storage.set("avatars/1/a", Buffer.alloc(7), "user:1"));
    assert.deepEqual(row("avatars/1/a"), { bytes: 3, reserved_bytes: 0, pending: 0 });
    assert.deepEqual(usage(), [
        { scope: "instance", key: "", bytes: 3, objects: 1 },
        { scope: "principal", key: "user:1", bytes: 3, objects: 1 },
    ]);
    remote.failure = "";
    await storage.set("avatars/1/b", Buffer.alloc(7), "user:1");
});

test("an S3 write whose success response was lost is counted at its real size", async () => {
    const { storage, remote, row } = await fixture();
    remote.failure = "after";
    await assert.rejects(storage.set("avatars/1/a", Buffer.alloc(4), "user:1"), /response lost/);
    assert.deepEqual(row("avatars/1/a"), { bytes: 4, reserved_bytes: 0, pending: 0 });
    remote.failure = "";
    await storage.set("avatars/1/a", Buffer.alloc(2), "user:1");
    assert.deepEqual(row("avatars/1/a"), { bytes: 2, reserved_bytes: 0, pending: 0 });
});

test("a failed S3 copy frees the reservation of its destination", async () => {
    const { storage, remote, row } = await fixture();
    await storage.set("source", Buffer.alloc(4), "user:1");
    remote.failure = "before";
    await assert.rejects(storage.clone("source", "copy"), /copy failed/);
    assert.equal(row("copy"), null);
});

test("when the bucket can't be read after a failed write the path waits for reconciliation", async () => {
    const { storage, remote, row } = await fixture();
    remote.failure = "before";
    remote.readFailure = true;
    await assert.rejects(storage.set("avatars/1/a", Buffer.alloc(4), "user:1"));
    assert.deepEqual(row("avatars/1/a"), { bytes: 0, reserved_bytes: 4, pending: 1 });
    remote.failure = "";
    remote.readFailure = false;
    await assert.rejects(storage.set("avatars/1/a", Buffer.alloc(4), "user:1"), (error) => error.code === 503);
});
