const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { EventEmitter } = require("node:events");
const turn = () => new Promise((resolve) => setImmediate(resolve));

function fixture(configured = "1", hooks = {}) {
    const lifecycle = { eventEmitter: new EventEmitter() };
    const work = require("./event-work-fixture.cjs")(lifecycle);
    const workers = [];
    const timers = [];
    class Worker extends EventEmitter {
        constructor() {
            super();
            this.requests = [];
            this.referenced = true;
            this.terminations = 0;
            workers.push(this);
        }
        ref() {
            this.referenced = true;
        }
        unref() {
            this.referenced = false;
        }
        postMessage(message) {
            hooks.send?.(message);
            this.requests.push(message);
            hooks.reply?.(this, message);
        }
        async terminate() {
            this.terminations++;
            this.emit("exit", 0);
            await hooks.terminate?.();
        }
    }
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/util/util/json/JsonWorkerPool.ts", "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
            },
        }).outputText,
        {
            module,
            Error,
            Buffer,
            structuredClone,
            exports: module.exports,
            __dirname: "/owned-fixture",
            process: { env: { JSON_WORKERS: configured } },
            setTimeout(run, delay) {
                const timer = {
                    run,
                    delay,
                    cleared: false,
                    referenced: true,
                    unref() {
                        this.referenced = false;
                        return this;
                    },
                };
                timers.push(timer);
                return timer;
            },
            clearTimeout(timer) {
                timer.cleared = true;
            },
            require(name) {
                if (name === "node:worker_threads") return { Worker };
                if (name === "../ipc/EventWork") return work;
                if (name === "../ProcessLifecycle") return { ProcessLifecycle: lifecycle };
                if (name === "./JsonSize") return require("../../src/util/util/json/JsonSize.ts");
                if (name === "./JsonInput") return require("../../src/util/util/json/JsonInput.ts");
                return require(name);
            },
        },
    );
    if (hooks.maxPendingInputBytes) module.exports.JsonWorkerPool.maxPendingInputBytes = hooks.maxPendingInputBytes;
    return {
        pool: new module.exports.JsonWorkerPool(),
        workers,
        timers,
        lifecycle,
        callbackWork: new work.EventWork(),
    };
}

test("JSON workers start lazily and synchronous idle state installs no cleanup hooks", async () => {
    const h = fixture();
    assert.equal(h.workers.length, 0);
    assert.equal(h.lifecycle.eventEmitter.eventNames().length, 0);
    await h.pool.close();
    assert.equal(h.workers.length, 0);
    await assert.rejects(h.pool.request("serialize", {}), /closing/);
});

test("one worker correlates out-of-order replies and ignores duplicate or unknown responses", async () => {
    const h = fixture();
    const first = h.pool.request("serialize", { id: 1 });
    const second = h.pool.request("serialize", { id: 2 });
    const worker = h.workers[0];
    assert.equal(h.workers.length, 1);
    assert.equal(worker.listenerCount("message"), 1);
    assert.equal(worker.referenced, true);
    const [a, b] = worker.requests;
    worker.emit("message", { id: 1000, result: "wrong" });
    worker.emit("message", { id: b.id, result: "second" });
    worker.emit("message", { id: b.id, result: "duplicate" });
    worker.emit("message", { id: a.id, result: "first" });
    assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
    assert.equal(worker.referenced, false);
    assert.ok(h.timers.every((timer) => timer.cleared && !timer.referenced && timer.delay === 60000));
    await h.pool.close();
    assert.equal(worker.terminations, 1);
});

test("JSON reply listeners and pending state exist before posting a request", async () => {
    const h = fixture("1", {
        reply: (worker, message) => worker.emit("message", { id: message.id, result: "immediate" }),
    });
    assert.equal(await h.pool.request("serialize", {}), "immediate");
    assert.equal(h.timers[0].cleared, true);
    await h.pool.close();
});

test("a JSON operation error or structured clone failure rejects only its own request", async () => {
    const h = fixture();
    const first = h.pool.request("serialize", { good: true });
    await assert.rejects(
        h.pool.request("serialize", () => {}),
        (error) => error.name === "DataCloneError",
    );
    const third = h.pool.request("deserialize", "bad JSON");
    const worker = h.workers[0];
    worker.emit("message", { id: worker.requests[1].id, error: "invalid JSON" });
    await assert.rejects(third, /invalid JSON/);
    assert.equal(worker.referenced, true);
    worker.emit("message", { id: worker.requests[0].id, result: "good" });
    assert.equal(await first, "good");
    assert.ok(h.timers.every((timer) => timer.cleared));
    await h.pool.close();
});

for (const failure of ["error", "exit", "timeout"])
    test(`JSON worker ${failure} rejects its pending jobs once and later work uses a fresh worker`, async () => {
        const h = fixture();
        const first = h.pool.request("serialize", { id: 1 });
        const second = h.pool.request("serialize", { id: 2 });
        const rejected = Promise.all([assert.rejects(first, /JSON worker/), assert.rejects(second, /JSON worker/)]);
        const old = h.workers[0];
        if (failure === "timeout") h.timers[0].run();
        else old.emit(failure, failure === "error" ? new Error("owned worker failure") : 0);
        await rejected;
        assert.equal(h.pool.pendingRequests, 0);
        const replacement = h.pool.request("serialize", { id: 3 });
        assert.equal(h.workers.length, 2);
        old.emit("message", { id: old.requests[0].id, result: "stale" });
        const worker = h.workers[1];
        worker.emit("message", { id: worker.requests[0].id, result: "fresh" });
        assert.equal(await replacement, "fresh");
        assert.equal(h.pool.pendingRequests, 0);
        assert.ok(h.timers.every((timer) => timer.cleared));
        await h.pool.close();
        assert.equal(old.terminations, 1);
        assert.equal(worker.terminations, 1);
    });

test("JSON pool close coalesces and waits for accepted jobs before terminating idle workers", async () => {
    const h = fixture();
    const accepted = h.pool.request("serialize", {});
    let closed = false;
    const first = h.pool.close();
    assert.equal(h.pool.close(), first);
    first.then(() => (closed = true));
    await assert.rejects(h.pool.request("serialize", {}), /closing/);
    await turn();
    assert.equal(closed, false);
    assert.equal(h.workers[0].terminations, 0);
    h.workers[0].emit("message", { id: h.workers[0].requests[0].id, result: "accepted" });
    assert.equal(await accepted, "accepted");
    await first;
    assert.equal(closed, true);
    assert.equal(h.workers[0].terminations, 1);
});

test("shared lifecycle drain waits for accepted JSON requests before final worker cleanup", async () => {
    const h = fixture();
    const pending = h.pool.request("serialize", {});
    let drained = false;
    h.lifecycle.state = "draining";
    const draining = h.lifecycle.eventEmitter
        .listeners("draining")[0]()
        .then(() => (drained = true));
    await assert.rejects(h.pool.request("serialize", {}), /closing/);
    await turn();
    assert.equal(drained, false);
    const worker = h.workers[0];
    worker.emit("message", { id: worker.requests[0].id, result: "finished" });
    await pending;
    await draining;
    h.lifecycle.state = "stopped";
    await h.lifecycle.eventEmitter.listeners("stopped")[0]();
    assert.equal(worker.terminations, 1);
});

for (const configured of ["0", "-1", "invalid", "1.5", "129"])
    test(`invalid JSON_WORKERS ${configured} rejects before creating a worker`, async () => {
        const h = fixture(configured);
        await assert.rejects(h.pool.request("serialize", {}), /JSON_WORKERS/);
        assert.equal(h.workers.length, 0);
        await h.pool.close();
    });

test("JSON pool grows only for concurrent work and respects its configured capacity", async () => {
    const h = fixture("2");
    const results = Array.from({ length: 5 }, (_, id) => h.pool.request("serialize", { id }));
    assert.equal(h.workers.length, 2);
    assert.deepEqual(
        h.workers.map((worker) => worker.requests.length),
        [3, 2],
    );
    for (const worker of h.workers) for (const message of worker.requests) worker.emit("message", { id: message.id, result: String(message.value.id) });
    assert.deepEqual(await Promise.all(results), ["0", "1", "2", "3", "4"]);
    await h.pool.close();
});

test("accepted callback work can submit a nested JSON request while shared lifecycle draining is active", async () => {
    const h = fixture();
    let release;
    const held = new Promise((resolve) => (release = resolve));
    let result;
    h.callbackWork.run(async () => {
        await held;
        result = await h.pool.request("serialize", { nested: true });
    });
    h.lifecycle.state = "draining";
    let drained = false;
    const draining = h.lifecycle.eventEmitter
        .listeners("draining")[0]()
        .then(() => (drained = true));
    release();
    await turn();
    assert.equal(h.workers.length, 1);
    assert.equal(drained, false);
    await assert.rejects(h.pool.request("serialize", {}), /closing/);
    const worker = h.workers[0];
    worker.emit("message", { id: worker.requests[0].id, result: "nested" });
    await draining;
    assert.equal(result, "nested");
    await h.pool.close();
});

test("worker termination failure is reported by cleanup and refuses new requests", async () => {
    const h = fixture("1", {
        terminate: () => {
            throw new Error("owned termination failed");
        },
    });
    const pending = h.pool.request("serialize", {});
    const worker = h.workers[0];
    worker.emit("message", { id: worker.requests[0].id, result: "finished" });
    await pending;
    await assert.rejects(h.pool.close(), /termination failed/);
    await assert.rejects(h.pool.request("serialize", {}), /closing/);
});

test("a failed worker rejects its own jobs while another worker keeps its accepted request", async () => {
    const h = fixture("2");
    const first = h.pool.request("serialize", { id: 1 });
    const second = h.pool.request("serialize", { id: 2 });
    const third = h.pool.request("serialize", { id: 3 });
    const rejected = Promise.all([assert.rejects(first, /JSON worker failed/), assert.rejects(third, /JSON worker failed/)]);
    h.workers[0].emit("error", new Error("owned worker failure"));
    await rejected;
    const worker = h.workers[1];
    assert.equal(worker.referenced, true);
    worker.emit("message", { id: worker.requests[0].id, result: "unaffected" });
    assert.equal(await second, "unaffected");
    await h.pool.close();
    assert.ok(h.workers.every((owned) => owned.terminations === 1));
});

test("native workers round-trip concurrent requests, isolate invalid inputs and exit after lifecycle cleanup", { timeout: 6000 }, () => {
    const { spawnSync } = require("node:child_process");
    const path = require("node:path");
    const serializer = path.resolve("dist/util/util/json/JsonSerializer.js");
    const lifecycle = path.resolve("dist/util/util/ProcessLifecycle.js");
    const source = `
        const assert = require("node:assert/strict");
        const { JsonSerializer } = require(${JSON.stringify(serializer)});
        const { ProcessLifecycle } = require(${JSON.stringify(lifecycle)});
        const values = await Promise.all(Array.from({length:32}, async (_, id) => {
            const encoded = await JsonSerializer.SerializeAsync({id, text:"🏳️‍⚧️"});
            const decoded = await JsonSerializer.DeserializeAsync(encoded);
            assert.equal(decoded.id, id);
            assert.equal(decoded.text, "🏳️‍⚧️");
            return encoded;
        }));
        assert.equal(new Set(values).size, 32);
        const good = JsonSerializer.SerializeAsync({valid:true});
        await assert.rejects(JsonSerializer.SerializeAsync(() => {}));
        await assert.rejects(JsonSerializer.DeserializeAsync("invalid JSON"));
        assert.equal(await good, '{"valid":true}');
        await ProcessLifecycle.Shutdown();
        await ProcessLifecycle.Finalize();
        console.log(JSON.stringify({roundTrips:32, distinctReplies:32, invalidRequestsIsolated:true, cleanup:true}));
    `;
    const child = spawnSync(process.execPath, ["-e", source], {
        encoding: "utf8",
        timeout: 5000,
        env: { ...process.env, JSON_WORKERS: "1", NOTIFY_SOCKET: "", TRACE_ACTIVE_HANDLES: "" },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
        roundTrips: 32,
        distinctReplies: 32,
        invalidRequestsIsolated: true,
        cleanup: true,
    });
});

test("native JSON parsing preserves numeric and primitive values in scalar nested and streamed replies", { timeout: 6000 }, () => {
    const { spawnSync } = require("node:child_process");
    const path = require("node:path");
    const serializer = path.resolve("dist/util/util/json/JsonSerializer.js");
    const lifecycle = path.resolve("dist/util/util/ProcessLifecycle.js");
    const source = `
        const assert = require("node:assert/strict");
        const fs = require("node:fs");
        const { JsonSerializer } = require(${JSON.stringify(serializer)});
        const { ProcessLifecycle } = require(${JSON.stringify(lifecycle)});
        const inputs = ["-0", "0", "1e999", "-1e999", "5e-324", "-1e-999", "9007199254740993", "null", "false", "true", '"-0"', '[{"n":-0,"p":1e999,"m":-1e999},-0]'];
        const values = await Promise.all(inputs.map(json => JsonSerializer.DeserializeAsync(json)));
        for (let index = 0; index < inputs.length; index++) assert.deepEqual(values[index], JSON.parse(inputs[index]));
        assert.equal(Object.is(values[0], -0), true);
        assert.equal(Object.is(values[5], -0), true);
        assert.equal(values[2], Infinity);
        assert.equal(values[3], -Infinity);
        const json = '[' + inputs.join(',') + ']';
        const expected = JSON.parse(json);
        const bytes = new TextEncoder().encode(json);
        const web = new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close()}});
        const streamed=[];
        for await(const value of JsonSerializer.DeserializeAsyncEnumerable(web))streamed.push(value);
        assert.deepEqual(streamed, expected);
        assert.equal(web.locked,false);
        const dir=fs.mkdtempSync("/tmp/meowcord-json-numeric-");
        try {
            const file=dir+"/input.json";
            fs.writeFileSync(file,json);
            assert.deepEqual(await JsonSerializer.DeserializeAsync(fs.createReadStream(file,{highWaterMark:1})),expected);
            const enumerated=[];
            for await(const value of JsonSerializer.DeserializeAsyncEnumerable(fs.createReadStream(file,{highWaterMark:1})))enumerated.push(value);
            assert.deepEqual(enumerated,expected);
        }finally{fs.rmSync(dir,{recursive:true,force:true})}
        const unsafe='{"__proto__":{"owned":true},"constructor":-0}';
        const parsed=await JsonSerializer.DeserializeAsync(unsafe);
        assert.deepEqual(parsed,JSON.parse(unsafe));
        assert.equal(Object.getPrototypeOf(parsed),Object.prototype);
        assert.equal(Object.prototype.owned,undefined);
        await assert.rejects(JsonSerializer.DeserializeAsync("NaN"));
        assert.equal(await JsonSerializer.SerializeAsync({valid:1}),'{"valid":1}');
        await ProcessLifecycle.Shutdown();
        await ProcessLifecycle.Finalize();
        console.log(JSON.stringify({scalarCases:12,nested:true,web:true,file:true,negativeZero:true,overflow:true,prototypeKeysSafe:true,errorsIsolated:true}));
    `;
    const child = spawnSync(process.execPath, ["-e", source], {
        encoding: "utf8",
        timeout: 5000,
        env: { ...process.env, JSON_WORKERS: "1", NOTIFY_SOCKET: "", TRACE_ACTIVE_HANDLES: "" },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout.trim()), {
        scalarCases: 12,
        nested: true,
        web: true,
        file: true,
        negativeZero: true,
        overflow: true,
        prototypeKeysSafe: true,
        errorsIsolated: true,
    });
});

test("JSON worker admission shares a fixed request budget across workers and resumes after a reply", async () => {
    const h = fixture("2");
    const work = Array.from({ length: 1024 }, () => h.pool.request("deserialize", "{}"));
    await assert.rejects(h.pool.request("deserialize", "{}"), (error) => error.code === "JSON_QUEUE_FULL");
    assert.equal(h.pool.pendingRequests, 1024);
    assert.equal(h.timers.length, 1024);
    const first = h.workers[0].requests[0];
    h.workers[0].emit("message", { id: first.id, result: {} });
    const resumed = h.pool.request("deserialize", "{}");
    assert.equal(h.pool.pendingRequests, 1024);
    for (const worker of h.workers) for (const request of worker.requests) worker.emit("message", { id: request.id, result: {} });
    await Promise.all([...work, resumed]);
    assert.equal(h.pool.pendingRequests, 0);
    await h.pool.close();
});

test("JSON worker failure releases its request budget before replacement admission", async () => {
    const h = fixture("1");
    const work = Array.from({ length: 1024 }, () => h.pool.request("deserialize", "{}"));
    const rejected = work.map((request) => assert.rejects(request, /JSON worker failed/));
    h.workers[0].emit("error", new Error("owned failure"));
    await Promise.all(rejected);
    assert.equal(h.pool.pendingRequests, 0);
    const resumed = h.pool.request("deserialize", "{}");
    assert.equal(h.workers.length, 2);
    h.workers[1].emit("message", { id: h.workers[1].requests[0].id, result: {} });
    await resumed;
    assert.equal(h.pool.pendingRequests, 0);
    await h.pool.close();
});

test("JSON deserialization admission bounds UTF-8 bytes across workers and releases capacity after replies", async () => {
    const h = fixture("2", { maxPendingInputBytes: 16 * 1024 * 1024 });
    const input = JSON.stringify("é".repeat(1024 * 1024));
    const work = Array.from({ length: 7 }, () => h.pool.request("deserialize", input));
    const bytes = h.pool.pendingInputBytes;
    assert.equal(bytes, 7 * Buffer.byteLength(input));
    await assert.rejects(h.pool.request("deserialize", input), (error) => error.code === "JSON_QUEUE_FULL");
    assert.equal(h.timers.length, 7);
    assert.equal(h.pool.pendingInputBytes, bytes);
    const first = h.workers[0].requests[0];
    h.workers[0].emit("message", { id: first.id, result: "done" });
    const resumed = h.pool.request("deserialize", input);
    assert.equal(h.pool.pendingInputBytes, bytes);
    for (const worker of h.workers) for (const request of worker.requests) worker.emit("message", { id: request.id, result: "done" });
    await Promise.all([...work, resumed]);
    assert.equal(h.pool.pendingInputBytes, 0);
    await h.pool.close();
});

test("JSON input byte admission accepts the exact boundary and rejects oversized input without creating workers", async () => {
    const h = fixture("1", { maxPendingInputBytes: 16 * 1024 * 1024 });
    const input = `"${"é".repeat((16 * 1024 * 1024 - 2) / 2)}"`;
    const accepted = h.pool.request("deserialize", input);
    assert.equal(h.pool.pendingInputBytes, 16 * 1024 * 1024);
    await assert.rejects(h.pool.request("deserialize", "{}"), (error) => error.code === "JSON_QUEUE_FULL");
    h.workers[0].emit("message", { id: h.workers[0].requests[0].id, result: "done" });
    await accepted;
    assert.equal(h.pool.pendingInputBytes, 0);
    await h.pool.close();
    const other = fixture("1", { maxPendingInputBytes: 16 * 1024 * 1024 });
    await assert.rejects(other.pool.request("deserialize", `${input} `), (error) => error.code === "JSON_QUEUE_FULL");
    assert.equal(other.workers.length, 0);
    assert.equal(other.timers.length, 0);
    assert.equal(other.pool.pendingInputBytes, 0);
    await other.pool.close();
});

for (const failure of ["error", "exit", "timeout"])
    test(`JSON worker ${failure} releases every pending input-byte reservation`, async () => {
        const h = fixture();
        const work = [h.pool.request("deserialize", "{}"), h.pool.request("deserialize", "[]")];
        const rejected = work.map((request) => assert.rejects(request, /JSON worker/));
        assert.equal(h.pool.pendingInputBytes, 4);
        if (failure === "timeout") h.timers[0].run();
        else h.workers[0].emit(failure, failure === "error" ? new Error("owned failure") : 0);
        await Promise.all(rejected);
        assert.equal(h.pool.pendingInputBytes, 0);
        assert.equal(h.pool.pendingRequests, 0);
        await h.pool.close();
    });

test("serialization snapshots share admission bytes with text and release them after settlement", async () => {
    const h = fixture("2", { maxPendingInputBytes: 1024 });
    const value = { text: "é".repeat(300) };
    const accepted = h.pool.request("serialize", value);
    const reserved = h.pool.pendingInputBytes;
    assert.ok(reserved >= 600);
    value.text = "changed";
    assert.equal(h.workers[0].requests[0].value.text, "é".repeat(300));
    const text = h.pool.request("deserialize", " ".repeat(1024 - reserved));
    assert.equal(h.pool.pendingInputBytes, 1024);
    await assert.rejects(h.pool.request("serialize", {}), (error) => error.code === "JSON_QUEUE_FULL");
    assert.equal(h.timers.length, 2);
    h.workers[0].emit("message", { id: h.workers[0].requests[0].id, result: "done" });
    await accepted;
    const resumed = h.pool.request("serialize", value);
    for (const worker of h.workers) for (const request of worker.requests) worker.emit("message", { id: request.id, result: "done" });
    await Promise.all([text, resumed]);
    assert.equal(h.pool.pendingInputBytes, 0);
    await h.pool.close();
});

test("serialization accounts backing buffers and graph containers without recounting aliases", async () => {
    const { measureJsonValue } = require("../../src/util/util/json/JsonSize.ts");
    const buffer = new ArrayBuffer(4096);
    const view = new Uint8Array(buffer, 0, 1);
    assert.throws(
        () => measureJsonValue(view, 4095),
        (error) => error.code === "JSON_QUEUE_FULL",
    );
    const shared = { text: "x".repeat(2048) };
    const aliases = { first: shared, second: shared };
    aliases.self = aliases;
    assert.ok(measureJsonValue(aliases, 4096) < 4096);
    const map = new Map([[shared, new Set([buffer, view])]]);
    assert.ok(measureJsonValue(map, 8192) >= 6144);
    assert.throws(
        () => measureJsonValue(new Array(1024), 1024),
        (error) => error.code === "JSON_QUEUE_FULL",
    );
    for (const backing of [new ArrayBuffer(8, { maxByteLength: 8192 }), new SharedArrayBuffer(8, { maxByteLength: 8192 })])
        assert.throws(
            () => measureJsonValue(backing, 4096),
            (error) => error.code === "JSON_QUEUE_FULL",
        );
    const h = fixture("1", { maxPendingInputBytes: 1024 });
    await assert.rejects(h.pool.request("serialize", view), (error) => error.code === "JSON_QUEUE_FULL");
    assert.equal(h.workers.length, 0);
    assert.equal(h.timers.length, 0);
    await h.pool.close();
});

test("serialization evaluates original getters once and rechecks capacity after nested admission", async () => {
    const h = fixture("1", { maxPendingInputBytes: 1024 });
    let calls = 0;
    let nested;
    const source = {
        get text() {
            calls++;
            nested = h.pool.request("deserialize", " ".repeat(1024));
            return "x";
        },
    };
    await assert.rejects(h.pool.request("serialize", source), (error) => error.code === "JSON_QUEUE_FULL");
    assert.equal(calls, 1);
    assert.equal(h.pool.pendingInputBytes, 1024);
    assert.equal(h.timers.length, 1);
    h.workers[0].emit("message", { id: h.workers[0].requests[0].id, result: {} });
    await nested;
    await h.pool.close();
});

test("a getter closing the pool prevents allocation after its snapshot", async () => {
    const h = fixture();
    let closed;
    await assert.rejects(
        h.pool.request("serialize", {
            get text() {
                closed = h.pool.close();
                return "x";
            },
        }),
        /closing/,
    );
    await closed;
    assert.equal(h.workers.length, 0);
    assert.equal(h.timers.length, 0);
});

for (const failure of ["error", "exit", "timeout"])
    test(`serialization reservations release after worker ${failure}`, async () => {
        const h = fixture();
        const accepted = h.pool.request("serialize", { text: "x".repeat(2048) });
        const rejected = assert.rejects(accepted, /JSON worker/);
        assert.ok(h.pool.pendingInputBytes >= 2048);
        if (failure === "timeout") h.timers[0].run();
        else h.workers[0].emit(failure, failure === "error" ? new Error("owned failure") : 0);
        await rejected;
        assert.equal(h.pool.pendingInputBytes, 0);
        await h.pool.close();
    });
