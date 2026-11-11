const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const ts = require("typescript");
const { Database } = require("bun:sqlite");
const { jobLease, loadModule } = require("./helpers/route-harness.cjs");

function load(file, mocks) {
    const timers = [];
    const cleared = [];
    const lifecycle = { eventEmitter: new EventEmitter() };
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            Buffer,
            console: { log() {}, warn() {}, error() {} },
            setTimeout: (run) => {
                const timer = { run, unref() {} };
                timers.push(timer);
                return timer;
            },
            setInterval: (run) => {
                const timer = { run, unref() {} };
                timers.push(timer);
                return timer;
            },
            clearTimeout: (timer) => cleared.push(timer),
            clearInterval: (timer) => cleared.push(timer),
            require: (name) => {
                if (name === "../../../util/util/ProcessLifecycle") return { ProcessLifecycle: lifecycle };
                if (Object.hasOwn(mocks, name)) return mocks[name];
                return new Proxy({}, { get: () => () => undefined });
            },
        },
    );
    const stop = () => Promise.all(lifecycle.eventEmitter.listeners("stopping").map((listener) => listener()));
    return { api: module.exports, timers, cleared, stop };
}

test("the discovery indexer never overlaps itself and drains its running pass on shutdown", async () => {
    const pages = [];
    const query = {
        select: () => query,
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        getMany: () =>
            new Promise((resolve) => {
                pages.push(resolve);
            }),
    };
    const h = load("src/api/util/handlers/Discovery.ts", {
        "@spacebar/database": { Guild: { createQueryBuilder: () => query }, withJobLease: async (name, work) => ({ held: name === "discovery-index", value: await work() }) },
    });
    h.api.startDiscoveryIndexer();
    h.api.startDiscoveryIndexer();
    assert.equal(h.timers.length, 2);
    for (const timer of [...h.timers, ...h.timers]) timer.run();
    assert.equal(pages.length, 1);
    let stopped = false;
    const stopping = h.stop().then(() => {
        stopped = true;
    });
    await Promise.resolve();
    assert.equal(stopped, false);
    assert.deepEqual(h.cleared, h.timers);
    pages[0]([]);
    await stopping;
    h.timers.forEach((timer) => timer.run());
    assert.equal(pages.length, 1);
});

test("the scam list refresh stops its timer and waits for a fetch in flight on shutdown", async () => {
    let finish;
    let fetches = 0;
    const config = { automod: { scam: { remoteListUrl: "https://lists.example/scams.txt", remoteListRefreshMinutes: 15 } } };
    const h = load("src/api/util/utility/scamGuard.ts", {
        "@spacebar/util": {
            Config: { get: () => config },
            fetchPublicUrl: () => {
                fetches++;
                return new Promise((resolve) => {
                    finish = () => resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
                });
            },
        },
        "@spacebar/util/util/ScamLinks": { parseScamList: () => new Set(["scam.example"]) },
    });
    h.api.startScamListRefresh();
    assert.equal(fetches, 1);
    let stopped = false;
    const stopping = h.stop().then(() => {
        stopped = true;
    });
    await Promise.resolve();
    assert.equal(stopped, false);
    assert.deepEqual(h.cleared, h.timers);
    finish();
    await stopping;
    assert.equal(h.api.scamListStatus().domains, 1);
    h.timers.forEach((timer) => timer.run());
    assert.equal(fetches, 1);
});

test("a restarted process runs the startup sync while the registry lease a previous process held lasts", async () => {
    const db = new Database(":memory:");
    const file = fs.readdirSync("src/database/migration/sqlite").find((name) => name.endsWith("-JobLeases.ts"));
    const migration = Object.values(loadModule(`src/database/migration/sqlite/${file}`, { typeorm: {} }))[0];
    await new migration().up({ query: async (sql, params = []) => db.query(sql).all(...params) });
    const leases = jobLease(db);
    assert.equal((await leases.withJobLease("federation-registry", async () => true, 4.5 * 60 * 1000)).held, true);
    const ran = [];
    const h = load("src/api/util/utility/federation.ts", {
        "@spacebar/database": {
            withJobLease: (name, work, holdForMs) =>
                leases.withJobLease(
                    name,
                    async () => {
                        ran.push(name);
                    },
                    holdForMs,
                ),
        },
        "@spacebar/util": { Config: { get: () => ({ federation: { enabled: true, announce: false } }) }, FederationKey: { restore() {} }, getRevInfoOrFail: () => ({}) },
        "./federationMoves": { refreshAliases: async () => undefined, prepareOwnMoves: async () => undefined },
    });
    h.api.startFederation();
    assert.equal(h.timers.length, 2);
    for (const timer of h.timers) timer.run();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(ran, ["federation-startup"]);
    assert.deepEqual(
        db
            .query(`SELECT "name" FROM "job_leases"`)
            .all()
            .map((row) => row.name),
        ["federation-registry"],
    );
    await h.stop();
});
