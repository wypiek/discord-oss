const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const EventEmitter = require("node:events");
const turn = () => new Promise((resolve) => setImmediate(resolve));

function fixture(kind, connect) {
    const lifecycle = { shutdownRequested: false, eventEmitter: new EventEmitter() };
    const timers = [];
    const brokers = [];
    const attempts = [];
    const labels = [];
    let publishes = 0;
    const payloads = [];
    let buffered = false;
    let metricRemovals = 0;
    const metric = {
        labels: (value) => {
            labels.push(value);
            return { set() {} };
        },
        remove: () => {
            metricRemovals++;
        },
    };
    function broker() {
        const connection = new EventEmitter();
        const channel = new EventEmitter();
        connection.channel = channel;
        connection.channelCreations = 0;
        connection.closes = 0;
        channel.closes = 0;
        channel.acknowledged = [];
        channel.rejected = [];
        channel.ack = (message) => channel.acknowledged.push(message);
        channel.reject = (message, requeue) => channel.rejected.push({ message, requeue });
        channel.assertExchange = async () => {};
        channel.assertQueue = async (name, options) => {
            channel.queueDeclaration = { name, options };
            return { queue: `owned-${brokers.length}` };
        };
        channel.bindQueue = async (queue) => {
            channel.boundQueue = queue;
        };
        channel.consume = async (queue, receive) => {
            channel.receive = receive;
            channel.consumedQueue = queue;
        };
        channel.publish = (exchange, route, payload) => {
            publishes++;
            payloads.push(payload);
            return !buffered;
        };
        channel.close = async () => {
            channel.closes++;
            channel.emit("close");
        };
        connection.createChannel = async () => {
            connection.channelCreations++;
            return channel;
        };
        connection.close = async () => {
            connection.closes++;
            connection.emit("close");
        };
        brokers.push(connection);
        return connection;
    }
    let manager;
    function load(file) {
        const module = { exports: {} };
        vm.runInNewContext(
            ts.transpileModule(fs.readFileSync(file, "utf8"), {
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
                URL,
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
                    if (name === "amqplib")
                        return {
                            connect: async (host, options) => {
                                attempts.push(options);
                                return connect ? connect(attempts.length, options, broker) : broker();
                            },
                        };
                    if (name.endsWith("EventWork")) return require("./event-work-fixture.cjs")(lifecycle);
                    if (name.endsWith("/ProcessLifecycle")) return { ProcessLifecycle: lifecycle };
                    if (name.endsWith("/RabbitMqConnection")) return manager;
                    if (name.includes("BaseEvent")) return { [`BaseEvent${kind}`]: class {} };
                    if (name === "node:events") return EventEmitter;
                    if (name === "node:crypto") return require(name);
                    if (name === "@spacebar/extensions") return { arraySum: (values) => values.reduce((a, b) => a + b, 0) };
                    if (name === "prom-client") return { Gauge: class {} };
                    if (name.includes("/Monitoring")) return { Monitoring: { attachMetric: () => metric } };
                    return {};
                },
            },
        );
        return module.exports;
    }
    manager = load("src/util/util/ipc/RabbitMqConnection.ts");
    const api = load(`src/util/util/ipc/${kind === "Writer" ? "writer" : "listener"}/RabbitMqSingle${kind}.ts`);
    const transport = new api[`RabbitMqSingle${kind}`]("amqp://fixture-user:fixture-password@127.0.0.1/owned");
    return {
        transport,
        lifecycle,
        timers,
        brokers,
        attempts,
        labels,
        publishes: () => publishes,
        payloads,
        buffer: () => {
            buffered = true;
        },
        resume: () => {
            buffered = false;
        },
        metricRemovals: () => metricRemovals,
    };
}

async function request(h) {
    h.lifecycle.shutdownRequested = true;
    h.lifecycle.eventEmitter.emit("shutdownRequested");
    for (const listener of h.lifecycle.eventEmitter.listeners("stopping")) await listener();
}
async function finalize(h) {
    await request(h);
    for (const listener of h.lifecycle.eventEmitter.listeners("stopped")) await listener();
}

for (const kind of ["Writer", "Listener"]) {
    test(`single RabbitMQ ${kind} shares initialization and registers cleanup once`, async () => {
        const h = fixture(kind);
        assert.equal(h.lifecycle.eventEmitter.listenerCount("stopped"), 0);
        await Promise.all([h.transport.init(), h.transport.init()]);
        await h.transport.init();
        assert.equal(h.attempts.length, 1);
        assert.equal(h.brokers[0].channelCreations, 1);
        assert.equal(h.lifecycle.eventEmitter.listenerCount("stopped"), 1);
        await finalize(h);
        await h.transport.close();
        assert.equal(h.brokers[0].closes, 1);
        assert.equal(h.brokers[0].channel.closes, 1);
        assert.equal(h.timers.length, 0);
        if (kind === "Listener") {
            assert.equal(h.metricRemovals(), 1);
            assert.ok(!JSON.stringify(h.labels).includes("fixture-password"));
            assert.ok(!JSON.stringify(h.labels).includes("fixture-user"));
        }
    });

    test(`single RabbitMQ ${kind} replaces lost brokers and ignores old close events`, async () => {
        const h = fixture(kind);
        await h.transport.init();
        h.brokers[0].emit("close");
        assert.equal(h.timers.length, 1);
        assert.equal(h.timers[0].unreferenced, true);
        assert.equal(h.timers[0].delay, 1_000);
        h.timers[0].run();
        await turn();
        assert.equal(h.attempts.length, 2);
        h.brokers[0].emit("close");
        h.brokers[0].channel.emit("close");
        assert.equal(h.timers.length, 1);
        if (kind === "Writer") await h.transport.emit({ user_id: "owned", event: "OWNED", data: {} });
        else {
            let received;
            const cancel = await h.transport.listen("owned", (value) => {
                received = value.event;
            });
            h.brokers[1].channel.receive({
                content: Buffer.from(JSON.stringify({ id: "owned", event: { event: "OWNED" } })),
            });
            assert.equal(received, "OWNED");
            await cancel();
        }
        await finalize(h);
    });

    test(`single RabbitMQ ${kind} cancels startup handshakes immediately`, async () => {
        const h = fixture(
            kind,
            (attempt, options) =>
                new Promise((resolve, reject) => {
                    options.signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
                }),
        );
        const startup = h.transport.init();
        await turn();
        await request(h);
        await startup;
        await finalize(h);
        assert.equal(h.attempts[0].signal.aborted, true);
        assert.equal(h.timers.length, 0);
        await h.transport.init();
        assert.equal(h.attempts.length, 1);
    });

    test(`single RabbitMQ ${kind} retries repeated failures and cancels its pending delay`, async () => {
        const h = fixture(kind, async () => {
            throw Error("owned offline broker");
        });
        const startup = h.transport.init();
        await turn();
        h.timers[0].run();
        await turn();
        assert.equal(h.attempts.length, 2);
        assert.equal(h.timers.length, 2);
        await finalize(h);
        await startup;
        assert.equal(h.timers[1].cancelled, true);
        h.timers[1].run();
        await turn();
        assert.equal(h.attempts.length, 2);
    });
}

test("single RabbitMQ writer backpressure waits for drain without publishing a duplicate", async () => {
    const h = fixture("Writer");
    await h.transport.init();
    h.buffer();
    const sending = h.transport.emit({ user_id: "owned", event: "OWNED", data: {} });
    await turn();
    const channel = h.brokers[0].channel;
    let closed = false;
    const closing = h.transport.close().then(() => {
        closed = true;
    });
    await turn();
    assert.equal(closed, false);
    assert.equal(h.publishes(), 1);
    await assert.rejects(h.transport.emit({}), /closing/);
    channel.emit("drain");
    await Promise.all([sending, closing]);
    assert.equal(h.publishes(), 1);
    assert.equal(channel.listenerCount("drain"), 0);
    assert.equal(channel.listenerCount("error"), 1);
    assert.equal(h.brokers[0].closes, 1);
});

test("single RabbitMQ writer releases buffer listeners when the channel closes", async () => {
    const h = fixture("Writer");
    await h.transport.init();
    h.buffer();
    const sending = h.transport.emit({ user_id: "owned", event: "OWNED", data: {} });
    await turn();
    h.brokers[0].channel.emit("close");
    await assert.rejects(sending, /closed before its buffer drained/);
    assert.equal(h.brokers[0].channel.listenerCount("drain"), 0);
    assert.equal(h.publishes(), 1);
    await finalize(h);
});

test("single RabbitMQ writer stopping drains buffered publishing before final cleanup", async () => {
    const h = fixture("Writer");
    await h.transport.init();
    h.buffer();
    const sending = h.transport.emit({ user_id: "owned", event: "OWNED", data: {} });
    await turn();
    let stopped = false;
    const stopping = request(h).then(() => {
        stopped = true;
    });
    await turn();
    assert.equal(stopped, false);
    assert.equal(h.brokers[0].closes, 0);
    h.brokers[0].channel.emit("drain");
    await Promise.all([sending, stopping]);
    assert.equal(stopped, true);
    assert.equal(h.brokers[0].closes, 0);
    await finalize(h);
    assert.equal(h.brokers[0].closes, 1);
});

test("single RabbitMQ listener settles valid deliveries once, including unobserved events", async () => {
    const h = fixture("Listener");
    await h.transport.init();
    const channel = h.brokers[0].channel;
    const received = [];
    await h.transport.listen("owned", (event) => received.push(event.data));
    const observed = {
        content: Buffer.from(JSON.stringify({ id: "owned", event: { event: "MESSAGE_CREATE", data: { value: 1 } } })),
    };
    const unobserved = {
        content: Buffer.from(JSON.stringify({ id: "other", event: { event: "MESSAGE_CREATE" } })),
    };
    channel.receive(observed);
    channel.receive(unobserved);
    channel.receive(null);
    assert.equal(received.length, 1);
    assert.equal(received[0].value, 1);
    assert.deepEqual(channel.acknowledged, [observed, unobserved]);
    assert.deepEqual(channel.rejected, []);
    await finalize(h);
});

test("single RabbitMQ listener rejects malformed deliveries without requeueing or stopping later delivery", async () => {
    const h = fixture("Listener");
    await h.transport.init();
    const channel = h.brokers[0].channel;
    const received = [];
    await h.transport.listen("owned", (event) => received.push(event.event));
    const malformed = [
        "{",
        "null",
        "[]",
        JSON.stringify({ id: 1, event: { event: "MESSAGE_CREATE" } }),
        JSON.stringify({ id: "owned", event: [] }),
        JSON.stringify({ id: "owned", event: {} }),
    ].map((text) => ({ content: Buffer.from(text) }));
    for (const message of malformed) channel.receive(message);
    const valid = {
        content: Buffer.from(JSON.stringify({ id: "owned", event: { event: "MESSAGE_CREATE" } })),
    };
    channel.receive(valid);
    assert.deepEqual(received, ["MESSAGE_CREATE"]);
    assert.deepEqual(channel.acknowledged, [valid]);
    assert.equal(channel.rejected.length, malformed.length);
    assert.ok(channel.rejected.every((item, index) => item.message === malformed[index] && item.requeue === false));
    await finalize(h);
});

test("single RabbitMQ listener settles delivery when a synchronous subscriber fails", async () => {
    const h = fixture("Listener");
    await h.transport.init();
    const channel = h.brokers[0].channel;
    await h.transport.listen("owned", () => {
        throw new Error("fixture subscriber failure");
    });
    const message = {
        content: Buffer.from(JSON.stringify({ id: "owned", event: { event: "MESSAGE_CREATE" } })),
    };
    assert.doesNotThrow(() => channel.receive(message));
    assert.deepEqual(channel.acknowledged, [message]);
    assert.deepEqual(channel.rejected, []);
    await finalize(h);
});

test("single RabbitMQ listener owns a new exclusive queue on each connection", async () => {
    const h = fixture("Listener");
    await h.transport.init();
    const before = h.brokers[0].channel;
    assert.equal(before.queueDeclaration.name, "");
    assert.equal(before.queueDeclaration.options.exclusive, true);
    assert.equal(before.queueDeclaration.options.durable, false);
    assert.equal(before.queueDeclaration.options.autoDelete, true);
    assert.equal(before.queueDeclaration.options.messageTtl, 5000);
    assert.equal(before.boundQueue, before.consumedQueue);
    await h.brokers[0].close();
    h.timers.at(-1).run();
    await turn();
    await h.transport.init();
    const after = h.brokers.at(-1).channel;
    assert.notEqual(after.consumedQueue, before.consumedQueue);
    assert.equal(after.boundQueue, after.consumedQueue);
    await finalize(h);
});

test("single RabbitMQ reader acknowledges receipt while final close waits for callback completion", async () => {
    const h = fixture("Listener");
    await h.transport.init();
    let release;
    const held = new Promise((resolve) => (release = resolve));
    let completed = false;
    await h.transport.listen("owned", async () => {
        await held;
        completed = true;
    });
    const delivery = {
        content: Buffer.from(JSON.stringify({ id: "owned", event: { event: "MESSAGE_CREATE" } })),
    };
    h.brokers[0].channel.receive(delivery);
    assert.deepEqual(h.brokers[0].channel.acknowledged, [delivery]);
    let closed = false;
    const closing = h.transport.close().then(() => (closed = true));
    await turn();
    assert.equal(closed, false);
    assert.equal(h.brokers[0].closes, 0);
    release();
    await closing;
    assert.equal(completed, true);
    assert.equal(h.brokers[0].closes, 1);
});

test("single RabbitMQ writer bounds admitted events and pauses later publications until drain", async () => {
    const h = fixture("Writer");
    await h.transport.init();
    h.buffer();
    const work = Array.from({ length: 1024 }, (_, sequence) => h.transport.emit({ user_id: "owned", event: "OWNED", data: { sequence } }));
    await assert.rejects(h.transport.emit({}), (error) => error.code === "IPC_QUEUE_FULL");
    await turn();
    assert.equal(h.publishes(), 1);
    assert.equal(h.transport.publishing.size, 1024);
    assert.equal(h.brokers[0].channel.listenerCount("drain"), 1);
    h.resume();
    h.brokers[0].channel.emit("drain");
    await Promise.all(work);
    assert.deepEqual(
        h.payloads.map((payload) => JSON.parse(payload).event.data.sequence),
        Array.from({ length: 1024 }, (_, sequence) => sequence),
    );
    assert.equal(h.transport.publishing.size, 0);
    assert.equal(h.transport.queuedBytes, 0);
    await h.transport.emit({ user_id: "owned", event: "OWNED", data: { sequence: 1025 } });
    assert.equal(h.publishes(), 1025);
    await finalize(h);
});

test("single RabbitMQ writer bounds encoded UTF-8 bytes while publication is blocked", async () => {
    const h = fixture("Writer");
    await h.transport.init();
    h.buffer();
    const payload = "é".repeat(1024 * 1024);
    const work = Array.from({ length: 7 }, () => h.transport.emit({ user_id: "owned", event: "OWNED", data: { payload } }));
    const bytes = h.transport.queuedBytes;
    assert.ok(bytes <= 16 * 1024 * 1024);
    await assert.rejects(h.transport.emit({ user_id: "owned", event: "OWNED", data: { payload } }), (error) => error.code === "IPC_QUEUE_FULL");
    assert.equal(h.transport.queuedBytes, bytes);
    await turn();
    assert.equal(h.publishes(), 1);
    h.resume();
    h.brokers[0].channel.emit("drain");
    await Promise.all(work);
    assert.equal(
        bytes,
        h.payloads.reduce((total, item) => total + item.length, 0),
    );
    assert.equal(h.transport.queuedBytes, 0);
    await assert.rejects(
        h.transport.emit({
            user_id: "owned",
            event: "OWNED",
            data: { payload: "😀".repeat(4 * 1024 * 1024) },
        }),
        (error) => error.code === "IPC_QUEUE_FULL",
    );
    assert.equal(h.transport.queuedBytes, 0);
    await finalize(h);
});

test("single RabbitMQ writer snapshots admitted payloads and serialization failures leave accepted work intact", async () => {
    const h = fixture("Writer");
    await h.transport.init();
    h.buffer();
    const event = { user_id: "owned", event: "OWNED", data: { sequence: 1 } };
    const first = h.transport.emit(event);
    event.data.sequence = 99;
    const bad = { user_id: "owned", event: "OWNED", data: {} };
    bad.data.loop = bad;
    await assert.rejects(h.transport.emit(bad));
    assert.equal(h.transport.publishing.size, 1);
    await turn();
    h.resume();
    h.brokers[0].channel.emit("drain");
    await first;
    assert.equal(JSON.parse(h.payloads[0]).event.data.sequence, 1);
    assert.equal(h.transport.queuedBytes, 0);
    await finalize(h);
});

test("single RabbitMQ writer releases failed publication capacity and continues queued work", async () => {
    const h = fixture("Writer");
    await h.transport.init();
    const channel = h.brokers[0].channel;
    let assertions = 0;
    channel.assertExchange = async () => {
        if (++assertions === 1) throw new Error("owned exchange failure");
    };
    const failed = h.transport.emit({ user_id: "owned", event: "OWNED", data: { sequence: 1 } });
    const next = h.transport.emit({ user_id: "owned", event: "OWNED", data: { sequence: 2 } });
    await assert.rejects(failed, /owned exchange failure/);
    await next;
    assert.equal(h.publishes(), 1);
    assert.equal(JSON.parse(h.payloads[0]).event.data.sequence, 2);
    assert.equal(h.transport.queuedBytes, 0);
    assert.equal(h.transport.publishing.size, 0);
    await finalize(h);
});

test("single RabbitMQ writer final close drains every admitted publication before closing its channel", async () => {
    const h = fixture("Writer");
    await h.transport.init();
    h.buffer();
    const work = Array.from({ length: 3 }, (_, sequence) => h.transport.emit({ user_id: "owned", event: "OWNED", data: { sequence } }));
    await turn();
    let closed = false;
    const closing = h.transport.close().then(() => {
        closed = true;
    });
    await assert.rejects(h.transport.emit({}), /closing/);
    await turn();
    assert.equal(closed, false);
    assert.equal(h.publishes(), 1);
    assert.equal(h.brokers[0].channel.closes, 0);
    h.resume();
    h.brokers[0].channel.emit("drain");
    await Promise.all([...work, closing]);
    assert.deepEqual(
        h.payloads.map((payload) => JSON.parse(payload).event.data.sequence),
        [0, 1, 2],
    );
    assert.equal(h.transport.publishing.size, 0);
    assert.equal(h.transport.queuedBytes, 0);
    assert.equal(h.brokers[0].channel.closes, 1);
    assert.equal(h.brokers[0].closes, 1);
});
