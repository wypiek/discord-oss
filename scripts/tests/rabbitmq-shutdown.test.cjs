const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const EventEmitter = require("node:events");
const turn = () => new Promise((resolve) => setImmediate(resolve));

function connection() {
    const broker = new EventEmitter();
    const channel = new EventEmitter();
    broker.closes = 0;
    channel.closes = 0;
    channel.close = async () => {
        channel.closes++;
        channel.emit("close");
    };
    broker.close = async () => {
        broker.closes++;
        broker.emit("close");
    };
    broker.createChannel = async () => channel;
    return { broker, channel };
}

function fixture(connect, host = "amqp://127.0.0.1:59999") {
    const module = { exports: {} };
    const lifecycle = { shutdownRequested: false, eventEmitter: new EventEmitter() };
    const timers = [];
    const attempts = [];
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/util/util/ipc/RabbitMQ.ts", "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
            },
        }).outputText,
        {
            module,
            exports: module.exports,
            AbortController,
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
                if (name === "node:events") return EventEmitter;
                if (name === "node:crypto") return require(name);
                if (name === "amqplib")
                    return {
                        connect: async (host, options) => {
                            attempts.push(options);
                            return connect(attempts.length, options);
                        },
                    };
                if (name === "../Config") return { Config: { get: () => ({ rabbitmq: { host } }) } };
                if (name.endsWith("EventWork")) return require("./event-work-fixture.cjs")(lifecycle);
                if (name === "../ProcessLifecycle") return { ProcessLifecycle: lifecycle };
                return {};
            },
        },
    );
    return {
        api: module.exports.RabbitMQ,
        rabbitListen: module.exports.rabbitListen,
        lifecycle,
        timers,
        attempts,
    };
}

async function stop(h, finalize = false) {
    h.lifecycle.shutdownRequested = true;
    for (const listener of h.lifecycle.eventEmitter.listeners("stopping")) await listener();
    if (finalize) for (const listener of h.lifecycle.eventEmitter.listeners("stopped")) await listener();
}

test("RabbitMQ retries repeated failures with one unreferenced delay and shares startup", async () => {
    const c = connection();
    const h = fixture(async (attempt) => {
        if (attempt < 3) throw Error("broker unavailable");
        return c.broker;
    });
    const starts = [h.api.init(), h.api.init()];
    await turn();
    assert.equal(h.attempts.length, 1);
    assert.equal(h.timers.length, 1);
    assert.equal(h.timers[0].unreferenced, true);
    assert.equal(h.timers[0].delay, 500);
    h.timers[0].run();
    await turn();
    assert.equal(h.attempts.length, 2);
    assert.equal(h.timers.length, 2);
    h.timers[1].run();
    await Promise.all(starts);
    assert.equal(h.attempts.length, 3);
    assert.equal(h.api.isConnected(), true);
    await h.api.init();
    assert.equal(h.attempts.length, 3);
    await stop(h, true);
});

test("RabbitMQ stopping releases a retry wait and forbids stale callbacks and later startup", async () => {
    const h = fixture(async () => {
        throw Error("broker unavailable");
    });
    const startup = h.api.init();
    await turn();
    await stop(h);
    await startup;
    assert.equal(h.timers[0].cancelled, true);
    h.timers[0].run();
    await h.api.init();
    assert.equal(h.attempts.length, 1);
});

test("RabbitMQ stopping aborts and drains an active handshake", async () => {
    const h = fixture(
        (attempt, options) =>
            new Promise((resolve, reject) => {
                options.signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
            }),
    );
    const startup = h.api.init();
    await turn();
    await stop(h, true);
    await startup;
    assert.equal(h.attempts[0].signal.aborted, true);
    assert.equal(h.attempts.length, 1);
    assert.equal(h.timers.length, 0);
    assert.equal(h.api.connection, null);
});

test("RabbitMQ preserves an established broker during stopping and closes it once on finalization", async () => {
    const c = connection();
    const h = fixture(async () => c.broker);
    await h.api.init();
    await stop(h);
    assert.equal(c.broker.closes, 0);
    assert.equal(h.api.connection, c.broker);
    assert.equal(await h.api.getSafeChannel(), c.channel);
    await stop(h, true);
    await h.api.close();
    assert.equal(c.channel.closes, 1);
    assert.equal(c.broker.closes, 1);
    assert.equal(h.attempts.length, 1);
    assert.equal(h.timers.length, 0);
});

test("RabbitMQ reconnects a lost broker and ignores stale connection and channel closes", async () => {
    const old = connection();
    const replacement = connection();
    const h = fixture(async (attempt) => (attempt === 1 ? old.broker : replacement.broker));
    await h.api.init();
    old.broker.emit("close");
    assert.equal(h.api.connection, null);
    assert.equal(h.timers.length, 1);
    h.timers[0].run();
    await turn();
    assert.equal(h.api.connection, replacement.broker);
    old.broker.emit("close");
    old.channel.emit("close");
    assert.equal(h.api.connection, replacement.broker);
    assert.equal(h.api.channel, replacement.channel);
    assert.equal(h.timers.length, 1);
    await stop(h, true);
});

test("RabbitMQ refuses admission immediately when shutdown is requested", async () => {
    const h = fixture(async () => connection().broker);
    h.lifecycle.shutdownRequested = true;
    await h.api.init();
    assert.equal(h.attempts.length, 0);
    assert.equal(h.timers.length, 0);
    await stop(h, true);
});

test("RabbitMQ keeps retrying when a connection is lost during readiness notification", async () => {
    const old = connection();
    const replacement = connection();
    const h = fixture(async (attempt) => (attempt === 1 ? old.broker : replacement.broker));
    h.api.on("reconnected", () => {
        if (h.api.connection === old.broker) old.broker.emit("close");
    });
    const startup = h.api.init();
    await turn();
    assert.equal(h.timers.length, 1);
    assert.equal(h.api.isConnected(), false);
    h.timers[0].run();
    await startup;
    assert.equal(h.attempts.length, 2);
    assert.equal(h.api.connection, replacement.broker);
    assert.equal(h.api.isConnected(), true);
    await stop(h, true);
});

test("unconfigured RabbitMQ adds no lifecycle listeners and configured startup registers once", async () => {
    const absent = fixture(async () => connection().broker, "");
    await absent.api.init();
    assert.equal(absent.attempts.length, 0);
    assert.equal(absent.lifecycle.eventEmitter.listenerCount("stopping"), 0);
    assert.equal(absent.lifecycle.eventEmitter.listenerCount("stopped"), 0);
    const configured = fixture(async () => connection().broker);
    assert.equal(configured.lifecycle.eventEmitter.listenerCount("stopped"), 0);
    await Promise.all([configured.api.init(), configured.api.init()]);
    await configured.api.init();
    assert.equal(configured.lifecycle.eventEmitter.listenerCount("stopping"), 1);
    assert.equal(configured.lifecycle.eventEmitter.listenerCount("stopped"), 1);
    await stop(configured, true);
});

test("RabbitMQ cancels a startup handshake before stopping listeners are dispatched", async () => {
    const h = fixture(
        (attempt, options) =>
            new Promise((resolve, reject) => {
                options.signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
            }),
    );
    const startup = h.api.init();
    await turn();
    h.lifecycle.shutdownRequested = true;
    h.lifecycle.eventEmitter.emit("shutdownRequested");
    await startup;
    assert.equal(h.attempts[0].signal.aborted, true);
    assert.equal(h.timers.length, 0);
    await stop(h, true);
});

test("legacy RabbitMQ callback drain preserves explicit acknowledgement and cancellation", async () => {
    const h = fixture(async () => connection().broker);
    let receive;
    let release;
    const held = new Promise((resolve) => (release = resolve));
    const acknowledged = [];
    let completed = false;
    let cancelled = 0;
    const channel = {
        assertExchange: async () => {},
        assertQueue: async () => ({ queue: "owned" }),
        bindQueue: async () => {},
        unbindQueue: async () => {},
        cancel: async () => cancelled++,
        ack: (message) => acknowledged.push(message),
        consume: async (_, callback, options) => {
            receive = callback;
            assert.equal(options.noAck, false);
        },
    };
    const cancel = await h.rabbitListen(
        channel,
        "owned",
        async (event) => {
            assert.equal(event.channel, channel);
            await held;
            event.acknowledge();
            completed = true;
        },
        { acknowledge: true },
    );
    const message = { content: Buffer.from("{}"), properties: { type: "MESSAGE_CREATE" } };
    receive(message);
    assert.equal(acknowledged.length, 0);
    let drained = false;
    const draining = h.lifecycle.eventEmitter
        .listeners("draining")[0]()
        .then(() => (drained = true));
    await turn();
    assert.equal(drained, false);
    release();
    await draining;
    assert.equal(completed, true);
    assert.deepEqual(acknowledged, [message]);
    await cancel();
    assert.equal(cancelled, 1);
});

async function publicationFixture() {
    const c = connection();
    const h = fixture(async () => c.broker);
    const publications = [];
    let buffered = false;
    c.channel.assertExchange = async () => {};
    c.channel.publish = (id, route, payload, options) => {
        publications.push({ id, payload, options });
        return !buffered;
    };
    await h.api.init();
    return {
        ...h,
        ...c,
        publications,
        buffer: () => {
            buffered = true;
        },
        resume: () => {
            buffered = false;
        },
    };
}

const ownedPublication = (sequence) => ({ event: "OWNED", data: { sequence } });

test("legacy RabbitMQ bounds admitted publications and sends accepted events once in order after drain", async () => {
    const h = await publicationFixture();
    h.buffer();
    const work = Array.from({ length: 1024 }, (_, sequence) => h.api.publishEvent("owned", ownedPublication(sequence)));
    await assert.rejects(h.api.publishEvent("owned", ownedPublication(1024)), (error) => error.code === "IPC_QUEUE_FULL");
    await turn();
    assert.equal(h.publications.length, 1);
    assert.equal(h.api.publishing.size, 1024);
    assert.equal(h.channel.listenerCount("drain"), 1);
    h.resume();
    h.channel.emit("drain");
    await Promise.all(work);
    assert.deepEqual(
        h.publications.map((item) => JSON.parse(item.payload).sequence),
        Array.from({ length: 1024 }, (_, sequence) => sequence),
    );
    assert.equal(h.api.queuedBytes, 0);
    await h.api.publishEvent("owned", ownedPublication(1025));
    assert.equal(h.publications.length, 1025);
    await stop(h, true);
});

test("legacy RabbitMQ accounts for encoded UTF-8 bytes and rejects oversized payloads", async () => {
    const h = await publicationFixture();
    h.buffer();
    const payload = { event: "OWNED", data: { payload: "é".repeat(1024 * 1024) } };
    const work = Array.from({ length: 7 }, () => h.api.publishEvent("owned", payload));
    const bytes = h.api.queuedBytes;
    await assert.rejects(h.api.publishEvent("owned", payload), (error) => error.code === "IPC_QUEUE_FULL");
    assert.equal(h.api.queuedBytes, bytes);
    await turn();
    h.resume();
    h.channel.emit("drain");
    await Promise.all(work);
    assert.equal(
        bytes,
        h.publications.reduce((total, item) => total + item.payload.length, 0),
    );
    await assert.rejects(h.api.publishEvent("owned", { event: "OWNED", data: "😀".repeat(4 * 1024 * 1024 + 1) }), (error) => error.code === "IPC_QUEUE_FULL");
    assert.equal(h.api.queuedBytes, 0);
    await stop(h, true);
});

test("legacy RabbitMQ snapshots payload and event type without retaining malformed admissions", async () => {
    const h = await publicationFixture();
    const event = ownedPublication(1);
    const work = h.api.publishEvent("owned", event);
    event.data.sequence = 99;
    event.event = "CHANGED";
    const bad = ownedPublication(2);
    bad.data.loop = bad;
    await assert.rejects(h.api.publishEvent("owned", bad));
    await work;
    assert.equal(JSON.parse(h.publications[0].payload).sequence, 1);
    assert.equal(h.publications[0].options.type, "OWNED");
    assert.equal(h.api.publishing.size, 0);
    assert.equal(h.api.queuedBytes, 0);
    await stop(h, true);
});

test("legacy RabbitMQ never retries a buffered publication when its channel closes", async () => {
    const h = await publicationFixture();
    h.buffer();
    const work = h.api.publishEvent("owned", ownedPublication(1));
    await turn();
    h.channel.emit("close");
    await assert.rejects(work, /closed before its buffer drained/);
    assert.equal(h.publications.length, 1);
    assert.equal(h.channel.listenerCount("drain"), 0);
    assert.equal(h.api.queuedBytes, 0);
    await stop(h, true);
});

test("legacy RabbitMQ retries exchange setup once and releases failed work before later publications", async () => {
    const h = await publicationFixture();
    let assertions = 0;
    h.channel.assertExchange = async () => {
        if (++assertions <= 2) throw new Error("Channel closed");
    };
    const failed = h.api.publishEvent("owned", ownedPublication(1));
    const later = h.api.publishEvent("owned", ownedPublication(2));
    await assert.rejects(failed, /Channel closed/);
    await later;
    assert.equal(assertions, 3);
    assert.equal(h.publications.length, 1);
    assert.equal(JSON.parse(h.publications[0].payload).sequence, 2);
    assert.equal(h.api.queuedBytes, 0);
    await stop(h, true);
});

test("legacy RabbitMQ final close coalesces and drains admitted publications before broker cleanup", async () => {
    const h = await publicationFixture();
    h.buffer();
    const work = Array.from({ length: 3 }, (_, sequence) => h.api.publishEvent("owned", ownedPublication(sequence)));
    await turn();
    const closing = h.api.close();
    assert.equal(h.api.close(), closing);
    await assert.rejects(h.api.publishEvent("owned", ownedPublication(3)), /closing/);
    await turn();
    assert.equal(h.publications.length, 1);
    assert.equal(h.channel.closes, 0);
    h.resume();
    h.channel.emit("drain");
    await Promise.all([...work, closing]);
    assert.deepEqual(
        h.publications.map((item) => JSON.parse(item.payload).sequence),
        [0, 1, 2],
    );
    assert.equal(h.channel.closes, 1);
    assert.equal(h.broker.closes, 1);
    assert.equal(h.api.queuedBytes, 0);
    assert.equal(h.api.publishing.size, 0);
});
