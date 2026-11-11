const { Client } = require("pg");
const { userInfo } = require("node:os");
const { randomBytes } = require("node:crypto");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const migrationPath = "src/database/migration/postgres/1791662548137-AdminUserSearchIndexes.ts";
const migrationModule = { exports: {} };
vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(migrationPath, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
        module: migrationModule,
        exports: migrationModule.exports,
        require,
    },
);
const Migration = migrationModule.exports.AdminUserSearchIndexes1791662548137;
const db = "admin_users_perf_" + randomBytes(6).toString("hex");
const opts = { host: "localhost", port: 5432, user: userInfo().username };
(async () => {
    const control = new Client({ ...opts, database: "postgres" });
    await control.connect();
    await control.query("CREATE DATABASE " + db);
    const client = new Client({ ...opts, database: db });
    await client.connect();
    try {
        await client.query(
            `CREATE TABLE users(id bigint PRIMARY KEY,username varchar,global_name varchar,email varchar,created_at timestamp,disabled boolean,bot boolean,verified boolean, filler text)`,
        );
        await client.query(
            `INSERT INTO users SELECT 100000000000000000+i, CASE WHEN i%1000=0 THEN 'RareNeedleUser'||i ELSE 'member_'||md5(i::text) END,CASE WHEN i%2500=0 THEN 'UncommonDisplay'||i WHEN i%4=0 THEN NULL ELSE 'Display '||md5((i+1)::text) END,'test_'||md5((i+2)::text)||'@isolated.test',timestamp '2026-01-01'+(i%10000)*interval '1 minute',i%20=0,i%30=0,i%3=0,repeat('x',512) FROM generate_series(1,100000)i`,
        );
        await client.query("ANALYZE users");
        const queries = {
            list: `SELECT id,username,global_name,email,created_at FROM users ORDER BY created_at DESC,id DESC LIMIT 50`,
            username: `SELECT id,username,global_name,email,created_at FROM users WHERE username ILIKE '%needle%' OR global_name ILIKE '%needle%' OR email ILIKE '%needle%' ORDER BY created_at DESC,id DESC LIMIT 50`,
            count: `SELECT count(*) FROM users WHERE username ILIKE '%needle%' OR global_name ILIKE '%needle%' OR email ILIKE '%needle%'`,
            display: `SELECT count(*) FROM users WHERE username ILIKE '%uncommon%' OR global_name ILIKE '%uncommon%' OR email ILIKE '%uncommon%'`,
            email: `SELECT count(*) FROM users WHERE username ILIKE '%e123%' OR global_name ILIKE '%e123%' OR email ILIKE '%e123%'`,
        };
        const run = async () => {
            const result = {};
            for (const [key, q] of Object.entries(queries)) {
                await client.query(q);
                const plans = [];
                for (let n = 0; n < 5; n++) plans.push((await client.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + q)).rows[0]["QUERY PLAN"][0]);
                plans.sort((a, b) => a["Execution Time"] - b["Execution Time"]);
                result[key] = { median_ms: plans[2]["Execution Time"], plan: plans[2].Plan };
            }
            return result;
        };
        const before = await run();
        const migration = new Migration();
        const runner = { query: (sql) => client.query(sql) };
        const queryResults = async () => {
            const results = [];
            for (const q of Object.values(queries)) results.push((await client.query(q)).rows);
            return results;
        };
        const expected = await queryResults();
        await migration.up(runner);
        await migration.up(runner);
        assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_indexes WHERE tablename='users' AND indexname LIKE 'IDX_users_admin_%'")).rows[0].count, 4);
        await client.query("ANALYZE users");
        assert.deepEqual(await queryResults(), expected);
        const after = await run();
        fs.writeFileSync("/tmp/admin-users-perf-results.json", JSON.stringify({ rows: 100000, before, after }, null, 2));
        console.log(
            JSON.stringify(
                {
                    rows: 100000,
                    results: Object.fromEntries(
                        Object.keys(queries).map((key) => [
                            key,
                            {
                                before_ms: before[key].median_ms,
                                after_ms: after[key].median_ms,
                                speedup: before[key].median_ms / after[key].median_ms,
                                before_node: before[key].plan["Node Type"],
                                after_node: after[key].plan["Node Type"],
                            },
                        ]),
                    ),
                },
                null,
                2,
            ),
        );
        await migration.down(runner);
        await migration.down(runner);
        assert.equal((await client.query("SELECT count(*)::int AS count FROM pg_indexes WHERE tablename='users' AND indexname LIKE 'IDX_users_admin_%'")).rows[0].count, 0);
    } finally {
        await client.end();
        await control.query("DROP DATABASE " + db);
        await control.end();
    }
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
