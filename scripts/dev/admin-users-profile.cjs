const path = require("node:path"),
    root = path.resolve(__dirname, "../..");
process.chdir(root);
let target;
try {
    target = new URL(process.env.DATABASE || "");
} catch {
    throw Error("Set ADMIN_USERS_PROFILE=1 and DATABASE to the isolated local fosscord_codex_admin database");
}
assertTarget(target);
function assertTarget(target) {
    if (process.env.ADMIN_USERS_PROFILE !== "1" || target.pathname !== "/fosscord_codex_admin" || !["localhost", "127.0.0.1"].includes(target.hostname))
        throw Error("Set ADMIN_USERS_PROFILE=1 and DATABASE to the isolated local fosscord_codex_admin database");
}
process.env.APPLY_DB_MIGRATIONS = "false";
delete process.env.DB_SYNC;
const fs = require("node:fs"),
    vm = require("node:vm"),
    ts = require("typescript"),
    assert = require("node:assert/strict");
const database = require(root + "/dist/database");
database.DataSourceOptions.setOptions({
    extra: { options: "-c default_transaction_read_only=on" },
    logging: false,
});
const util = require(root + "/dist/util/util/Config");
const config = new (require(root + "/dist/util/config").ConfigValue)();
util.Config.get = () => config;
const source = fs.readFileSync("src/api/routes/admin/users/index.ts", "utf8");
function load(source) {
    let handler;
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            require(n) {
                if (n === "express")
                    return {
                        Router: () => ({
                            get: (p, o, h) => {
                                assert.equal(o.right, "MANAGE_USERS");
                                assert.equal(o.spacebarOnly, true);
                                handler = h;
                            },
                        }),
                    };
                if (n === "@spacebar/api/middlewares") return { route: (o) => o };
                return require("node:module").createRequire(root + "/package.json")(n);
            },
        },
    );
    return (query) => new Promise((resolve, reject) => handler({ query }, { json: (body) => resolve(JSON.parse(JSON.stringify(body))) }).catch(reject));
}
const sources = {
    serial: source,
    parallel: source.replace("await query.getManyAndCount()", "await Promise.all([query.clone().getMany(), query.clone().getCount()])"),
    window: source.replace(
        "const [users, total] = await query.getManyAndCount();",
        'const { entities: users, raw } = await query.addSelect("COUNT(*) OVER()", "admin_total").getRawAndEntities(); const total = raw.length ? Number(raw[0].admin_total) : offset ? await query.clone().getCount() : 0;',
    ),
};
function stats(values) {
    values.sort((a, b) => a - b);
    return {
        p50: values[Math.max(0, Math.ceil(values.length * 0.5) - 1)],
        p95: values[Math.max(0, Math.ceil(values.length * 0.95) - 1)],
    };
}
(async () => {
    const db = await database.initDatabase();
    try {
        let queryTimes = [],
            hydrateTimes = [],
            transformTimes = [];
        const transformer = require("typeorm/query-builder/transformer/RawSqlResultsToEntityTransformer").RawSqlResultsToEntityTransformer.prototype;
        const transform = transformer.transform;
        transformer.transform = function (...args) {
            const start = performance.now();
            const result = transform.apply(this, args);
            transformTimes.push(performance.now() - start);
            return result;
        };
        const proto = require(root + "/node_modules/typeorm/driver/postgres/PostgresQueryRunner").PostgresQueryRunner.prototype;
        const original = proto.query;
        proto.query = async function (sql, ...args) {
            const start = performance.now();
            const r = await original.call(this, sql, ...args);
            queryTimes.push({
                kind: /COUNT\(/i.test(sql) ? "count" : "page",
                ms: performance.now() - start,
            });
            return r;
        };
        const builder = require(root + "/node_modules/typeorm/query-builder/SelectQueryBuilder").SelectQueryBuilder.prototype;
        const entities = builder.executeEntitiesAndRawResults;
        builder.executeEntitiesAndRawResults = async function (...args) {
            const start = performance.now();
            const r = await entities.apply(this, args);
            hydrateTimes.push(performance.now() - start);
            return r;
        };
        const results = [];
        const methods = Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, load(v)]));
        const expected = await methods.serial({ limit: "50" });
        for (const params of [
            { limit: "50" },
            { limit: "50", offset: "70" },
            { limit: "50", offset: "9999" },
            { q: "not-present-literal_%\\" },
            { filter: "bots" },
            { filter: "disabled" },
            { filter: "verified" },
            { filter: "unverified" },
        ]) {
            const expected = await methods.serial(params);
            for (const [k, m] of Object.entries(methods)) assert.deepEqual(await m(params), expected);
        }
        for (let round = 0; round < 3; round++)
            for (const [mode, method] of [...Object.entries(methods).slice(round), ...Object.entries(methods).slice(0, round)])
                for (const concurrency of [1, 16]) {
                    for (let i = 0; i < 30; i++) await method({ limit: "50" });
                    queryTimes = [];
                    hydrateTimes = [];
                    transformTimes = [];
                    let next = 0,
                        times = [];
                    const start = performance.now();
                    await Promise.all(
                        Array.from({ length: concurrency }, async () => {
                            while (next++ < 100) {
                                const t = performance.now();
                                assert.deepEqual(await method({ limit: "50" }), expected);
                                times.push(performance.now() - t);
                            }
                        }),
                    );
                    results.push({
                        round,
                        mode,
                        concurrency,
                        requests: 100,
                        total_ms: performance.now() - start,
                        ...stats(times),
                        queryCalls: queryTimes.length,
                        query_ms: stats(queryTimes.map((x) => x.ms)),
                        entity_ms: stats(hydrateTimes),
                        hydration_cpu_ms: stats(transformTimes),
                    });
                }
        const report = {
            sampled_at: new Date().toISOString(),
            revision: require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
            users: expected.total,
            rows: expected.users.length,
            methods: Object.keys(methods),
            semanticCases: 8,
            results,
            limitations: [
                "Direct handler bypasses HTTP/authentication middleware; compare authenticated admin-bench separately",
                "Uses cached ConfigValue defaults without loading or changing stored instance config",
                "Small local dataset; window-count candidate may regress large indexed tables",
                "Database/CPU timings include queueing and concurrent local work; report repeated rounds",
            ],
        };
        console.log(JSON.stringify(report, null, 2));
        if (process.env.ADMIN_USERS_PROFILE_OUTPUT) fs.writeFileSync(process.env.ADMIN_USERS_PROFILE_OUTPUT, JSON.stringify(report, null, 2) + "\n");
    } finally {
        await db.destroy();
    }
})().catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
});
