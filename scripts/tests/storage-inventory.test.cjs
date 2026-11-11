const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"),
    fsp = require("node:fs/promises"),
    path = require("node:path"),
    os = require("node:os"),
    vm = require("node:vm");
const { randomUUID, createHash } = require("node:crypto");
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
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
            },
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
const references = load("src/cdn/util/storageInventoryReferences.ts");
const { LocalStorageInventory } = load("src/cdn/util/localStorageInventory.ts", {
    "./storageInventoryReferences": references,
});
const { FileQuotaStorageAdapter } = load("src/cdn/util/FileQuotaStorageAdapter.ts");
const { StorageQuotaLedger } = load("src/cdn/util/storageQuota.ts");
const { StorageInventory1791806000843 } = load("src/database/migration/postgres/1791806000843-StorageInventory.ts");
const defaults = {
    batchSize: 7,
    maxEntries: 10000,
    maxMetadataFiles: 10000,
    maxMetadataBytes: 1024 * 1024,
};
const complete = async (inventory) => {
    let status;
    for (let i = 0; i < 10000; i++) {
        status = await inventory.step();
        if (status.state === "inventory-complete") return status;
    }
    throw Error("Fixture inventory exceeded bounded test steps");
};
test("inventory rejects invalid or unlimited scan policies", () => {
    for (const field of Object.keys(defaults)) {
        for (const value of [undefined, NaN, 0, -1, Infinity])
            assert.throws(
                () => new LocalStorageInventory({}, "unused", "fixture", { token: "barrier" }, { ...defaults, [field]: value }),
                (error) => error.code === 503,
            );
        const missing = { ...defaults };
        delete missing[field];
        assert.throws(
            () => new LocalStorageInventory({}, "unused", "fixture", { token: "barrier" }, missing),
            (error) => error.code === 503,
        );
    }
    for (const policy of [null, undefined, { ...defaults, unexpected: 1 }])
        assert.throws(
            () => new LocalStorageInventory({}, "unused", "fixture", { token: "barrier" }, policy),
            (error) => error.code === 503,
        );
});
test("local legacy inventory preserves payloads and uses actual PostgreSQL entity schema", { skip: !process.env.STORAGE_INVENTORY_TEST_DATABASE, timeout: 120000 }, async (t) => {
    const url = new URL(process.env.STORAGE_INVENTORY_TEST_DATABASE);
    assert.equal(url.pathname, `/${process.env.STORAGE_INVENTORY_TEST_DATABASE_NAME || "fosscord_codex_admin"}`);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
    process.env.DATABASE = url.toString();
    const schema = `storage_inventory_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: url.toString(), max: 1 });
    let ds;
    const fixtures = [];
    try {
        await admin.query(`CREATE SCHEMA "${schema}"`);
        require("reflect-metadata");
        const { DataSource } = require("typeorm");
        ds = new DataSource({
            type: "postgres",
            url: url.toString(),
            entities: [path.resolve("dist/database/entities/*.js")],
            synchronize: true,
            logging: false,
            extra: { options: `-c search_path=${schema}` },
        });
        try {
            await ds.initialize();
        } catch (error) {
            throw new Error(`Isolated entity schema initialization failed: ${error.name} ${error.code ?? ""} ${error.message.split("\n")[0].slice(0, 180)}`);
        }
        await new StorageInventory1791806000843().up({ query: (sql) => ds.query(sql) });
        await new StorageInventory1791806000843().up({ query: (sql) => ds.query(sql) });
        const entities = require("../../dist/database/entities");
        const userRepository = ds.getRepository(entities.User);
        await userRepository.save(
            ["100", "101"].map((id) =>
                userRepository.create({
                    id,
                    username: "Inventory Fixture",
                    discriminator: "1234",
                    premium: false,
                    premium_type: 0,
                    created_at: new Date(),
                    verified: true,
                    rights: "0",
                    data: { valid_tokens_since: new Date() },
                }),
            ),
        );
        const query = (sql, p) => ds.query(sql, p);
        const oldHash = "a".repeat(32),
            bannerHash = "b".repeat(32),
            appHash = "c".repeat(32);
        await query("UPDATE users SET avatar=$2,banner=$3 WHERE id=$1", ["100", oldHash, bannerHash]);
        await ds.getRepository(entities.Application).save(
            ds.getRepository(entities.Application).create({
                id: "200",
                name: "Inventory app",
                owner_id: "100",
                verify_key: "fixture",
                icon: appHash,
                cover_image: "d".repeat(32),
            }),
        );
        await ds.getRepository(entities.Webhook).save(ds.getRepository(entities.Webhook).create({ id: "300", type: 1, user_id: "100", avatar: "e".repeat(32) }));
        await query(
            "INSERT INTO messages(id,channel_id,author_id,timestamp,embeds,reactions,type) VALUES('400','10','100',CURRENT_TIMESTAMP,'[]','[]',0),('401','10','101',CURRENT_TIMESTAMP,'[]','[]',0),('402','10','100',CURRENT_TIMESTAMP,'[]','[]',0)",
        );
        await query("UPDATE messages SET webhook_id='300' WHERE id='402'");
        await query(
            "INSERT INTO attachments(id,filename,size,message_id,channel_id) VALUES('500','posted.bin',3,'400',NULL),('501','hook.bin',4,'402',NULL),('502','ambiguous.bin',5,'400',NULL),('503','ambiguous.bin',5,'401',NULL)",
        );
        const cloud = ds.getRepository(entities.CloudAttachment);
        await cloud.save(
            cloud.create({
                id: "600",
                userId: "100",
                channelId: null,
                uploadFilename: "10/CLOUD_fixture/0/staged.bin",
                userAttachmentId: "0",
                userFilename: "staged.bin",
                userFileSize: 6,
            }),
        );
        await ds.getRepository(entities.Channel).save(ds.getRepository(entities.Channel).create({ id: "10", created_at: new Date(), type: 1 }));
        await query("UPDATE cloud_attachments SET channel_id='10' WHERE id='600'");
        const resolver = new references.StorageInventoryReferences({ query });
        await t.test("exact stored locators bind ownership and tuple mismatches remain unattributed", async () => {
            assert.deepEqual({ ...(await resolver.resolve("attachments/10/CLOUD_fixture/0/staged.bin")) }, { principal: "user:100", category: "upload" });
            await query("UPDATE cloud_attachments SET user_filename='wrong.bin' WHERE id='600'");
            assert.equal((await resolver.resolve("attachments/10/CLOUD_fixture/0/staged.bin")).principal, "system:legacy-unattributed");
            await query("UPDATE cloud_attachments SET user_filename='staged.bin' WHERE id='600'");
            assert.equal((await resolver.resolve("attachments/10/500/posted.bin")).principal, "user:100");
            assert.equal((await resolver.resolve("attachments/10/400/posted.bin")).principal, "user:100");
            assert.equal((await resolver.resolve("attachments/10/501/hook.bin")).principal, "webhook:300");
            assert.equal((await resolver.resolve(`avatars/100/${oldHash}`)).principal, "user:100");
            assert.equal((await resolver.resolve(`avatars/100/${oldHash}.png`)).principal, "system:legacy-unattributed");
            assert.equal((await resolver.resolve(`banners/100/${bannerHash}`)).principal, "user:100");
            assert.equal((await resolver.resolve(`app-icons/200/${appHash}`)).principal, "application:200");
            assert.equal((await resolver.resolve(`app-icons/200/${"d".repeat(32)}`)).principal, "application:200");
            assert.equal((await resolver.resolve("app-icons/999/upstream.png")).principal, "system:legacy-unattributed");
        });
        const fixture = async (options = {}) => {
            const root = await fsp.mkdtemp(path.join(os.tmpdir(), "fosscord-inventory-"));
            fixtures.push(root);
            const namespace = randomUUID();
            const adapter = new FileQuotaStorageAdapter(root, namespace);
            await adapter.unchanged({
                namespace,
                id: "initialize",
                path: "unused.bin",
                upperBytes: 1n,
            });
            const barrier = { token: randomUUID(), assertQuiescent: async () => {} };
            const inventory = new LocalStorageInventory(ds, root, namespace, barrier, {
                ...defaults,
                ...options,
            });
            t.after(() => inventory.close());
            const write = async (filename, data) => {
                await fsp.mkdir(path.dirname(path.join(root, filename)), { recursive: true });
                await fsp.writeFile(path.join(root, filename), data);
            };
            const totals = async () => query("SELECT * FROM storage_quota_accounts WHERE namespace=$1 ORDER BY key", [namespace]);
            return { root, namespace, barrier, inventory, write, totals };
        };
        await t.test("wide paginated scan, unknown files, mirror/local distinction and metadata all remain charged", async () => {
            const f = await fixture();
            const payloads = [
                ["attachments/10/CLOUD_fixture/0/staged.bin", "staged"],
                ["attachments/10/500/posted.bin", "abc"],
                ["attachments/10/501/hook.bin", "hook"],
                [`avatars/100/${oldHash}`, "avatar"],
                ["avatars/100/historical", "old"],
                ["collectibles-shop/local/static", "local"],
                ["collectibles-shop-upstream/remote/static", "cache"],
                ["orphan.tmp", "orphan"],
            ];
            for (let i = 0; i < 55; i++) payloads.push([`wide/file-${i}.bin`, "x"]);
            for (const [filename, data] of payloads) await f.write(filename, data);
            const before = new Map(
                await Promise.all(
                    payloads.map(async ([filename]) => [
                        filename,
                        createHash("sha256")
                            .update(await fsp.readFile(path.join(f.root, filename)))
                            .digest("hex"),
                    ]),
                ),
            );
            await f.inventory.start();
            await assert.rejects(f.inventory.provision("user:100"), (error) => error.code === 503);
            await f.inventory.start();
            let status = await f.inventory.step();
            assert.ok(Number(status.objects) <= defaults.batchSize);
            await f.inventory.close();
            const resumed = new LocalStorageInventory(ds, f.root, f.namespace, f.barrier, defaults);
            await resumed.start();
            status = await complete(resumed);
            await resumed.close();
            assert.equal(status.state, "inventory-complete");
            assert.ok(BigInt(status.metadataBytes) > 0n);
            assert.ok(Number(status.metadataObjects) >= payloads.length + 1);
            const accounts = await f.totals(),
                instance = accounts.find((row) => row.key === "instance");
            let diskBytes = 0n,
                diskFiles = 0;
            async function walk(folder) {
                const dir = await fsp.opendir(folder);
                for await (const entry of dir) {
                    const target = path.join(folder, entry.name);
                    if (entry.isDirectory()) await walk(target);
                    else {
                        diskBytes += BigInt((await fsp.stat(target)).size);
                        diskFiles++;
                    }
                }
            }
            await walk(f.root);
            assert.equal(instance.used_bytes, diskBytes.toString());
            assert.equal(instance.used_objects, String(diskFiles));
            assert.ok(accounts.every((row) => row.state === "inventory-complete"));
            assert.ok(BigInt(accounts.find((row) => row.key === "principal:system:legacy-unattributed").used_bytes) > 0n);
            assert.equal(accounts.find((row) => row.key === "cache").used_bytes, "5");
            assert.equal(accounts.find((row) => row.key === "principal:system:managed").used_bytes, "5");
            for (const [filename] of payloads)
                assert.equal(
                    createHash("sha256")
                        .update(await fsp.readFile(path.join(f.root, filename)))
                        .digest("hex"),
                    before.get(filename),
                );
            const beforeUsed = instance.used_bytes;
            await resumed.start();
            assert.equal((await f.totals()).find((row) => row.key === "instance").used_bytes, beforeUsed);
            await resumed.provision("user:101");
            await resumed.provision("user:100");
            await assert.rejects(resumed.provision("user:999999"), (error) => error.code === 503);
            assert.equal((await f.totals()).find((row) => row.key === "instance").used_bytes, beforeUsed);
            const ledger = new StorageQuotaLedger(ds, {
                instanceBytes: 1000000,
                principalBytes: 1000000,
                cacheBytes: 1000000,
                instanceObjects: 10000,
                principalObjects: 10000,
                cacheObjects: 10000,
            });
            await assert.rejects(
                ledger.reserve({
                    namespace: f.namespace,
                    id: "blocked",
                    path: "new.bin",
                    principal: "user:100",
                    category: "upload",
                    upperBytes: 1n,
                }),
                (error) => error.code === 503,
            );
            const serialized = JSON.stringify(status);
            assert.ok(!serialized.includes(f.root));
            assert.ok(!serialized.includes("staged.bin"));
            assert.ok(!serialized.includes(oldHash));
        });
        await t.test("existing trusted manifests preserve generation and metadata tampering blocks completion", async () => {
            const f = await fixture();
            await f.write("managed.bin", "prior");
            const stat = await fsp.stat(path.join(f.root, "managed.bin"), { bigint: true });
            const manifest = path.join(f.root, ".storage-quota/objects", createHash("sha256").update("managed.bin").digest("hex"));
            await fsp.writeFile(
                manifest,
                JSON.stringify({
                    generation: "prior-generation",
                    fingerprint: {
                        dev: stat.dev.toString(),
                        ino: stat.ino.toString(),
                        bytes: stat.size.toString(),
                        sha256: createHash("sha256").update("prior").digest("hex"),
                    },
                }),
            );
            await f.inventory.start();
            let status;
            do {
                status = await f.inventory.step();
            } while (status.phase !== "metadata-verify");
            const rows = await query("SELECT generation FROM storage_quota_objects WHERE namespace=$1 AND path=$2", [f.namespace, "managed.bin"]);
            assert.equal(rows[0].generation, "prior-generation");
            await f.inventory.close();
            const binding = path.join(f.root, ".storage-quota/namespace.json");
            const bytes = await fsp.readFile(binding);
            bytes[bytes.length - 1] = 32;
            await fsp.writeFile(binding, bytes);
            await assert.rejects(complete(f.inventory), (error) => error.code === 503);
            assert.ok((await f.totals()).every((row) => row.state !== "ready"));
        });
        await t.test("database checkpoint failure replays committed objects without charging twice", async () => {
            const f = await fixture({ batchSize: 1 });
            for (let i = 0; i < 4; i++) await f.write(`checkpoint${i}.bin`, "x");
            await f.inventory.start();
            let fail = true;
            const database = {
                createQueryRunner() {
                    const runner = ds.createQueryRunner(),
                        original = runner.query.bind(runner);
                    runner.query = async (sql, parameters) => {
                        if (fail && sql.startsWith("UPDATE storage_inventory_work SET cursor=$4")) {
                            fail = false;
                            throw Error("Injected private fixture checkpoint failure");
                        }
                        return original(sql, parameters);
                    };
                    return runner;
                },
            };
            const interrupted = new LocalStorageInventory(database, f.root, f.namespace, f.barrier, {
                ...defaults,
                batchSize: 1,
            });
            await assert.rejects(interrupted.step(), (error) => error.code === 503);
            await interrupted.start();
            await complete(interrupted);
            const rows = await query(
                "SELECT COUNT(*)::text AS count,SUM(bytes)::text AS bytes FROM storage_quota_objects WHERE namespace=$1 AND principal='system:legacy-unattributed'",
                [f.namespace],
            );
            assert.equal(rows[0].count, "4");
            assert.equal(rows[0].bytes, "4");
            await interrupted.close();
        });
        await t.test("atomic import rollback retains manifest and retries with one physical charge", async () => {
            const f = await fixture({ batchSize: 1 });
            await f.write("rollback.bin", "bytes");
            await f.inventory.start();
            let fail = true;
            const database = {
                createQueryRunner() {
                    const runner = ds.createQueryRunner(),
                        original = runner.query.bind(runner);
                    runner.query = async (sql, parameters) => {
                        if (fail && sql.startsWith("UPDATE storage_quota_accounts SET used_bytes=")) {
                            fail = false;
                            throw Error("Injected private fixture account failure");
                        }
                        return original(sql, parameters);
                    };
                    return runner;
                },
            };
            const interrupted = new LocalStorageInventory(database, f.root, f.namespace, f.barrier, {
                ...defaults,
                batchSize: 1,
            });
            await assert.rejects(complete(interrupted), (error) => error.code === 503);
            const rows = await query("SELECT COUNT(*)::text AS count FROM storage_quota_objects WHERE namespace=$1", [f.namespace]);
            assert.equal(rows[0].count, "0");
            assert.equal((await f.totals()).find((row) => row.key === "instance").used_bytes, "0");
            await interrupted.start();
            await complete(interrupted);
            assert.equal((await f.totals()).find((row) => row.key === "principal:system:legacy-unattributed").used_bytes, "5");
            await interrupted.close();
        });
        await t.test("namespace lock rejects concurrent inventory without altering its active epoch", async () => {
            const f = await fixture();
            await f.inventory.start();
            const lock = ds.createQueryRunner();
            await lock.connect();
            try {
                await lock.query("SELECT pg_advisory_lock(hashtextextended($1,17013))", [f.namespace]);
                await assert.rejects(f.inventory.step(), (error) => error.code === 409);
                const rows = await query("SELECT state FROM storage_inventory_runs WHERE namespace=$1", [f.namespace]);
                assert.equal(rows[0].state, "running");
            } finally {
                await lock.query("SELECT pg_advisory_unlock(hashtextextended($1,17013))", [f.namespace]);
                await lock.release();
            }
            await complete(f.inventory);
        });
        await t.test("reference mutation before verification fails without releasing prior charges", async () => {
            const f = await fixture();
            await f.write(`avatars/100/${oldHash}`, "avatar");
            await f.inventory.start();
            let status;
            do {
                status = await f.inventory.step();
            } while (status.phase === "content");
            await query("UPDATE users SET avatar=NULL WHERE id='100'");
            await assert.rejects(complete(f.inventory), (error) => error.code === 503);
            await query("UPDATE users SET avatar=$1 WHERE id='100'", [oldHash]);
            const rows = await query("SELECT used_bytes FROM storage_quota_accounts WHERE namespace=$1 AND key='principal:user:100'", [f.namespace]);
            assert.equal(rows[0].used_bytes, "6");
        });
        await t.test("metadata excess holds gate without deleting or rewriting legacy files", async () => {
            const f = await fixture({ maxMetadataBytes: 1 });
            await f.write("preserved.bin", "preserved");
            await f.inventory.start();
            await assert.rejects(complete(f.inventory), (error) => error.code === 503);
            assert.equal((await fsp.readFile(path.join(f.root, "preserved.bin"))).toString(), "preserved");
            assert.ok((await f.totals()).every((row) => row.state !== "ready"));
        });
        await t.test("directory mutation invalidates resume and never silently releases imported bytes", async () => {
            const f = await fixture({ batchSize: 1 });
            for (let i = 0; i < 8; i++) await f.write(`payload${i}.bin`, "x");
            await f.inventory.start();
            await f.inventory.step();
            const before = (await f.totals()).find((row) => row.key === "instance").used_bytes;
            await f.inventory.close();
            await f.write("added-after-checkpoint.bin", "new");
            const other = new LocalStorageInventory(ds, f.root, f.namespace, f.barrier, {
                ...defaults,
                batchSize: 1,
            });
            await assert.rejects(other.start(), (error) => error.code === 503);
            assert.equal((await f.totals()).find((row) => row.key === "instance").used_bytes, before);
            await other.close();
        });
        await t.test("symlinks and uncertain adapter operations fail closed with sanitized status", async () => {
            const f = await fixture();
            await f.write("preserved.bin", "preserved");
            await fsp.symlink(path.join(f.root, "preserved.bin"), path.join(f.root, "symlink.bin"));
            await f.inventory.start();
            await assert.rejects(complete(f.inventory), (error) => error.code === 503 && !error.message.includes(f.root));
            assert.ok((await f.totals()).every((row) => row.state !== "ready"));
            const busy = await fixture();
            await fsp.mkdir(path.join(busy.root, ".storage-quota/locks", "fixture-lock"));
            await assert.rejects(busy.inventory.start(), (error) => error.code === 503);
        });
        await t.test("maintenance or DB interruption resumes same epoch with idempotent object charge", async () => {
            const f = await fixture({ batchSize: 1 });
            for (let i = 0; i < 9; i++) await f.write(`stable${i}.bin`, "x");
            const start = await f.inventory.start();
            await f.inventory.step();
            let fail = true;
            const old = f.barrier.assertQuiescent;
            f.barrier.assertQuiescent = async () => {
                if (fail) throw Error("maintenance barrier unavailable");
            };
            await assert.rejects(f.inventory.step(), (error) => error.code === 503);
            fail = false;
            f.barrier.assertQuiescent = old;
            const resumed = await f.inventory.start();
            assert.equal(resumed.epoch, start.epoch);
            const final = await complete(f.inventory);
            assert.equal(final.state, "inventory-complete");
            const rows = await query("SELECT COUNT(*)::text AS count FROM storage_quota_objects WHERE namespace=$1 AND principal='system:legacy-unattributed'", [f.namespace]);
            assert.equal(rows[0].count, "9");
        });
        await t.test("validated policy is isolated from caller mutations", async () => {
            const f = await fixture();
            const policy = { ...defaults, maxMetadataBytes: 1 };
            const inventory = new LocalStorageInventory(ds, f.root, f.namespace, f.barrier, policy);
            t.after(() => inventory.close());
            policy.maxMetadataBytes = defaults.maxMetadataBytes;
            await inventory.start();
            await assert.rejects(complete(inventory), (error) => error.code === 503 && error.message.includes("INVENTORY_BOUND"));
            assert.ok((await f.totals()).every((row) => row.state !== "inventory-complete"));
        });
        await t.test("maintenance loss during the final step prevents completion", async () => {
            const f = await fixture();
            await f.write("data.bin", "data");
            await f.inventory.start();
            let status;
            do {
                status = await f.inventory.step();
            } while (status.phase !== "metadata-verify");
            while (
                (await query("SELECT COUNT(*)::text AS count FROM storage_inventory_work WHERE namespace=$1 AND kind='metadata' AND state='pending'", [f.namespace]))[0].count !==
                "0"
            )
                await f.inventory.step();
            let checks = 0;
            f.barrier.assertQuiescent = async () => {
                if (++checks > 1) throw Error("maintenance ended during completion");
            };
            await assert.rejects(f.inventory.step(), (error) => error.code === 503);
            assert.ok((await f.totals()).every((row) => row.state !== "inventory-complete"));
            const [run] = await query("SELECT state FROM storage_inventory_runs WHERE namespace=$1", [f.namespace]);
            assert.equal(run.state, "failed");
        });
        await t.test("adapter operation appearing during final step prevents completion", async () => {
            const f = await fixture();
            await f.inventory.start();
            let status;
            do {
                status = await f.inventory.step();
            } while (status.phase !== "metadata-verify");
            while (
                (await query("SELECT COUNT(*)::text AS count FROM storage_inventory_work WHERE namespace=$1 AND kind='metadata' AND state='pending'", [f.namespace]))[0].count !==
                "0"
            )
                await f.inventory.step();
            let checks = 0;
            f.barrier.assertQuiescent = async () => {
                if (++checks === 2) await fsp.mkdir(path.join(f.root, ".storage-quota/locks", "late-operation"));
            };
            await assert.rejects(f.inventory.step(), (error) => error.code === 503 && error.message.includes("ADAPTER_RECOVERY_REQUIRED"));
            assert.ok((await f.totals()).every((row) => row.state !== "inventory-complete"));
        });
        await t.test("same-size payload tampering fails private fingerprint verification", async () => {
            const f = await fixture();
            await f.write("data.bin", "old");
            await f.inventory.start();
            let status;
            do {
                status = await f.inventory.step();
            } while (status.phase === "content");
            await fsp.writeFile(path.join(f.root, "data.bin"), "new");
            await assert.rejects(complete(f.inventory), (error) => error.code === 503);
            assert.equal((await fsp.readFile(path.join(f.root, "data.bin"))).toString(), "new");
        });
    } catch (error) {
        if (error.code && typeof error.code === "string")
            throw Error(
                `Isolated inventory fixture failure (${error.code}, table=${error.driverError?.table ?? error.table ?? "unknown"}, column=${error.driverError?.column ?? error.column ?? "unknown"})`,
            );
        throw error;
    } finally {
        if (ds?.isInitialized) await ds.destroy();
        for (const root of fixtures) await fsp.rm(root, { recursive: true, force: true });
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
    }
});
