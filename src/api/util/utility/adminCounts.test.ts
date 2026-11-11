import assert from "node:assert/strict";
import { test } from "node:test";
import { cachedAsync } from "./adminCounts";

test("overview requests share one count refresh and expire together", async () => {
    let time = 1000;
    let loads = 0;
    let complete!: (value: number) => void;
    const read = cachedAsync(
        () => {
            loads++;
            return new Promise<number>((resolve) => {
                complete = resolve;
            });
        },
        30,
        () => time,
    );
    const pending = Array.from({ length: 100 }, () => read());
    assert.equal(loads, 1);
    complete(7);
    const results = await Promise.all(pending);
    assert.ok(results.every((value) => value === results[0]));
    assert.equal((await read()).value, 7);
    assert.equal(loads, 1);
    time += 30;
    const next = read();
    assert.equal(loads, 2);
    complete(8);
    assert.equal((await next).value, 8);
});

test("failed count refresh rejects waiting callers and the next request retries", async () => {
    let loads = 0;
    const read = cachedAsync(async () => {
        if (++loads === 1) throw new Error("database unavailable");
        return 5;
    }, 30);
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => read()));
    assert.ok(results.every((value) => value.status === "rejected"));
    assert.equal(loads, 1);
    assert.equal((await read()).value, 5);
    assert.equal(loads, 2);
});
