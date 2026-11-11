const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { Pool } = require("pg");
class HTTPError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}
function load(filename, imports = {}) {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(filename, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            Buffer,
            require(name) {
                if (name === "lambert-server/HTTPError") return { HTTPError };
                return imports[name] || require(name);
            },
        },
    );
    return module.exports;
}
const { StorageQuotaLedger } = load("src/cdn/util/storageQuota.ts");
const { QuotaStorageCoordinator } = load("src/cdn/util/quotaStorage.ts", {
    "./storageQuota": { StorageQuotaLedger },
});
const limits = {
    instanceBytes: 100,
    principalBytes: 80,
    cacheBytes: 20,
    instanceObjects: 8,
    principalObjects: 4,
    cacheObjects: 2,
};
test("quota configuration rejects unlimited, unsafe and incomplete values", () => {
    for (const value of [0, -1, Infinity, 9007199254740992])
        assert.throws(
            () => new StorageQuotaLedger({}, { ...limits, instanceBytes: value }),
            (error) => error.code === 503,
        );
    assert.throws(
        () => new StorageQuotaLedger({}, {}),
        (error) => error.code === 503,
    );
});
test("persistent quota ledger uses real atomic PostgreSQL transactions", { skip: !process.env.STORAGE_QUOTA_TEST_DATABASE, timeout: 60000 }, async (t) => {
    const url = new URL(process.env.STORAGE_QUOTA_TEST_DATABASE);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    assert.equal(url.pathname, "/fosscord_codex_admin");
    const schema = `storage_quota_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: url.toString(), max: 1 });
    let pool;
    try {
        await admin.query(`CREATE SCHEMA "${schema}"`);
        pool = new Pool({
            connectionString: url.toString(),
            max: 12,
            options: `-c search_path=${schema}`,
        });
        const query = async (sql, values) => (await pool.query(sql, values)).rows;
        const database = {
            async transaction(callback) {
                const client = await pool.connect();
                try {
                    await client.query("BEGIN");
                    const result = await callback({
                        query: async (sql, values) => (await client.query(sql, values)).rows,
                    });
                    await client.query("COMMIT");
                    return result;
                } catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                } finally {
                    client.release();
                }
            },
        };
        const { StorageQuotaLedger1791099000000 } = load("src/database/migration/postgres/1791099000000-StorageQuotaLedger.ts");
        await new StorageQuotaLedger1791099000000().up({ query });
        const fresh = async (custom = limits) => {
            const namespace = randomUUID();
            await query(
                "INSERT INTO storage_quota_accounts(namespace,key,state) VALUES($1,'instance','ready'),($1,'principal:user:a','ready'),($1,'principal:user:b','ready'),($1,'cache','ready')",
                [namespace],
            );
            const ledger = new StorageQuotaLedger(database, custom);
            const request = (id, bytes, path = id, principal = "user:a", category = "upload") => ({
                namespace,
                id,
                path,
                principal,
                category,
                upperBytes: BigInt(bytes),
            });
            const account = async (key = "instance") => (await query("SELECT * FROM storage_quota_accounts WHERE namespace=$1 AND key=$2", [namespace, key]))[0];
            return { namespace, ledger, request, account };
        };
        await t.test("concurrent accounts cannot exceed shared instance bytes", async () => {
            const f = await fresh();
            const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => f.ledger.reserve(f.request(String(i), 30, String(i), i % 2 ? "user:a" : "user:b"))));
            assert.equal(results.filter((r) => r.status === "fulfilled").length, 3);
            for (const r of results.filter((r) => r.status === "rejected")) assert.equal(r.reason.code, 413);
            const a = await f.account();
            assert.equal(a.reserved_bytes, "90");
            assert.equal(a.reserved_objects, "3");
        });
        await t.test("database failure rolls back counters and reservation intent together", async () => {
            const f = await fresh();
            const failing = new StorageQuotaLedger(
                {
                    transaction: (callback) =>
                        database.transaction((transaction) =>
                            callback({
                                query: async (sql, values) => {
                                    const result = await transaction.query(sql, values);
                                    if (sql.includes("reserved_bytes=reserved_bytes")) throw Error("injected transaction failure");
                                    return result;
                                },
                            }),
                        ),
                },
                limits,
            );
            await assert.rejects(failing.reserve(f.request("failed", 30)), /injected/);
            assert.equal((await f.account()).reserved_bytes, "0");
            assert.equal((await query("SELECT * FROM storage_quota_operations WHERE namespace=$1", [f.namespace])).length, 0);
            assert.equal((await query("SELECT * FROM storage_quota_objects WHERE namespace=$1", [f.namespace])).length, 0);
        });
        await t.test("committed physical write with failed finalization remains reserved for recovery", async () => {
            const f = await fresh();
            const databaseFailure = new StorageQuotaLedger(
                {
                    transaction: (callback) =>
                        database.transaction((transaction) =>
                            callback({
                                query: async (sql, values) => {
                                    if (sql.includes("SET bytes=$3")) throw Error("injected finalization failure");
                                    return transaction.query(sql, values);
                                },
                            }),
                        ),
                },
                limits,
            );
            const coordinator = new QuotaStorageCoordinator(databaseFailure, {
                write: async (req) => ({ bytes: 20n, generation: req.id }),
                unchanged: async () => false,
            });
            await assert.rejects(coordinator.write(f.request("written", 30), Buffer.alloc(20)), /injected/);
            assert.equal((await f.account()).used_bytes, "0");
            assert.equal((await f.account()).reserved_bytes, "30");
            await f.ledger.finalize(f.namespace, "written", 20n);
            assert.equal((await f.account()).used_bytes, "20");
            assert.equal((await f.account()).reserved_bytes, "0");
        });
        await t.test("principal and cache budgets apply independently", async () => {
            const f = await fresh();
            await f.ledger.reserve(f.request("a", 70));
            await assert.rejects(f.ledger.reserve(f.request("b", 11)), (error) => error.code === 413);
            await f.ledger.reserve(f.request("cache", 15, "cache", "user:b", "cache"));
            await assert.rejects(f.ledger.reserve(f.request("cache2", 6, "cache2", "user:b", "cache")), (error) => error.code === 413);
            assert.equal((await f.account("cache")).reserved_bytes, "15");
        });
        await t.test("zero bytes still consume bounded object count", async () => {
            const f = await fresh();
            for (let i = 0; i < 4; i++) await f.ledger.reserve(f.request(String(i), 0));
            await assert.rejects(f.ledger.reserve(f.request("extra", 0)), (error) => error.code === 413);
            assert.equal((await f.account()).reserved_bytes, "0");
        });
        await t.test("operation replay is idempotent and altered identity conflicts", async () => {
            const f = await fresh();
            const req = f.request("a", 50);
            const results = await Promise.all(Array.from({ length: 10 }, () => f.ledger.reserve(req)));
            assert.equal(results.filter((r) => r.created).length, 1);
            assert.equal((await f.account()).reserved_bytes, "50");
            await assert.rejects(f.ledger.reserve({ ...req, path: "other" }), (error) => error.code === 409);
            await f.ledger.finalize(f.namespace, "a", 35n);
            await f.ledger.finalize(f.namespace, "a", 35n);
            assert.equal((await f.account()).used_bytes, "35");
            assert.equal((await f.account()).reserved_bytes, "0");
            await assert.rejects(f.ledger.finalize(f.namespace, "a", 36n), (error) => error.code === 409);
        });
        await t.test("replacement reserves peak and stored-size finalization measures output", async () => {
            const f = await fresh();
            await f.ledger.reserve(f.request("old", 45, "file"));
            await f.ledger.finalize(f.namespace, "old", 40n);
            await assert.rejects(f.ledger.reserve(f.request("too-large", 41, "file")), (error) => error.code === 413);
            await f.ledger.reserve(f.request("new", 30, "file"));
            assert.equal((await f.account()).reserved_bytes, "30");
            await f.ledger.finalize(f.namespace, "new", 25n);
            assert.equal((await f.account()).used_bytes, "25");
            assert.equal((await f.account()).used_objects, "1");
        });
        await t.test("stored result beyond bound retains full reservation", async () => {
            const f = await fresh();
            await f.ledger.reserve(f.request("a", 10));
            await assert.rejects(f.ledger.finalize(f.namespace, "a", 11n), (error) => error.code === 503);
            assert.equal((await f.account()).reserved_bytes, "10");
        });
        await t.test("rollback requires unchanged proof and restores old charge", async () => {
            const f = await fresh();
            await f.ledger.reserve(f.request("old", 20, "file"));
            await f.ledger.finalize(f.namespace, "old", 20n);
            await f.ledger.reserve(f.request("new", 30, "file"));
            await f.ledger.cancelUnchanged(f.namespace, "new");
            await f.ledger.cancelUnchanged(f.namespace, "new");
            assert.equal((await f.account()).used_bytes, "20");
            assert.equal((await f.account()).reserved_bytes, "0");
            const [object] = await query("SELECT * FROM storage_quota_objects WHERE namespace=$1", [f.namespace]);
            assert.equal(object.generation, "old");
        });
        await t.test("unknown ownership and incomplete inventory stay gated", async () => {
            const f = await fresh();
            await query("UPDATE storage_quota_accounts SET state='inventory-required' WHERE namespace=$1 AND key='instance'", [f.namespace]);
            await assert.rejects(f.ledger.reserve(f.request("a", 1)), (error) => error.code === 503);
            await query("UPDATE storage_quota_accounts SET state='ready' WHERE namespace=$1", [f.namespace]);
            await query(
                "INSERT INTO storage_quota_objects(namespace,path,principal,category,bytes,generation,state) VALUES($1,'legacy','system:legacy','legacy-unattributed',50,'legacy','live')",
                [f.namespace],
            );
            await assert.rejects(f.ledger.reserve(f.request("attacker", 1, "legacy")), (error) => error.code === 409);
            assert.equal((await f.account()).reserved_bytes, "0");
        });
        await t.test("write failure and uncertain cleanup keep conservative charges", async () => {
            const f = await fresh();
            const adapter = {
                write: async () => {
                    throw Error("uncertain storage failure");
                },
                unchanged: async () => false,
            };
            const coordinator = new QuotaStorageCoordinator(f.ledger, adapter);
            await assert.rejects(coordinator.write(f.request("uncertain", 25), Buffer.alloc(25)), /uncertain/);
            assert.equal((await f.account()).reserved_bytes, "25");
            await assert.rejects(coordinator.write(f.request("uncertain", 25), Buffer.alloc(25)), (error) => error.code === 409);
            adapter.unchanged = async () => true;
            await assert.rejects(coordinator.write(f.request("unchanged", 10), Buffer.alloc(10)), /uncertain/);
            assert.equal((await f.account()).reserved_bytes, "25");
        });
        await t.test("confirmed clone is separately charged and rejected writes never touch storage", async () => {
            const f = await fresh();
            let writes = 0;
            const adapter = {
                write: async (req) => {
                    writes++;
                    return { bytes: 30n, generation: req.id };
                },
                clone: async (req) => ({ bytes: 30n, generation: req.id }),
                unchanged: async () => false,
            };
            const coordinator = new QuotaStorageCoordinator(f.ledger, adapter);
            await coordinator.write(f.request("source", 30), Buffer.alloc(30));
            await coordinator.clone(f.request("clone", 30), { path: "source", generation: "source" });
            assert.equal((await f.account()).used_bytes, "60");
            await assert.rejects(coordinator.write(f.request("oversubscribed", 30), Buffer.alloc(30)), (error) => error.code === 413);
            assert.equal(writes, 1);
            await coordinator.write(f.request("source", 30), Buffer.alloc(30));
            assert.equal(writes, 1);
        });
        await t.test("delete failure keeps bytes charged, retry releases once without locks during I/O", async () => {
            const f = await fresh();
            await f.ledger.reserve(f.request("a", 40));
            await f.ledger.finalize(f.namespace, "a", 40n);
            await assert.rejects(
                f.ledger.deleteConfirmed(f.namespace, "a", "a", async () => {
                    throw Error("delete failed");
                }),
                /delete failed/,
            );
            assert.equal((await f.account()).used_bytes, "40");
            await assert.rejects(f.ledger.reserve(f.request("replacement", 1, "a")), (error) => error.code === 409);
            await f.ledger.deleteConfirmed(f.namespace, "a", "a", async () => {
                await f.ledger.reserve(f.request("other", 1));
            });
            assert.equal((await f.account()).used_bytes, "0");
            assert.equal((await f.account()).used_objects, "0");
            let removals = 0;
            await f.ledger.deleteConfirmed(f.namespace, "a", "a", async () => {
                removals++;
            });
            assert.equal(removals, 0);
        });
        await t.test("wrong generation cannot delete or free another writer", async () => {
            const f = await fresh();
            await f.ledger.reserve(f.request("a", 40));
            await f.ledger.finalize(f.namespace, "a", 40n);
            let called = false;
            await assert.rejects(
                f.ledger.deleteConfirmed(f.namespace, "a", "wrong", async () => {
                    called = true;
                }),
                (error) => error.code === 409,
            );
            assert.equal(called, false);
            assert.equal((await f.account()).used_bytes, "40");
        });
        await t.test("lowering limits blocks growth but confirmed deletion remains possible", async () => {
            const f = await fresh();
            await f.ledger.reserve(f.request("a", 50));
            await f.ledger.finalize(f.namespace, "a", 50n);
            const lowered = new StorageQuotaLedger(database, {
                ...limits,
                instanceBytes: 10,
                principalBytes: 10,
            });
            await assert.rejects(lowered.reserve(f.request("b", 1)), (error) => error.code === 413);
            await lowered.deleteConfirmed(f.namespace, "a", "a", async () => {});
            assert.equal((await f.account()).used_bytes, "0");
        });
    } finally {
        if (pool) await pool.end();
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
    }
});
