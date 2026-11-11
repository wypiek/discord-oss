const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./federation-fake-orm.cjs");

const mirrors = () =>
    load("src/api/util/utility/federationMirrors.ts", {
        typeorm: {},
        "@spacebar/database": {},
        "@spacebar/schemas": {},
        "@spacebar/util": {},
        "./federationIds": {},
        "./federationQuota": {},
    });

const gate = () => {
    let open;
    const opened = new Promise((resolve) => (open = resolve));
    return { opened, open };
};

test("work for one server runs in order and a waiter past the limit is refused with FEDERATION_QUEUE_FULL", async () => {
    const { serialized, SERIALIZED_LIMITS } = mirrors();
    const { opened, open } = gate();
    const order = [];
    const accepted = Array.from({ length: SERIALIZED_LIMITS.perKey }, (_, index) =>
        serialized("guild:1", async () => {
            if (index === 0) await opened;
            order.push(index);
        }),
    );
    await assert.rejects(
        serialized("guild:1", async () => order.push("late")),
        (error) => error.code === "FEDERATION_QUEUE_FULL",
    );
    await serialized("guild:2", async () => order.push("other"));
    open();
    await Promise.all(accepted);
    assert.deepEqual(
        order.filter((value) => value !== "other"),
        Array.from({ length: SERIALIZED_LIMITS.perKey }, (_, index) => index),
    );
    await serialized("guild:1", async () => order.push("after"));
    assert.equal(order.at(-1), "after");
});

test("no more servers than the limit can hold waiters at once", async () => {
    const { serialized, SERIALIZED_LIMITS } = mirrors();
    const { opened, open } = gate();
    const held = Array.from({ length: SERIALIZED_LIMITS.keys }, (_, index) => serialized(`guild:${index}`, () => opened));
    await assert.rejects(
        serialized("guild:extra", async () => undefined),
        (error) => error.code === "FEDERATION_QUEUE_FULL",
    );
    open();
    await Promise.all(held);
    assert.equal(await serialized("guild:extra", async () => "ran"), "ran");
});

test("a failed waiter frees its place and doesn't stop the next one", async () => {
    const { serialized } = mirrors();
    await assert.rejects(
        serialized("guild:1", async () => {
            throw new Error("boom");
        }),
        /boom/,
    );
    assert.equal(await serialized("guild:1", async () => "next"), "next");
});
