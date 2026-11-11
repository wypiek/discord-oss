const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const EventEmitter = require("node:events");
const turn = () => new Promise((resolve) => setImmediate(resolve));

function fixture({ ready = true, close = true, existing } = {}) {
    const files = new Map();
    if (existing) files.set("owned/alias.sock", existing);
    const lifecycle = { shutdownRequested: false, eventEmitter: new EventEmitter() };
    const servers = [];
    const probes = [];
    const unlinked = [];
    const removals = [];
    const metrics = [];
    const timers = [];
    let inode = 100;
    const error = (code) => Object.assign(new Error("owned fixture error"), { code });
    const socket = () => {
        const client = new EventEmitter();
        client.destroyed = false;
        client.destroy = () => {
            if (!client.destroyed) {
                client.destroyed = true;
                client.emit("close");
            }
        };
        return client;
    };
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/util/util/ipc/listener/UnixSocketListener.ts", "utf8"), {
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
            console: { error() {} },
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
                if (name === "node:events" || name === "node:path" || name === "node:crypto") return require(name);
                if (name === "node:fs")
                    return {
                        lstatSync(file) {
                            const stat = files.get(file);
                            if (!stat) throw error("ENOENT");
                            return { dev: 1n, ino: BigInt(stat.inode), isSocket: () => stat.socket !== false };
                        },
                        linkSync(source, target) {
                            if (files.has(target)) throw error("EEXIST");
                            files.set(target, files.get(source));
                        },
                        unlinkSync(file) {
                            if (!files.delete(file)) throw error("ENOENT");
                            unlinked.push(file);
                        },
                    };
                if (name === "node:net")
                    return {
                        createConnection() {
                            const client = socket();
                            probes.push(client);
                            return client;
                        },
                        createServer(accept) {
                            const server = new EventEmitter();
                            server.accept = accept;
                            server.listen = (file) => {
                                server.file = file;
                                files.set(file, { inode: ++inode });
                                if (ready) queueMicrotask(() => server.emit("listening"));
                            };
                            server.close = (callback) => {
                                server.closed = true;
                                files.delete(server.file);
                                server.completeClose = callback;
                                if (close) queueMicrotask(callback);
                            };
                            servers.push(server);
                            return server;
                        },
                    };
                if (name === "prom-client")
                    return {
                        Gauge: class {
                            constructor() {
                                this.sets = [];
                                metrics.push(this);
                            }
                            labels() {
                                return { set: (value) => this.sets.push(value) };
                            }
                            remove(labels) {
                                removals.push(labels.path);
                            }
                        },
                    };
                if (name === "@spacebar/extensions") return { arraySum: (values) => values.reduce((a, b) => a + b, 0) };
                if (name.endsWith("EventWork")) return require("./event-work-fixture.cjs")(lifecycle);
                if (name.endsWith("ProcessLifecycle")) return { ProcessLifecycle: lifecycle };
                if (name.endsWith("BaseEventListener")) return { BaseEventListener: class {} };
                if (name.endsWith("Monitoring")) return { Monitoring: { attachMetric: (name, metric) => metric } };
                return {};
            },
        },
    );
    return {
        listener: new module.exports.UnixSocketListener("owned/alias.sock"),
        files,
        lifecycle,
        servers,
        probes,
        unlinked,
        removals,
        metrics,
        timers,
        socket,
        error,
    };
}
const frame = (sequence) => {
    const payload = Buffer.from(JSON.stringify({ id: "owned-route", event: { event: "MESSAGE_CREATE", data: { sequence } } }));
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length);
    return Buffer.concat([header, payload]);
};

test("unix listener coalesces startup and waits for listening before creating its discovery path", async () => {
    const h = fixture({ ready: false });
    const starting = h.listener.init();
    assert.equal(h.listener.init(), starting);
    await turn();
    assert.equal(h.listener.isInitialized, false);
    assert.equal(h.files.has("owned/alias.sock"), false);
    h.servers[0].emit("listening");
    await starting;
    assert.equal(h.listener.isInitialized, true);
    assert.equal(h.files.get("owned/alias.sock"), h.files.get(h.servers[0].file));
    assert.equal(h.lifecycle.eventEmitter.listenerCount("stopped"), 1);
    await h.listener.close();
});

test("unix listener counts accepted connections and dispatches fragmented and consecutive frames", async () => {
    const h = fixture();
    const received = [];
    await h.listener.listen("owned-route", (event) => received.push(event.data.sequence));
    await h.listener.init();
    const peer = h.socket();
    h.servers[0].accept(peer);
    assert.equal(h.metrics[0].sets.at(-1), 1);
    const data = Buffer.concat([frame(1), frame(2)]);
    peer.emit("data", data.subarray(0, 2));
    assert.deepEqual(received, []);
    peer.emit("data", data.subarray(2));
    assert.deepEqual(received, [1, 2]);
    peer.destroy();
    assert.equal(h.metrics[0].sets.at(-1), 0);
    await h.listener.close();
});

test("unix listener closes held clients and awaits native close before removing both metrics", async () => {
    const h = fixture({ close: false });
    const received = [];
    await h.listener.listen("owned-route", (event) => received.push(event.data.sequence));
    await h.listener.init();
    const peer = h.socket();
    h.servers[0].accept(peer);
    const closing = h.listener.close();
    assert.equal(h.listener.close(), closing);
    await turn();
    assert.equal(peer.destroyed, true);
    assert.equal(h.removals.length, 0);
    peer.emit("data", frame(1));
    assert.deepEqual(received, []);
    h.servers[0].completeClose();
    await closing;
    assert.equal(h.removals.length, 2);
    assert.equal(h.listener.connections.size, 0);
    assert.equal(h.listener.eventEmitter.listenerCount("owned-route"), 0);
    assert.equal(h.files.size, 0);
});

test("unix listener preserves a replacement discovery path while native close removes its private path", async () => {
    const h = fixture();
    await h.listener.init();
    const replacement = { inode: 900, socket: false };
    h.files.set("owned/alias.sock", replacement);
    await h.listener.close();
    assert.equal(h.files.get("owned/alias.sock"), replacement);
    assert.equal(h.files.has(h.servers[0].file), false);
    assert.deepEqual(h.unlinked, []);
});

test("unix listener closes safely before initialization and rejects later subscriptions", async () => {
    const h = fixture();
    await h.listener.close();
    await h.listener.close();
    await h.listener.init();
    assert.equal(h.servers.length, 0);
    assert.equal(h.removals.length, 2);
    await assert.rejects(
        h.listener.listen("owned-route", () => {}),
        /closing/,
    );
});

test("unix listener close during pending startup waits for startup and leaves no alias", async () => {
    const h = fixture({ ready: false });
    const starting = h.listener.init();
    await turn();
    const closing = h.listener.close();
    h.servers[0].emit("listening");
    await starting;
    await closing;
    assert.equal(h.files.size, 0);
    assert.equal(h.listener.isInitialized, false);
});

test("unix listener cancellation is idempotent and cannot recreate metrics after cleanup", async () => {
    const h = fixture();
    const cancel = await h.listener.listen("owned-route", () => {});
    await h.listener.init();
    await h.listener.close();
    const sets = h.metrics[1].sets.length;
    await cancel();
    await cancel();
    assert.equal(h.metrics[1].sets.length, sets);
    assert.equal(h.listener.eventEmitter.getMaxListeners(), 10);
});

test("unix listener refuses an occupied discovery path without unlinking it", async () => {
    const existing = { inode: 20 };
    const h = fixture({ existing });
    const starting = h.listener.init();
    await turn();
    h.probes[0].emit("connect");
    await assert.rejects(starting, (error) => error.code === "EADDRINUSE");
    assert.equal(h.files.get("owned/alias.sock"), existing);
    assert.deepEqual(h.unlinked, []);
    await h.listener.close();
});

test("unix listener removes a refused stale socket only when its identity is unchanged", async () => {
    const h = fixture({ existing: { inode: 20 } });
    const starting = h.listener.init();
    await turn();
    h.probes[0].emit("error", h.error("ECONNREFUSED"));
    await starting;
    assert.deepEqual(h.unlinked, ["owned/alias.sock"]);
    assert.equal(h.listener.isInitialized, true);
    await h.listener.close();
});

test("unix listener preserves a path replaced during the stale socket probe", async () => {
    const h = fixture({ existing: { inode: 20 } });
    const starting = h.listener.init();
    await turn();
    const replacement = { inode: 21 };
    h.files.set("owned/alias.sock", replacement);
    h.probes[0].emit("error", h.error("ECONNREFUSED"));
    await assert.rejects(starting, (error) => error.code === "EEXIST");
    assert.equal(h.files.get("owned/alias.sock"), replacement);
    assert.deepEqual(h.unlinked, []);
    await h.listener.close();
});

test("unix listener close cancels a pending stale socket probe and its timeout", async () => {
    const h = fixture({ existing: { inode: 20 } });
    const starting = h.listener.init();
    await turn();
    assert.equal(h.timers[0].unreferenced, true);
    const closing = h.listener.close();
    await starting;
    await closing;
    assert.equal(h.timers[0].cancelled, true);
    assert.equal(h.servers.length, 0);
    assert.deepEqual(h.unlinked, []);
});

test("unix listener keeps established reception available until final cleanup", async () => {
    const h = fixture();
    const received = [];
    await h.listener.listen("owned-route", (event) => received.push(event.data.sequence));
    await h.listener.init();
    const peer = h.socket();
    h.servers[0].accept(peer);
    h.lifecycle.shutdownRequested = true;
    h.lifecycle.eventEmitter.emit("shutdownRequested");
    const late = h.socket();
    h.servers[0].accept(late);
    assert.equal(late.destroyed, true);
    peer.emit("data", frame(1));
    assert.deepEqual(received, [1]);
    for (const callback of h.lifecycle.eventEmitter.listeners("stopped")) await callback();
    peer.emit("data", frame(2));
    assert.deepEqual(received, [1]);
    assert.equal(peer.destroyed, true);
});

test("unix reader close waits for accepted asynchronous callbacks and isolates failures", async () => {
    const h = fixture();
    let release;
    const held = new Promise((resolve) => (release = resolve));
    let completed = false;
    let observed = 0;
    await h.listener.listen("owned-route", async () => {
        await held;
        completed = true;
    });
    await h.listener.listen("owned-route", () => {
        throw new Error("owned callback failure");
    });
    await h.listener.listen("owned-route", () => observed++);
    await h.listener.init();
    const peer = h.socket();
    h.servers[0].accept(peer);
    peer.emit("data", frame(1));
    assert.equal(observed, 1);
    let closed = false;
    const closing = h.listener.close().then(() => (closed = true));
    await turn();
    assert.equal(closed, false);
    assert.equal(completed, false);
    release();
    await closing;
    assert.equal(completed, true);
});
