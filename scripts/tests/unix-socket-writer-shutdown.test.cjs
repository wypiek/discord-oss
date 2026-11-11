const { test } = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const turn = () => new Promise((resolve) => setImmediate(resolve));

function fixture(files = ["one.sock"]) {
    const lifecycle = { shutdownRequested: false, eventEmitter: new EventEmitter() };
    const identities = new Map(files.map((file, index) => [file, index + 1]));
    const sockets = [];
    const timers = [];
    const writes = [];
    let buffered = false;
    let removals = 0;
    const watcher = new EventEmitter();
    watcher.closed = 0;
    watcher.close = () => {
        watcher.closed++;
    };
    watcher.unref = () => watcher;
    let watched;
    const metric = {
        labels: () => ({ set() {} }),
        remove: () => {
            removals++;
        },
    };
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/util/util/ipc/writer/UnixSocketWriter.ts", "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
            },
        }).outputText,
        {
            module,
            exports: module.exports,
            Buffer,
            console: { log() {}, error() {} },
            setTimeout(run, delay) {
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
            clearTimeout(timer) {
                if (timer) timer.cancelled = true;
            },
            require(name) {
                if (name === "node:net")
                    return {
                        createConnection(fullPath) {
                            const socket = new EventEmitter();
                            socket.connecting = true;
                            socket.destroyed = false;
                            socket.fullPath = fullPath;
                            socket.destroy = () => {
                                socket.destroyed = true;
                                socket.emit("close");
                            };
                            socket.connect = () => {
                                socket.connecting = false;
                                socket.emit("connect");
                            };
                            socket.write = (frame, callback) => {
                                const entry = { socket, frame, callback };
                                writes.push(entry);
                                if (!buffered) queueMicrotask(() => callback());
                                return !buffered;
                            };
                            sockets.push(socket);
                            return socket;
                        },
                    };
                if (name === "node:fs")
                    return {
                        statSync(fullPath) {
                            if (fullPath === "owned") return { isDirectory: () => true };
                            const inode = identities.get(require("node:path").basename(fullPath));
                            if (!inode) throw new Error("owned missing path");
                            return { dev: 1, ino: inode, isSocket: () => true };
                        },
                        readdirSync: () => [...identities.keys()],
                        watch(dir, callback) {
                            watched = callback;
                            return watcher;
                        },
                        unlinkSync() {
                            throw new Error("writer must not delete listener paths");
                        },
                    };
                if (name === "node:path") return require(name);
                if (name === "prom-client") return { Gauge: class {} };
                if (name.endsWith("ProcessLifecycle")) return { ProcessLifecycle: lifecycle };
                if (name.endsWith("BaseEventWriter")) return { BaseEventWriter: class {} };
                if (name.endsWith("Monitoring")) return { Monitoring: { attachMetric: () => metric } };
                return {};
            },
        },
    );
    return {
        writer: new module.exports.UnixSocketWriter("owned"),
        lifecycle,
        identities,
        sockets,
        timers,
        writes,
        watcher,
        rename: (file) => watched("rename", file),
        change: (file) => watched("change", file),
        buffer: () => {
            buffered = true;
        },
        removals: () => removals,
    };
}
const event = (sequence) => ({
    event: "MESSAGE_CREATE",
    user_id: "owned-route",
    data: { sequence },
});
const sequence = (write) => JSON.parse(write.frame.subarray(4).toString()).event.data.sequence;

async function stop(h) {
    h.lifecycle.shutdownRequested = true;
    h.lifecycle.eventEmitter.emit("shutdownRequested");
    for (const callback of h.lifecycle.eventEmitter.listeners("stopping")) await callback();
}

test("unix writer coalesces initialization and settles successful connection work", async () => {
    const h = fixture();
    await Promise.all([h.writer.init(), h.writer.init()]);
    h.rename("one.sock");
    assert.equal(h.sockets.length, 1);
    assert.equal(h.lifecycle.eventEmitter.listenerCount("stopped"), 1);
    h.sockets[0].connect();
    await turn();
    assert.equal(h.writer.connections.size, 0);
    await h.writer.emit(event(1));
    assert.deepEqual(h.writes.map(sequence), [1]);
    await h.writer.close();
    await h.writer.close();
    assert.equal(h.removals(), 1);
    assert.equal(h.watcher.closed, 1);
});

test("unix writer cancels an unreferenced failed-connect retry on close", async () => {
    const h = fixture();
    await h.writer.init();
    h.sockets[0].emit("error", new Error("owned refusal"));
    h.sockets[0].destroy();
    await turn();
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].unreferenced, true);
    await h.writer.close();
    h.timers[0].run();
    h.rename("one.sock");
    await h.writer.init();
    await turn();
    assert.equal(h.timers[0].cancelled, true);
    assert.equal(h.sockets.length, 1);
    assert.equal(h.writer.connections.size, 0);
    assert.equal(Object.keys(h.writer.clients).length, 0);
});

test("unix writer settles an unfinished handshake when shutdown is requested", async () => {
    const h = fixture();
    await h.writer.init();
    await stop(h);
    assert.equal(h.sockets[0].destroyed, true);
    assert.equal(h.writer.connections.size, 0);
    await h.writer.close();
});

test("unix writer ignores stale socket callbacks after a path replacement", async () => {
    const h = fixture();
    await h.writer.init();
    const old = h.sockets[0];
    old.connect();
    await turn();
    h.identities.set("one.sock", 2);
    h.rename("one.sock");
    const replacement = h.sockets[1];
    replacement.connect();
    await turn();
    old.emit("error", new Error("late owned error"));
    old.emit("close");
    assert.equal(h.writer.clients["owned/one.sock"], replacement);
    await h.writer.emit(event(2));
    assert.equal(h.writes.at(-1).socket, replacement);
    await h.writer.close();
});

test("unix writer automatically replays queued events once when listeners connect", async () => {
    const h = fixture(["one.sock", "two.sock"]);
    await h.writer.emit(event(1));
    await h.writer.emit(event(2));
    await h.writer.init();
    for (const socket of h.sockets) socket.connect();
    await turn();
    await h.writer.emit(event(3));
    for (const socket of h.sockets) assert.deepEqual(h.writes.filter((write) => write.socket === socket).map(sequence), [1, 2, 3]);
    assert.equal(h.writer.backlog.length, 0);
    assert.equal(h.lifecycle.eventEmitter.listenerCount("stopped"), 1);
    await h.writer.close();
});

test("unix writer drains accepted writes before destroying sockets and rejects later admission", async () => {
    const h = fixture();
    await h.writer.init();
    h.sockets[0].connect();
    await turn();
    h.buffer();
    const publication = h.writer.emit(event(1));
    await turn();
    const closing = h.writer.close();
    await turn();
    assert.equal(h.sockets[0].destroyed, false);
    assert.equal(h.writes.length, 1);
    await assert.rejects(h.writer.emit(event(2)), /closing/);
    h.writes[0].callback();
    await publication;
    await closing;
    assert.equal(h.sockets[0].destroyed, true);
    assert.equal(h.sockets[0].listenerCount("error"), 1);
    assert.equal(h.sockets[0].listenerCount("close"), 1);
});

test("unix writer keeps established sockets available for stopping publications", async () => {
    const h = fixture();
    await h.writer.init();
    h.sockets[0].connect();
    await turn();
    await stop(h);
    await h.writer.emit(event(1));
    assert.equal(h.sockets[0].destroyed, false);
    assert.deepEqual(h.writes.map(sequence), [1]);
    await h.writer.close();
});

test("unix writer retries a lost connection once and cancels that wait on shutdown", async () => {
    const h = fixture();
    await h.writer.init();
    h.sockets[0].connect();
    await turn();
    h.sockets[0].destroy();
    await turn();
    h.rename("one.sock");
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].delay, 1000);
    await stop(h);
    h.timers[0].run();
    await turn();
    assert.equal(h.sockets.length, 1);
    await h.writer.close();
});

test("unix writer discovers a listener created after initialization through change notifications", async () => {
    const h = fixture([]);
    await h.writer.init();
    await h.writer.emit(event(1));
    h.identities.set("late.sock", 1);
    h.change("late.sock");
    h.change("late.sock");
    assert.equal(h.sockets.length, 1);
    h.sockets[0].connect();
    await turn();
    assert.deepEqual(h.writes.map(sequence), [1]);
    assert.equal(h.writer.backlog.length, 0);
    await h.writer.close();
});

test("unix offline backlog bounds accepted events and releases all capacity on close", async () => {
    const h = fixture([]);
    await h.writer.init();
    for (let id = 0; id < 1024; id++) await h.writer.emit(event(id));
    const bytes = h.writer.queuedBytes;
    await assert.rejects(h.writer.emit(event(1024)), (error) => error.code === "IPC_QUEUE_FULL");
    assert.equal(h.writer.backlog.length, 1024);
    assert.equal(h.writer.reserved.size, 1024);
    assert.equal(h.writer.queuedBytes, bytes);
    await h.writer.close();
    assert.equal(h.writer.backlog.length, 0);
    assert.equal(h.writer.reserved.size, 0);
    assert.equal(h.writer.queuedBytes, 0);
});

test("unix queue accounts for UTF-8 framed bytes and rejects a frame larger than its byte budget", async () => {
    const h = fixture([]);
    const payload = "é".repeat(1024 * 1024);
    for (let id = 0; id < 7; id++) await h.writer.emit({ ...event(id), data: { sequence: id, payload } });
    const bytes = h.writer.queuedBytes;
    assert.equal(
        bytes,
        h.writer.backlog.reduce((total, frame) => total + frame.length, 0),
    );
    assert.ok(bytes <= 16 * 1024 * 1024);
    await assert.rejects(h.writer.emit({ ...event(8), data: { payload } }), (error) => error.code === "IPC_QUEUE_FULL");
    assert.equal(h.writer.queuedBytes, bytes);
    await h.writer.close();
    const other = fixture([]);
    await assert.rejects(other.writer.emit({ ...event(1), data: { payload: "😀".repeat(4 * 1024 * 1024) } }), (error) => error.code === "IPC_QUEUE_FULL");
    assert.equal(other.writer.reserved.size, 0);
    assert.equal(other.writer.queuedBytes, 0);
    await other.writer.close();
});

test("unix pending and active publications share the event budget and resume admission after completion", async () => {
    const h = fixture();
    await h.writer.init();
    h.sockets[0].connect();
    await turn();
    h.buffer();
    const accepted = Array.from({ length: 1024 }, (_, id) => h.writer.emit(event(id)));
    await assert.rejects(h.writer.emit(event(1024)), (error) => error.code === "IPC_QUEUE_FULL");
    await turn();
    assert.equal(h.writes.length, 1);
    assert.equal(h.writer.reserved.size, 1024);
    h.writes[0].callback();
    await turn();
    const resumed = h.writer.emit(event(1025));
    for (let id = 1; id < 1025; id++) {
        while (h.writes.length <= id) await turn();
        h.writes[id].callback();
        await turn();
    }
    await Promise.all([...accepted, resumed]);
    assert.deepEqual(h.writes.map(sequence), [...Array.from({ length: 1024 }, (_, id) => id), 1025]);
    assert.equal(h.writer.reserved.size, 0);
    assert.equal(h.writer.queuedBytes, 0);
    await h.writer.close();
});

test("unix admission snapshots events and malformed serialization leaves accepted backlog intact", async () => {
    const h = fixture([]);
    await h.writer.init();
    const payload = event(1);
    await h.writer.emit(payload);
    payload.data.sequence = 99;
    const bad = event(2);
    bad.data.loop = bad;
    await assert.rejects(h.writer.emit(bad));
    assert.equal(h.writer.backlog.length, 1);
    assert.equal(h.writer.reserved.size, 1);
    h.identities.set("late.sock", 1);
    h.change("late.sock");
    h.sockets[0].connect();
    await turn();
    assert.deepEqual(h.writes.map(sequence), [1]);
    assert.equal(h.writer.reserved.size, 0);
    assert.equal(h.writer.queuedBytes, 0);
    await h.writer.close();
});

test("unix simultaneous listener connections coalesce one backlog replay without unbounded control publications", async () => {
    const h = fixture(Array.from({ length: 128 }, (_, id) => `${id}.sock`));
    await h.writer.emit(event(1));
    await h.writer.init();
    for (const socket of h.sockets) socket.connect();
    assert.equal(h.writer.publishing.size, 1);
    await turn();
    assert.equal(h.writes.length, 128);
    assert.ok(h.writes.every((write) => sequence(write) === 1));
    assert.equal(h.writer.reserved.size, 0);
    assert.equal(h.writer.queuedBytes, 0);
    await h.writer.close();
});

test("unix shutdown without peers rejects later publications without retaining their reserved frames", async () => {
    const h = fixture([]);
    await h.writer.init();
    await h.writer.emit(event(1));
    await stop(h);
    const bytes = h.writer.queuedBytes;
    await assert.rejects(h.writer.emit(event(2)), /no connected listeners/);
    assert.equal(h.writer.queuedBytes, bytes);
    assert.equal(h.writer.reserved.size, 1);
    await h.writer.close();
    assert.equal(h.writer.reserved.size, 0);
    assert.equal(h.writer.queuedBytes, 0);
});
