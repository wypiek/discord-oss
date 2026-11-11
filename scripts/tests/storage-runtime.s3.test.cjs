const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const { AsyncLocalStorage } = require("node:async_hooks");
const ts = require("typescript");
const databaseName = process.env.STORAGE_RUNTIME_S3_TEST_DATABASE;
const endpoint = process.env.STORAGE_RUNTIME_S3_TEST_ENDPOINT;

function load(filename, mocks) {
    const fixture = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(filename, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module: fixture,
            exports: fixture.exports,
            Buffer,
            AbortSignal,
            setTimeout,
            clearTimeout,
            console,
            require(name) {
                return Object.hasOwn(mocks, name) ? mocks[name] : require(name);
            },
        },
    );
    return fixture.exports;
}

test("real S3 storage enforces quotas and confirms generations through restart", { skip: !databaseName || !endpoint }, async (t) => {
    assert.match(databaseName, /^fosscord_storage_runtime_s3_test_[a-z0-9_]+$/);
    assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(process.env.AWS_ACCESS_KEY_ID, "synthetic-storage-test");
    assert.equal(process.env.AWS_SECRET_ACCESS_KEY, "synthetic-storage-test-password");
    const sdk = require(process.env.STORAGE_RUNTIME_S3_TEST_SDK || "@aws-sdk/client-s3");
    const bucket = "fosscord-storage-runtime-fixture";
    const prefix = "quota-fixture/";
    const client = new sdk.S3({ region: "us-east-1", endpoint, forcePathStyle: true });
    const { Pool } = require("pg");
    const pool = new Pool({ database: databaseName, host: "/tmp" });
    t.after(async () => {
        const objects = await client.listObjectsV2({ Bucket: bucket }).catch(() => ({ Contents: [] }));
        for (const object of objects.Contents ?? []) await client.deleteObject({ Bucket: bucket, Key: object.Key });
        await client.deleteBucket({ Bucket: bucket }).catch(() => {});
        client.destroy();
        await pool.end();
    });
    await client.createBucket({ Bucket: bucket });
    const database = {
        createQueryRunner() {
            let connection;
            return {
                async connect() {
                    connection = await pool.connect();
                },
                async query(sql, parameters) {
                    return (await connection.query(sql, parameters)).rows;
                },
                async release() {
                    connection.release();
                },
                async startTransaction() {
                    await connection.query("BEGIN");
                },
                async commitTransaction() {
                    await connection.query("COMMIT");
                },
                async rollbackTransaction() {
                    await connection.query("ROLLBACK");
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
    const { StorageRuntime1791809004004 } = load("src/database/migration/postgres/1791809004004-StorageRuntime.ts", {});
    const migrationRunner = { query: async (sql, parameters) => (await pool.query(sql, parameters)).rows };
    await new StorageRuntime1791809004004().up(migrationRunner);
    await new StorageRuntime1791809004004().up(migrationRunner);
    const { StorageCacheEviction1792871538294 } = load("src/database/migration/postgres/1792871538294-StorageCacheEviction.ts", {});
    await new StorageCacheEviction1792871538294().up(migrationRunner);
    const { StorageRuntimeUsage1793216604917 } = load("src/database/migration/postgres/1793216604917-StorageRuntimeUsage.ts", {});
    await new StorageRuntimeUsage1793216604917().up({ isTransactionActive: false, query: migrationRunner.query });
    await pool.query("CREATE TABLE users(id varchar PRIMARY KEY,bot boolean NOT NULL DEFAULT false)");
    await pool.query("INSERT INTO users VALUES('1',false),('2',false)");
    await pool.query("CREATE TABLE applications(id varchar PRIMARY KEY,owner_id varchar,bot_user_id varchar)");
    const { StorageInventoryReferences } = load("src/cdn/util/storageInventoryReferences.ts", { "lambert-server/HTTPError": { HTTPError } });
    const ownership = new AsyncLocalStorage();
    const limits = { instanceBytes: 12, principalBytes: 8, cacheBytes: 4, instanceObjects: 5, principalObjects: 4, cacheObjects: 2 };
    const { QuotaStorage } = load("src/cdn/util/RuntimeQuotaStorage.ts", {
        "lambert-server/HTTPError": { HTTPError },
        "../../database/Database": { getDatabase: () => database },
        "../../util/util/Config": { Config: { get: () => ({ cdn: { storageQuota: limits } }) } },
        "./storageOwnership": { storageOwnership: ownership },
        "./storageInventoryReferences": { StorageInventoryReferences },
    });
    const { S3Storage } = load("src/cdn/util/S3Storage.ts", { "@aws-sdk/client-s3": sdk });
    const backend = new S3Storage("us-east-1", bucket, endpoint, true, prefix);
    const storage = new QuotaStorage(backend, "real-s3-fixture");
    await storage.initialize();
    await storage.set("original", Buffer.from("data"), "user:1");
    const head = await client.headObject({ Bucket: bucket, Key: `${prefix}original` });
    assert.match(head.Metadata.generation, /^[a-f0-9-]{36}$/);
    await storage.clone("original", "copy");
    assert.equal((await storage.get("copy")).toString(), "data");
    const copyHead = await client.headObject({ Bucket: bucket, Key: `${prefix}copy` });
    assert.notEqual(copyHead.Metadata.generation, head.Metadata.generation);
    await assert.rejects(storage.clone("original", "denied"), (error) => error.code === 413);
    assert.equal(await backend.exists("denied"), false);
    await storage.delete("copy");
    await storage.move("original", "moved");
    assert.equal(await backend.exists("original"), false);
    assert.equal((await storage.get("moved")).toString(), "data");
    await storage.set("moved", Buffer.from("ab"), "user:1");
    assert.equal((await pool.query("SELECT bytes,reserved_bytes,pending FROM storage_runtime_objects WHERE path='moved'")).rows[0].bytes, "2");
    await storage.set("second-user", Buffer.alloc(8), "user:2");
    await assert.rejects(storage.set("instance-denied", Buffer.alloc(3), "user:1"), (error) => error.code === 413);
    await storage.delete("second-user");
    await ownership.run("system:cache", () => storage.set("cache", Buffer.alloc(4)));
    await ownership.run("system:cache", () => storage.set("cache-evicts", Buffer.alloc(1)));
    assert.equal(await backend.exists("cache"), false);
    await storage.delete("cache-evicts");
    const originalSet = backend.set.bind(backend);
    backend.set = async (...args) => {
        await originalSet(...args);
        throw new Error("synthetic lost S3 success response");
    };
    await assert.rejects(storage.set("lost-response", Buffer.from("abc"), "user:1"));
    assert.equal((await pool.query("SELECT pending FROM storage_runtime_objects WHERE path='lost-response'")).rows[0].pending, false);
    backend.set = originalSet;
    const restarted = new QuotaStorage(backend, "real-s3-fixture");
    await restarted.initialize();
    const recovered = (await pool.query("SELECT bytes,reserved_bytes,pending FROM storage_runtime_objects WHERE path='lost-response'")).rows[0];
    assert.equal(recovered.bytes, "3");
    assert.equal(recovered.reserved_bytes, "0");
    assert.equal(recovered.pending, false);
    await restarted.delete("lost-response");
    await restarted.delete("moved");
    const inventory = [];
    for await (const object of backend.inventory()) inventory.push(object);
    assert.deepEqual(inventory, []);
    assert.equal((await pool.query("SELECT COUNT(*)::text AS count FROM storage_runtime_objects")).rows[0].count, "0");
    backend.client.destroy();
});
