const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { EventEmitter } = require("node:events");

function harness({ startup, worker = false, shutdown = async () => {}, workers = {} } = {}) {
    const module = { exports: {} };
    const process = new EventEmitter();
    const timers = [];
    const calls = [];
    const errors = [];
    process.connected = worker;
    process.disconnect = () => calls.push("disconnect");
    process.exit = (code) => calls.push(["exit", code]);
    const lifecycle = {
        shutdownRequested: false,
        requestShutdown() {
            this.shutdownRequested = true;
        },
        Shutdown: async () => {
            calls.push("shutdown");
            await shutdown();
        },
        Finalize: async () => calls.push("finalize"),
    };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/bundle/Shutdown.ts", "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
            },
        }).outputText,
        {
            module,
            exports: module.exports,
            process,
            console: { error: (...args) => errors.push(args) },
            require: (name) => {
                if (name === "node:cluster") return { isWorker: worker, workers };
                if (name.endsWith("/ProcessLifecycle")) return { ProcessLifecycle: lifecycle };
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
                timer.cancelled = true;
            },
        },
    );
    return {
        api: module.exports,
        process,
        timers,
        calls,
        errors,
        lifecycle,
        startup: startup ?? (() => Promise.resolve()),
    };
}
const tick = () => new Promise(setImmediate);

test("signals wait for startup, coalesce repeated requests and finalize only after draining", async () => {
    let started, drained;
    const h = harness({
        startup: () =>
            new Promise((resolve) => {
                started = resolve;
            }),
        shutdown: () =>
            new Promise((resolve) => {
                drained = resolve;
            }),
    });
    h.api.installShutdownSignals(h.startup);
    h.process.emit("SIGTERM");
    assert.equal(h.lifecycle.shutdownRequested, true);
    h.process.emit("SIGINT");
    await tick();
    assert.deepEqual(h.calls, []);
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].unreferenced, true);
    started();
    await tick();
    assert.deepEqual(h.calls, ["shutdown"]);
    drained();
    await tick();
    assert.deepEqual(h.calls, ["shutdown", "finalize"]);
    h.process.emit("exit");
    assert.equal(h.timers[0].cancelled, true);
});

test("a failed startup still cleans up and a worker disconnects after finalization", async () => {
    const h = harness({
        startup: async () => {
            throw Error("synthetic startup failure");
        },
        worker: true,
    });
    h.api.installShutdownSignals(h.startup);
    h.process.emit("SIGINT");
    await tick();
    assert.deepEqual(h.calls, ["shutdown", "finalize", "disconnect"]);
    assert.equal(h.errors.length, 1);
});

test("signal deadlines fail with status one even when startup has never settled", async () => {
    const h = harness({ startup: () => new Promise(() => {}) });
    h.api.installShutdownSignals(h.startup);
    h.process.emit("SIGTERM");
    await tick();
    assert.equal(h.timers[0].delay, 30000);
    h.timers[0].run();
    assert.deepEqual(h.calls, [["exit", 1]]);
});

test("the cluster supervisor enters stopping before forwarding signals and never forwards twice", () => {
    const signals = [];
    const h = harness({
        workers: { 1: { process: { kill: (signal) => signals.push(signal) } }, 2: undefined },
    });
    const isStopping = h.api.installClusterShutdownSignals();
    assert.equal(isStopping(), false);
    h.process.emit("SIGINT");
    h.process.emit("SIGTERM");
    assert.equal(isStopping(), true);
    assert.deepEqual(signals, ["SIGTERM"]);
    assert.equal(h.timers[0].unreferenced, true);
    h.timers[0].run();
    assert.deepEqual(h.calls, [["exit", 1]]);
});
