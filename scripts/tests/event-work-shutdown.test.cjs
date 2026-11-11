const { test } = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const load = require("./event-work-fixture.cjs");
const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => (resolve = done));
    return { promise, resolve };
};

test("event work has no lifecycle hooks until callback dispatch", async () => {
    const lifecycle = { eventEmitter: new EventEmitter() };
    const { EventWork } = load(lifecycle);
    const work = new EventWork();
    assert.equal(lifecycle.eventEmitter.listenerCount("draining"), 0);
    work.run(() => {});
    work.run(() => {});
    assert.equal(lifecycle.eventEmitter.listenerCount("draining"), 1);
});

test("final drain includes nested accepted work and refuses unrelated late callbacks", async () => {
    const lifecycle = { eventEmitter: new EventEmitter() };
    const { EventWork } = load(lifecycle);
    const first = new EventWork();
    const second = new EventWork();
    const outer = deferred();
    const inner = deferred();
    const calls = [];
    first.run(async () => {
        await outer.promise;
        second.run(async () => {
            calls.push("nested");
            await inner.promise;
            calls.push("finished");
        });
    });
    let drained = false;
    const draining = lifecycle.eventEmitter
        .listeners("draining")[0]()
        .then(() => (drained = true));
    first.run(() => calls.push("late"));
    outer.resolve();
    await turn();
    assert.deepEqual(calls, ["nested"]);
    assert.equal(drained, false);
    inner.resolve();
    await draining;
    assert.deepEqual(calls, ["nested", "finished"]);
});

test("closing one scope waits for accepted work while other scopes remain open", async () => {
    const { EventWork } = load({ eventEmitter: new EventEmitter() });
    const first = new EventWork();
    const second = new EventWork();
    const held = deferred();
    let finished = false;
    first.run(() => held.promise);
    const closing = first.close().then(() => (finished = true));
    first.run(() => assert.fail("closed scope admitted unrelated callback"));
    let other = false;
    second.run(() => (other = true));
    await turn();
    assert.equal(other, true);
    assert.equal(finished, false);
    held.resolve();
    await closing;
});

test("settled callback contexts cannot admit late work and callback failures stay isolated", async () => {
    const lifecycle = { eventEmitter: new EventEmitter() };
    const errors = [];
    const { EventWork } = load(lifecycle, errors);
    const work = new EventWork();
    const held = deferred();
    let late;
    work.run(async () => {
        late = () => work.run(() => assert.fail("settled context admitted callback"));
        held.promise.then(late);
    });
    work.run(() => {
        throw new Error("private event details");
    });
    work.run(async () => {
        throw new Error("private event details");
    });
    await turn();
    await lifecycle.eventEmitter.listeners("draining")[0]();
    held.resolve();
    await turn();
    assert.equal(errors.length, 2);
    assert.equal(JSON.stringify(errors).includes("private"), false);
});

function eventFixture(mode) {
    const fs = require("node:fs");
    const vm = require("node:vm");
    const ts = require("typescript");
    const lifecycle = { eventEmitter: new EventEmitter() };
    const eventWork = load(lifecycle);
    const fakeProcess = Object.assign(new EventEmitter(), { env: { EVENT_TRANSMISSION: mode } });
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/util/util/ipc/Event.ts", "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
            },
        }).outputText,
        {
            module,
            exports: module.exports,
            process: fakeProcess,
            console,
            require: (name) => {
                if (name.startsWith("node:")) return require(name);
                if (name === "./EventWork") return eventWork;
                if (name === "./RabbitMQ") return { RabbitMQ: {} };
                if (name === "./BackgroundWork") return { trackBackground: (work) => work };
                return {};
            },
        },
    );
    return { ...module.exports, lifecycle, fakeProcess };
}

for (const mode of ["local", "process"])
    test(`${mode} event dispatch drains accepted callback promises before cleanup`, async () => {
        const h = eventFixture(mode);
        const held = deferred();
        let completed = false;
        const cancel = await h.listenEvent("owned", async () => {
            await held.promise;
            completed = true;
        });
        if (mode === "local") h.events.emit("owned", { event: "MESSAGE_CREATE" });
        else
            h.fakeProcess.emit("message", {
                type: "event",
                id: "owned",
                event: { event: "MESSAGE_CREATE" },
            });
        let drained = false;
        const draining = h.lifecycle.eventEmitter
            .listeners("draining")[0]()
            .then(() => (drained = true));
        await turn();
        assert.equal(drained, false);
        held.resolve();
        await draining;
        assert.equal(completed, true);
        await cancel();
    });

test("emit hooks preserve deferred scheduling and participate in final callback drain", async () => {
    const h = eventFixture("local");
    const held = deferred();
    const order = [];
    h.onEmitEvent(async () => {
        order.push("hook");
        await held.promise;
        order.push("finished");
    });
    const emitting = h.emitEvent({ event: "MESSAGE_CREATE", channel_id: "owned" });
    order.push("caller");
    await emitting;
    assert.deepEqual(order, ["caller", "hook"]);
    let drained = false;
    const draining = h.lifecycle.eventEmitter
        .listeners("draining")[0]()
        .then(() => (drained = true));
    await turn();
    assert.equal(drained, false);
    held.resolve();
    await draining;
    assert.deepEqual(order, ["caller", "hook", "finished"]);
});
