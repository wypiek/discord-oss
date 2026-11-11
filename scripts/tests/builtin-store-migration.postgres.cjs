const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { Client } = require("pg");
const { userInfo } = require("node:os");
const { randomBytes } = require("node:crypto");
const database = "builtin_store_migration_" + randomBytes(6).toString("hex");
const options = { host: "localhost", port: 5432, user: userInfo().username };
const moduleUnderTest = { exports: {} };
const filename = "src/database/migration/postgres/1791662738491-BuiltinStorePackCustomization.ts";
vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
        module: moduleUnderTest,
        exports: moduleUnderTest.exports,
        require,
    },
);
(async () => {
    const control = new Client({ ...options, database: "postgres" });
    await control.connect();
    await control.query("CREATE DATABASE " + database);
    const client = new Client({ ...options, database });
    await client.connect();
    try {
        await client.query("CREATE TABLE store_hidden_packs(sku_id bigint PRIMARY KEY)");
        await client.query("INSERT INTO store_hidden_packs VALUES(10)");
        const migration = new moduleUnderTest.exports.BuiltinStorePackCustomization1791662738491();
        const runner = { query: (sql) => client.query(sql) };
        await migration.up(runner);
        await migration.up(runner);
        assert.deepEqual((await client.query("SELECT * FROM store_hidden_packs")).rows, [{ sku_id: "10", hidden: true, customization: {} }]);
        await client.query('INSERT INTO store_hidden_packs VALUES(20,false,\'{"name":"Local name"}\')');
        await migration.up(runner);
        assert.equal((await client.query("SELECT hidden FROM store_hidden_packs WHERE sku_id=20")).rows[0].hidden, false);
        await migration.down(runner);
        await migration.down(runner);
        assert.deepEqual((await client.query("SELECT * FROM store_hidden_packs")).rows, [{ sku_id: "10" }]);
        console.log("PASS builtin migration: legacy hidden preserved, visible customization preserved, repeatable up/down and safe rollback");
    } finally {
        await client.end();
        await control.query("DROP DATABASE " + database);
        await control.end();
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
