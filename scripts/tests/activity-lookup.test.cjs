const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const harness = (findOne) => {
    let now = 0;
    const module = { exports: {} };
    const imports = {
        "@spacebar/database": { EmbeddedActivity: { findOne } },
        "@spacebar/util": {
            Config: { get: () => ({ client: { activityApplicationHost: "activity.example" } }) },
        },
        "lambert-server/HTTPError": {
            HTTPError: class extends Error {
                constructor(message, code) {
                    super(message);
                    this.code = code;
                }
            },
        },
        "@spacebar/api/util/utility/applicationOutbound": {},
        "./index": { APPLICATION_EMBEDDED: 1 << 17, BUILTIN_ACTIVITIES: {} },
    };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/activities/ActivityHost.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) => {
                assert.ok(name in imports, name);
                return imports[name];
            },
            URL,
            console: { error() {} },
            Date: { now: () => now },
        },
    );
    const invoke = (id = "123456789012345678") =>
        new Promise((resolve) => {
            let status = 200;
            module.exports.ActivityHost(
                { headers: { host: `${id}.activity.example` }, url: "/", method: "GET" },
                {
                    status(value) {
                        status = value;
                        return this;
                    },
                    type() {
                        return this;
                    },
                    send() {
                        resolve(status);
                    },
                    headersSent: false,
                },
                () => resolve(0),
            );
        });
    return {
        invoke,
        forget: module.exports.forgetActivityLookup,
        advance: () => {
            now += 30001;
        },
    };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
test("unauthenticated identical activity misses share one database query", async () => {
    let calls = 0;
    let release;
    const waiting = new Promise((resolve) => {
        release = resolve;
    });
    const h = harness(async () => {
        calls++;
        await waiting;
        return null;
    });
    const requests = Array.from({ length: 100 }, () => h.invoke());
    await flush();
    assert.equal(calls, 1);
    release();
    assert.deepEqual(await Promise.all(requests), Array(100).fill(404));
});
test("distinct activity misses have queue-free database admission and recover after failure", async () => {
    let calls = 0;
    let release;
    const waiting = new Promise((resolve) => {
        release = resolve;
    });
    const h = harness(async () => {
        calls++;
        await waiting;
        throw new Error("owned fixture");
    });
    const requests = Array.from({ length: 32 }, (_, i) => h.invoke(String(123456789012345678n + BigInt(i))));
    await flush();
    assert.equal(await h.invoke("223456789012345678"), 503);
    assert.equal(calls, 32);
    release();
    assert.deepEqual(await Promise.all(requests), Array(32).fill(502));
    assert.equal(await h.invoke("223456789012345678"), 502);
    assert.equal(calls, 33);
});
test("negative cache is finite and TTL causes a new query", async () => {
    let calls = 0;
    const h = harness(async () => {
        calls++;
        return null;
    });
    for (let i = 0; i < 4200; i++) await h.invoke(String(123456789012345678n + BigInt(i)));
    assert.equal(calls, 4200);
    await h.invoke("123456789012349877");
    assert.equal(calls, 4200);
    await h.invoke();
    assert.equal(calls, 4201);
    h.advance();
    await h.invoke();
    assert.equal(calls, 4202);
});
test("invalidation prevents a stale in-flight lookup from repopulating cache", async () => {
    let calls = 0;
    let release;
    const waiting = new Promise((resolve) => {
        release = resolve;
    });
    const h = harness(async () => {
        calls++;
        if (calls === 1) await waiting;
        return null;
    });
    const first = h.invoke();
    await flush();
    h.forget("123456789012345678");
    release();
    await first;
    await h.invoke();
    assert.equal(calls, 2);
});
