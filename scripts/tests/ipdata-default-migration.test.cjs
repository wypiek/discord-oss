const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { Client } = require("pg");
const path = "src/database/migration/postgres/1765665440000-DropDefaultIPDataKey.ts";
function migration() {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(path, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
        },
    );
    return new module.exports.DropDefaultIPDataKey1765665440000();
}
test("legacy IPData migration emits digest-only SQL and never restores a shared key", async () => {
    const calls = [];
    const instance = migration();
    const runner = { query: async (...args) => calls.push(args) };
    await instance.up(runner);
    assert.equal(calls.length, 1);
    assert.match(calls[0][0], /sha256\(convert_to\("value", 'UTF8'\)\)/);
    assert.match(calls[0][0], /octet_length\("value"\) = \$1/);
    assert.equal(calls[0][1][0], 58);
    assert.match(calls[0][1][1], /^[a-f0-9]{64}$/);
    await instance.down(runner);
    assert.equal(calls.length, 1, "downgrade must not restore a legacy shared credential");
});
test("actual PostgreSQL migration removes only exact legacy JSON and is idempotent", { skip: !process.env.IPDATA_MIGRATION_TEST_DATABASE }, async () => {
    const url = new URL(process.env.IPDATA_MIGRATION_TEST_DATABASE);
    assert.equal(decodeURIComponent(url.pathname.slice(1)) === "meowcord_oct7_3397", true, "only the explicitly isolated audit database is allowed");
    const historical = execFileSync("git", ["cat-file", "blob", "646737a090cf53f6ae6898df797e4491c6abde0a"], { encoding: "utf8" });
    const legacy = historical.match(/ipdataApiKey\s*:\s*["']([^"']+)["']/)?.[1];
    assert.equal(typeof legacy === "string", true, "historical fixture must be available locally");
    const serialized = JSON.stringify(legacy);
    const captured = [];
    const instance = migration();
    await instance.up({ query: async (...args) => captured.push(args) });
    assert.equal(createHash("sha256").update(serialized).digest("hex") === captured[0][1][1], true, "digest must identify the exact former stored JSON value");
    assert.equal(fs.readFileSync(path, "utf8").includes(legacy), false, "migration must not embed the legacy credential");
    const client = new Client({ connectionString: process.env.IPDATA_MIGRATION_TEST_DATABASE });
    const schema = `ipdata_cleanup_${randomUUID().replaceAll("-", "")}`;
    await client.connect();
    try {
        await client.query("BEGIN");
        await client.query(`CREATE SCHEMA "${schema}"`);
        await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
        await client.query('CREATE TABLE "config" (id integer PRIMARY KEY, "key" text, "value" text)');
        const rows = [
            [1, "security_ipdataApiKey", serialized],
            [2, "security_ipdataApiKey", JSON.stringify("operator-owned-fixture-key")],
            [3, "other_setting", serialized],
            [4, "security_ipdataApiKey", null],
            [5, "security_ipdataApiKey", legacy],
            [6, "security_ipdataApiKey", ` ${serialized}`],
            [7, "other_setting", null],
        ];
        for (const row of rows) await client.query('INSERT INTO "config" (id, "key", "value") VALUES ($1, $2, $3)', row);
        const runner = { query: (sql, parameters) => client.query(sql, Array.from(parameters)) };
        await instance.up(runner);
        const after = await client.query('SELECT id, "value" FROM "config" ORDER BY id');
        for (const row of after.rows) assert.equal(row.value === (row.id === 1 ? null : rows[row.id - 1][2]), true, `fixture row ${row.id} preserves exact-match semantics`);
        await instance.up(runner);
        await instance.down(runner);
        const repeated = await client.query('SELECT id, "value" FROM "config" ORDER BY id');
        assert.equal(
            repeated.rows.every((row, i) => row.value === after.rows[i].value),
            true,
            "repeated up and irreversible down preserve all fixture rows",
        );
    } finally {
        try {
            await client.query("ROLLBACK");
        } finally {
            await client.end();
        }
    }
});
