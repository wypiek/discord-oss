const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("PostgreSQL serializes E2EE mutations on a disposable database", { skip: !process.env.DATABASE_TEST_ADMIN_URL, timeout: 60000 }, () => {
    const result = spawnSync(process.execPath, ["test", path.join(__dirname, "e2ee-mutation-lock.postgres.cjs")], {
        env: { ...process.env, E2EE_MUTATION_LOCK_TEST: "1" },
        encoding: "utf8",
        timeout: 55000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
});
