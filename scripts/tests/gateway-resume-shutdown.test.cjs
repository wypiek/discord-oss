const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { EventEmitter } = require("node:events");

function harness(budgets = { retainedDispatchBytes: 1024 * 1024 * 1024, retainedDispatchBytesPerUser: 64 * 1024 * 1024 }) {
    const module = { exports: {} };
    const lifecycle = { state: "running", eventEmitter: new EventEmitter() };
    const timers = [];
    const errors = [];
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/gateway/util/SessionResume.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            TextEncoder,
            FinalizationRegistry,
            exports: module.exports,
            console: { error: (...args) => errors.push(args) },
            require: (name) => {
                if (name.endsWith("/ProcessLifecycle")) return { ProcessLifecycle: lifecycle };
                if (name.endsWith("/Config")) return { Config: { get: () => ({ limits: { gateway: budgets } }) } };
                throw Error(name);
            },
            setTimeout: (run, delay) => {
                const timer = {
                    run,
                    delay,
                    cancelled: false,
                    unreferenced: false,
                    unref() {
                        this.unreferenced = true;
                        return this;
                    },
                };
                timers.push(timer);
                return timer;
            },
            clearTimeout: (timer) => {
                if (timer) timer.cancelled = true;
            },
        },
    );
    return { api: module.exports, lifecycle, timers, errors };
}
const socket = (id = "session") => ({
    user_id: "owner",
    session_id: id,
    replayBuffer: [{ op: 0, s: 1 }],
});
async function stop(h) {
    h.lifecycle.state = "stopping";
    for (const listener of h.lifecycle.eventEmitter.listeners("stopping")) await listener();
}

test("gateway resume windows are unreferenced and expiry releases listeners once", async () => {
    const h = harness();
    const ws = socket();
    let released = 0;
    h.api.holdForResume(
        ws,
        async () => {
            released++;
        },
        1006,
    );
    assert.equal(h.api.resumableSockets.get(ws.session_id), ws);
    assert.equal(h.timers[0].delay, 90000);
    assert.equal(h.timers[0].unreferenced, true);
    assert.deepEqual(Array.from(ws.resumeBuffer), []);
    await h.timers[0].run();
    await stop(h);
    assert.equal(released, 1);
    assert.equal(h.api.resumableSockets.size, 0);
    assert.equal(ws.replayBuffer, undefined);
    assert.equal(ws.resumeBuffer, undefined);
});

test("gateway shutdown cancels resume windows and drains listener cleanup without admitting more windows", async () => {
    const h = harness();
    const a = socket("a");
    const b = socket("b");
    let finish;
    let released = 0;
    h.api.holdForResume(
        a,
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
        1006,
    );
    h.api.holdForResume(
        b,
        async () => {
            throw Error("synthetic cleanup failure");
        },
        1006,
    );
    let drained = false;
    const stopping = stop(h).then(() => {
        drained = true;
    });
    await new Promise(setImmediate);
    assert.equal(drained, false);
    assert.equal(h.api.resumableSockets.size, 0);
    assert.equal(
        h.timers.every((timer) => timer.cancelled),
        true,
    );
    assert.equal(a.resumeBuffer, undefined);
    assert.equal(a.replayBuffer, undefined);
    await h.api.holdForResume(
        socket("late"),
        async () => {
            released++;
        },
        1006,
    );
    assert.equal(h.timers.length, 2);
    assert.equal(released, 1);
    finish();
    await stopping;
    assert.equal(drained, true);
    assert.equal(h.errors.length, 1);
});

test("gateway replay overflow releases held listeners and cancels the orphaned timer", async () => {
    const h = harness();
    const ws = socket();
    let released = 0;
    h.api.holdForResume(
        ws,
        async () => {
            released++;
        },
        1006,
    );
    ws.resumeBuffer = Array.from({ length: h.api.MAX_RESUME_BUFFER }, () => ({ op: 0, s: 1 }));
    assert.equal(h.api.bufferForResume(ws, { op: 0, s: 2 }), true);
    await new Promise(setImmediate);
    assert.equal(h.api.resumableSockets.size, 0);
    assert.equal(ws.resumeBuffer, undefined);
    assert.equal(h.timers[0].cancelled, true);
    assert.equal(released, 1);
    await stop(h);
    assert.equal(released, 1);
});

test("a successfully resumed socket keeps its listener ownership during shutdown", async () => {
    const h = harness();
    const ws = socket();
    let released = 0;
    h.api.holdForResume(
        ws,
        async () => {
            released++;
        },
        1006,
    );
    h.api.resumableSockets.delete(ws.session_id);
    ws.resumedBy = socket("replacement");
    h.timers[0].cancelled = true;
    await stop(h);
    assert.equal(released, 0);
});

test("gateway shutdown also drains cleanup already started by an expired resume window", async () => {
    const h = harness();
    const ws = socket();
    let finish;
    let released = 0;
    h.api.holdForResume(
        ws,
        () => {
            released++;
            return new Promise((resolve) => {
                finish = resolve;
            });
        },
        1006,
    );
    const expired = h.timers[0].run();
    await new Promise(setImmediate);
    assert.equal(h.api.resumableSockets.size, 0);
    assert.equal(
        h.api.holdForResume(
            ws,
            async () => {
                released++;
            },
            1000,
        ),
        expired,
    );
    let drained = false;
    const stopping = stop(h).then(() => {
        drained = true;
    });
    await Promise.resolve();
    assert.equal(drained, false);
    finish();
    await expired;
    await stopping;
    assert.equal(drained, true);
    assert.equal(released, 1);
});

test("dispatch queues enforce bytes as well as counts and replay evicts old frames", () => {
    const { api } = harness();
    const queue = [];
    const frame = { op: 0, d: "x".repeat(100) };
    assert.equal(api.boundedDispatchPush(queue, frame, 10, 150), true);
    assert.equal(api.boundedDispatchPush(queue, frame, 10, 150), false);
    assert.equal(queue.length, 1);
    assert.equal(api.boundedDispatchPush(queue, { op: 0, d: "new" }, 10, 150, true), true);
    assert.equal(queue.length, 2);
    assert.equal(api.boundedDispatchPush(queue, { op: 0, d: "z".repeat(100) }, 10, 150, true), true);
    assert.equal(queue.length, 2);
    assert.equal(queue[0].d, "new");
    assert.equal(api.boundedDispatchPush(queue, { op: 0, d: "x".repeat(200) }, 10, 150, true), false);
});

const frame = (s, bytes = 200) => ({ op: 0, t: "MESSAGE_CREATE", s, d: "x".repeat(bytes) });
const live = (user, session) => ({ user_id: user, session_id: session });

test("replay buffers of one user share a per-user byte budget across sockets", () => {
    const { api } = harness({ retainedDispatchBytes: 1024 * 1024, retainedDispatchBytesPerUser: 1000 });
    const sockets = [live("heavy", "a"), live("heavy", "b"), live("heavy", "c")];
    for (let s = 1; s <= 30; s++) for (const ws of sockets) api.rememberDispatch(ws, frame(s));
    assert.ok(api.retainedDispatchBytes("heavy") <= 1000, `${api.retainedDispatchBytes("heavy")} bytes retained`);
    const other = live("quiet", "d");
    api.rememberDispatch(other, frame(1));
    assert.equal(other.replayBuffer.length, 1);
    assert.ok(api.retainedDispatchBytes() <= 1000 + api.retainedDispatchBytes("quiet"));
});

test("the instance budget caps replay bytes across all users", () => {
    const { api } = harness({ retainedDispatchBytes: 2000, retainedDispatchBytesPerUser: 1024 * 1024 });
    for (let user = 0; user < 20; user++) for (let s = 1; s <= 5; s++) api.rememberDispatch(live(`user${user}`, `s${user}`), frame(s));
    assert.ok(api.retainedDispatchBytes() <= 2000, `${api.retainedDispatchBytes()} bytes retained`);
});

test("evicted replay frames are recorded so a resume can't skip them", () => {
    const { api } = harness({ retainedDispatchBytes: 1024 * 1024, retainedDispatchBytesPerUser: 700 });
    const ws = live("owner", "a");
    for (let s = 1; s <= 10; s++) api.rememberDispatch(ws, frame(s));
    const oldest = ws.replayBuffer[0].s;
    assert.ok(oldest > 1);
    assert.equal(api.droppedThrough(ws.replayBuffer), oldest - 1);
    assert.equal(api.droppedThrough([]), -1);
});

test("closing a session for good returns its bytes to the budget", () => {
    const { api } = harness();
    const ws = live("owner", "a");
    for (let s = 1; s <= 5; s++) api.rememberDispatch(ws, frame(s));
    assert.ok(api.retainedDispatchBytes("owner") > 0);
    api.holdForResume(ws, async () => {}, 1000);
    assert.equal(ws.replayBuffer, undefined);
    assert.equal(api.retainedDispatchBytes("owner"), 0);
    assert.equal(api.retainedDispatchBytes(), 0);
});

test("a held session that would pass its user's budget is released instead of growing", async () => {
    const { api } = harness({ retainedDispatchBytes: 1024 * 1024, retainedDispatchBytesPerUser: 1000 });
    const ws = live("owner", "a");
    let released = 0;
    api.holdForResume(
        ws,
        async () => {
            released++;
        },
        1006,
    );
    let s = 1;
    while (ws.resumeBuffer) assert.equal(api.bufferForResume(ws, frame(s++)), true);
    await new Promise(setImmediate);
    assert.ok(s <= 6, `${s - 1} frames were held`);
    assert.equal(released, 1);
    assert.equal(api.resumableSockets.size, 0);
    assert.equal(api.retainedDispatchBytes("owner"), 0);
});

test("releasing buffers directly also returns their bytes", () => {
    const { api } = harness();
    const ws = live("owner", "a");
    api.rememberDispatch(ws, frame(1));
    api.releaseDispatchBuffers(ws);
    assert.equal(ws.replayBuffer, undefined);
    assert.equal(api.retainedDispatchBytes(), 0);
});
