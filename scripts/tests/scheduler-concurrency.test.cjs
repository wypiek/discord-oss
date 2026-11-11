const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("background jobs run by two processes at once do each piece of work once on a disposable PostgreSQL database", {
    skip: !process.env.DATABASE_TEST_ADMIN_URL,
    timeout: 300000,
}, () => {
    const result = spawnSync(process.execPath, ["test", "--timeout", "120000", path.join(__dirname, "scheduler-concurrency.postgres.cjs")], {
        env: { ...process.env, SCHEDULER_CONCURRENCY_TEST: "1" },
        encoding: "utf8",
        timeout: 290000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
});
