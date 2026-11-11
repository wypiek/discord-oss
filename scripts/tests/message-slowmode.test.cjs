const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("PostgreSQL slowmode enforces ordinary, moderator and owner cooldowns on a disposable database", {
    skip: !process.env.DATABASE_TEST_ADMIN_URL,
    timeout: 60000,
}, () => {
    const result = spawnSync(process.execPath, ["test", "--timeout", "50000", path.join(__dirname, "message-slowmode.postgres.cjs")], {
        env: { ...process.env, MESSAGE_SLOWMODE_TEST: "1" },
        encoding: "utf8",
        timeout: 55000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
});
