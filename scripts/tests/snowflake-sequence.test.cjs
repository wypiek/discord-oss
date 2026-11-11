const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Snowflake } = require("../../dist/util/util/Snowflake.js");

test("snowflakes stay unique and keep their worker and process bits past 4096 ids in one millisecond", () => {
    const ids = Array.from({ length: 20_000 }, () => BigInt(Snowflake.generate()));
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) {
        assert.equal((id >> 17n) & 31n, Snowflake.workerId);
        assert.equal((id >> 12n) & 31n, Snowflake.processId);
    }
    const perMs = new Map();
    for (const id of ids) perMs.set(id >> 22n, (perMs.get(id >> 22n) ?? 0) + 1);
    assert.ok(Math.max(...perMs.values()) <= 4096);
    assert.ok(ids.every((id, index) => index === 0 || id > ids[index - 1]));
});

test("snowflakes keep increasing when the clock moves backwards", () => {
    const realNow = Date.now;
    try {
        const first = BigInt(Snowflake.generate());
        Date.now = () => realNow() - 60_000;
        const second = BigInt(Snowflake.generate());
        const later = Array.from({ length: 5000 }, () => BigInt(Snowflake.generate()));
        assert.ok(second > first);
        assert.ok(later.every((id, index) => id > (index ? later[index - 1] : second)));
    } finally {
        Date.now = realNow;
    }
});
