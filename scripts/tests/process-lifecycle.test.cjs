const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function fixture() {
    const module = { exports: {} };
    const deadlines = [];
    const exits = [];
    const errors = [];
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/util/util/ProcessLifecycle.ts", "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
            },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) => {
                if (name === "node:events" || name === "node:async_hooks") return require(name);
                if (name === "node-unix-socket") return {};
                throw Error(name);
            },
            process: { env: {}, on() {}, exit: (code) => exits.push(code) },
            console: { log() {}, error: (...args) => errors.push(args) },
            setTimeout: (run, delay) => {
                const timer = {
                    run,
                    delay,
                    unreferenced: false,
                    unref() {
                        this.unreferenced = true;
                    },
                };
                deadlines.push(timer);
                return timer;
            },
        },
    );
    return { ...module.exports, deadlines, exits, errors };
}

test("shutdown listeners can stop component servers without recursively dispatching lifecycle events", async () => {
    const { ProcessLifecycle: lifecycle, SystemdLifecycle: systemd } = fixture();
    let notifications = 0;
    const events = [];
    systemd.sendStopping = async () => {
        notifications++;
        assert.equal(lifecycle.state, "stopping");
        await lifecycle.Shutdown();
    };
    lifecycle.eventEmitter.on("stopping", async () => {
        events.push("gateway");
        await lifecycle.Shutdown();
        await lifecycle.Finalize();
    });
    lifecycle.eventEmitter.on("stopping", async () => events.push("api"));
    lifecycle.eventEmitter.on("stopped", async () => {
        events.push("database");
        await lifecycle.Finalize();
    });
    await lifecycle.Shutdown();
    await lifecycle.Shutdown();
    await lifecycle.Finalize();
    assert.equal(notifications, 1);
    assert.deepEqual(events, ["gateway", "api", "database"]);
    assert.equal(lifecycle.state, "stopped");
});

test("concurrent shutdown requests dispatch stopping listeners once", async () => {
    const { ProcessLifecycle: lifecycle, SystemdLifecycle: systemd } = fixture();
    let release;
    let calls = 0;
    systemd.sendStopping = () =>
        new Promise((resolve) => {
            release = resolve;
        });
    lifecycle.eventEmitter.on("stopping", () => calls++);
    const first = lifecycle.Shutdown();
    await lifecycle.Shutdown();
    assert.equal(calls, 0);
    release();
    await first;
    assert.equal(calls, 1);
});

test("shutdown keeps one unreferenced 30-second exit deadline while notification or cleanup stalls", async () => {
    const h = fixture();
    h.SystemdLifecycle.sendStopping = () => new Promise(() => {});
    h.ProcessLifecycle.Shutdown();
    await h.ProcessLifecycle.Shutdown();
    assert.equal(h.deadlines.length, 1);
    assert.equal(h.deadlines[0].delay, 30_000);
    assert.equal(h.deadlines[0].unreferenced, true);
    assert.deepEqual(h.exits, []);
    h.deadlines[0].run();
    assert.deepEqual(h.exits, [1]);
    assert.equal(h.errors.length, 1);
});

test("completed cleanup retains the unreferenced deadline for otherwise leaked process handles", async () => {
    const h = fixture();
    await h.ProcessLifecycle.Shutdown();
    await h.ProcessLifecycle.Finalize();
    assert.equal(h.ProcessLifecycle.state, "stopped");
    assert.deepEqual(h.exits, []);
    assert.equal(h.deadlines.length, 1);
    h.deadlines[0].run();
    assert.deepEqual(h.exits, [1]);
});

test("a cleaned child process exits naturally without waiting for its shutdown deadline", { timeout: 5000 }, () => {
    const { spawnSync } = require("node:child_process");
    const path = require("node:path");
    const lifecyclePath = path.resolve(__dirname, "../../dist/util/util/ProcessLifecycle.js");
    const source = `const { ProcessLifecycle } = require(${JSON.stringify(lifecyclePath)}); await ProcessLifecycle.Shutdown(); await ProcessLifecycle.Finalize();`;
    const child = spawnSync(process.execPath, ["-e", source], {
        env: { ...process.env, NOTIFY_SOCKET: "", TRACE_ACTIVE_HANDLES: "" },
        encoding: "utf8",
        timeout: 4000,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
});

test("a requested shutdown suppresses startup readiness and cannot return a stopped process to running", async () => {
    const { ProcessLifecycle: lifecycle, SystemdLifecycle: systemd } = fixture();
    let ready = 0;
    lifecycle.eventEmitter.on("running", () => ready++);
    systemd.sendReady = async () => ready++;
    lifecycle.shutdownRequested = true;
    await lifecycle.Ready();
    assert.equal(lifecycle.state, "starting");
    assert.equal(ready, 0);
    await lifecycle.Shutdown();
    await lifecycle.Finalize();
    await lifecycle.Ready();
    assert.equal(lifecycle.state, "stopped");
    assert.equal(ready, 0);
});

test("a shutdown requested by a running listener suppresses the systemd readiness notification", async () => {
    const { ProcessLifecycle: lifecycle, SystemdLifecycle: systemd } = fixture();
    let ready = 0;
    systemd.sendReady = async () => ready++;
    lifecycle.eventEmitter.on("running", async () => {
        await lifecycle.Shutdown();
        await lifecycle.Finalize();
    });
    await lifecycle.Ready();
    assert.equal(lifecycle.state, "stopped");
    assert.equal(ready, 0);
});

test("shutdown requests notify cancellation once before lifecycle drain", async () => {
    const { ProcessLifecycle: lifecycle } = fixture();
    const states = [];
    lifecycle.eventEmitter.on("shutdownRequested", () => states.push(lifecycle.state));
    lifecycle.requestShutdown();
    lifecycle.requestShutdown();
    assert.equal(lifecycle.shutdownRequested, true);
    assert.deepEqual(states, ["starting"]);
    await lifecycle.Shutdown();
    assert.deepEqual(states, ["starting"]);
    await lifecycle.Finalize();
});

test("finalization drains before cleanup and coalesces concurrent callers without recursive deadlock", async () => {
    const { ProcessLifecycle: lifecycle } = fixture();
    let release;
    const held = new Promise((resolve) => (release = resolve));
    const order = [];
    lifecycle.eventEmitter.on("draining", async () => {
        order.push("draining");
        await lifecycle.Finalize();
        await held;
        order.push("drained");
    });
    lifecycle.eventEmitter.on("stopped", () => order.push("database"));
    await lifecycle.Shutdown();
    const first = lifecycle.Finalize();
    const second = lifecycle.Finalize();
    assert.equal(first, second);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(order, ["draining"]);
    assert.equal(lifecycle.state, "draining");
    release();
    await second;
    assert.deepEqual(order, ["draining", "drained", "database"]);
});
