const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { EventEmitter } = require("node:events");

function harness(filename, imports, clock = Date) {
    const module = { exports: {} };
    const lifecycle = { eventEmitter: new EventEmitter() };
    const timers = [];
    class HTTPError extends Error {
        constructor(message, status) {
            super(message);
            this.status = status;
        }
    }
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(filename, "utf8") + (filename.endsWith("/polls.ts") ? "\nmodule.exports.timerFixture = { pollHeap, removePendingPoll };" : ""), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            Date: clock,
            console,
            setTimeout: (run, delay) => {
                const timer = {
                    run,
                    delay,
                    unreferenced: false,
                    cancelled: false,
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
            require: (name) => {
                if (name.endsWith("/ProcessLifecycle")) return { ProcessLifecycle: lifecycle };
                if (name === "lambert-server/HTTPError") return { HTTPError };
                if (Object.hasOwn(imports, name)) return imports[name];
                throw Error(name);
            },
        },
    );
    return { api: module.exports, lifecycle, timers };
}
function polls(mutate = async () => false, clock = Date) {
    const pendingPolls = new Map();
    const reads = [];
    const published = [];
    return {
        pendingPolls,
        reads,
        published,
        ...harness(
            "src/api/util/utility/polls.ts",
            {
                "@spacebar/api": { sendMessage: async (message) => published.push(message) },
                "@spacebar/schemas": { EmbedType: {}, MessageReferenceType: {}, MessageType: {} },
                "@spacebar/util": { pendingPolls, emitEvent: async () => {} },
                "@spacebar/database": {
                    Message: {
                        mutate,
                        findOne: async ({ where }) => {
                            reads.push(where.id);
                            return null;
                        },
                    },
                },
            },
            clock,
        ),
    };
}
async function stop(h) {
    for (const listener of h.lifecycle.eventEmitter.listeners("stopping")) await listener();
}

test("poll replacement and manual finalization cancel timers without duplicate later work", async () => {
    const h = polls();
    await h.api.addPendingPoll({ id: "poll" }, 3_600_000);
    await h.api.addPendingPoll({ id: "poll" }, 7_200_000);
    assert.equal(h.timers[0].cancelled, true);
    assert.equal(h.timers[1].unreferenced, true);
    await h.api.finalizePoll("poll");
    assert.equal(h.timers[1].cancelled, true);
    assert.equal(h.pendingPolls.size, 0);
    assert.deepEqual(h.reads, ["poll"]);
});

test("poll shutdown drains an active finalization and leaves unstarted polls durable", async () => {
    let finish;
    let mutations = 0;
    const h = polls(() => {
        mutations++;
        return new Promise((resolve) => {
            finish = resolve;
        });
    });
    await h.api.addPendingPoll({ id: "active" }, 1000);
    await h.api.addPendingPoll({ id: "later" }, 3_600_000);
    const active = h.api.finalizePoll("active");
    assert.equal(h.api.finalizePoll("active"), active);
    let drained = false;
    const stopping = stop(h).then(() => {
        drained = true;
    });
    await Promise.resolve();
    assert.equal(drained, false);
    await h.api.addPendingPoll({ id: "too-late" }, 1000);
    await assert.rejects(h.api.finalizePoll("too-late"), (error) => error.status === 503);
    assert.equal(h.timers.length, 2);
    assert.equal(
        h.timers.every((timer) => timer.cancelled),
        true,
    );
    finish(false);
    await active;
    await stopping;
    assert.equal(drained, true);
    assert.equal(mutations, 1);
    assert.equal(h.pendingPolls.size, 0);
    assert.deepEqual(h.reads, ["active"]);
    assert.deepEqual(h.published, []);
});

test("failed poll finalization releases shared work so it can be retried", async () => {
    let fail = true;
    const h = polls(async () => {
        if (fail) throw Error("synthetic mutation failure");
        return false;
    });
    await assert.rejects(h.api.finalizePoll("poll"), /synthetic mutation failure/);
    fail = false;
    await h.api.finalizePoll("poll");
    assert.deepEqual(h.reads, ["poll"]);
});

test("pending interactions live in the database so any API process can answer them", async () => {
    const rows = new Map();
    const database = {
        query: async (sql, [first, second, third, fourth, fifth]) => {
            if (sql.startsWith("DELETE")) {
                for (const [id, row] of rows) if (row.expires_at <= first) rows.delete(id);
                return [[], 0];
            }
            if (sql.startsWith("INSERT")) {
                rows.set(first, { id: first, token: second, application_id: third, acknowledged: false, interaction_state: fourth, expires_at: fifth });
                return [];
            }
            if (sql.includes("WHERE id = $1 AND expires_at")) return [...rows.values()].filter((row) => row.id === first && row.expires_at > second);
            if (sql.includes("WHERE token = $1")) return [...rows.values()].filter((row) => row.token === first && row.application_id === second && row.expires_at > third);
            if (sql.includes("SET acknowledged = true")) {
                const row = rows.get(first);
                if (!row || row.acknowledged || row.expires_at <= second) return [[], 0];
                row.acknowledged = true;
                return [[{ id: first }], 1];
            }
            if (sql.includes("SET acknowledged = false")) Object.assign(rows.get(first), { acknowledged: false, interaction_state: second });
            else if (sql.includes("SET interaction_state")) rows.get(first).interaction_state = second;
            return [[], 1];
        },
    };
    const h = harness("src/util/imports/Interactions.ts", {
        "@spacebar/schemas": {},
        "@spacebar/util": {},
        "@spacebar/database": { getDatabase: () => database },
    });
    await h.api.storeInteraction({ id: "1", token: "synthetic-old", applicationId: "app" });
    const interaction = await h.api.storeInteraction({ id: "1", token: "synthetic-current", applicationId: "app" });
    assert.equal(rows.size, 1);
    assert.equal(await h.api.getInteractionByToken("app", "synthetic-old"), undefined);
    assert.equal((await h.api.getInteractionByToken("app", "synthetic-current")).id, "1");
    assert.equal(await h.api.getInteractionByToken("other-app", "synthetic-current"), undefined);
    assert.equal(await h.api.findInteraction("not-a-snowflake"), undefined);
    assert.equal(await h.api.acknowledgeInteraction(interaction), true);
    assert.equal(await h.api.acknowledgeInteraction({ ...interaction, acknowledged: false }), false);
    interaction.responseMessageId = "9";
    await h.api.saveInteraction(interaction);
    const reloaded = await h.api.findInteraction("1");
    assert.equal(reloaded.acknowledged, true);
    assert.equal(reloaded.responseMessageId, "9");
    await h.api.releaseInteraction(reloaded);
    assert.equal((await h.api.findInteraction("1")).acknowledged, false);
    rows.get("1").expires_at = new Date(Date.now() - 1);
    assert.equal(await h.api.findInteraction("1"), undefined);
    assert.equal(h.timers.length, 0);
    await stop(h);
    await assert.rejects(h.api.storeInteraction({ id: "2", token: "synthetic-late", applicationId: "app" }), (error) => error.status === 503);
});

test("polls beyond the native timer limit reschedule until their absolute expiry", async () => {
    let now = 1000;
    class Clock extends Date {
        static now() {
            return now;
        }
    }
    const limit = 2 ** 31 - 1;
    const h = polls(undefined, Clock);
    await h.api.addPendingPoll({ id: "long" }, limit + 5000);
    assert.equal(h.timers[0].delay, limit);
    now += limit;
    await h.timers[0].run();
    assert.equal(h.reads.length, 0);
    assert.equal(h.timers[1].delay, 5000);
    assert.equal(h.timers[0].cancelled, true);
    assert.equal(h.timers[1].unreferenced, true);
    now += 5000;
    await h.timers[1].run();
    assert.deepEqual(h.reads, ["long"]);
    assert.equal(h.pendingPolls.size, 0);
});

test("early timer wakeups and a backward clock change preserve the stored expiry", async () => {
    let now = 10_000;
    class Clock extends Date {
        static now() {
            return now;
        }
    }
    const h = polls(undefined, Clock);
    await h.api.addPendingPoll({ id: "clock" }, 5000);
    now -= 1000;
    await h.timers[0].run();
    assert.equal(h.timers[1].delay, 6000);
    now += 5999;
    await h.timers[1].run();
    assert.equal(h.timers[2].delay, 1);
    assert.equal(h.reads.length, 0);
    now++;
    await h.timers[2].run();
    assert.deepEqual(h.reads, ["clock"]);
});

test("cancelled poll callbacks cannot replace a newer timer or finalize a manually ended poll", async () => {
    const h = polls();
    await h.api.addPendingPoll({ id: "replaced" }, 0);
    await h.api.addPendingPoll({ id: "replaced" }, 10000);
    const current = h.pendingPolls.get("replaced").expiry;
    await h.timers[0].run();
    assert.equal(h.pendingPolls.get("replaced").expiry, current);
    assert.equal(h.reads.length, 0);
    await h.api.finalizePoll("replaced");
    await h.timers[1].run();
    assert.deepEqual(h.reads, ["replaced"]);
    assert.equal(h.pendingPolls.size, 0);
});

test("a long poll timer cannot reschedule after a shutdown request", async () => {
    const h = polls();
    await h.api.addPendingPoll({ id: "later" }, 2 ** 31 + 10000);
    h.lifecycle.shutdownRequested = true;
    await h.timers[0].run();
    assert.equal(h.timers.length, 1);
    assert.equal(h.reads.length, 0);
    await stop(h);
    assert.equal(h.timers[0].cancelled, true);
    assert.equal(h.pendingPolls.size, 0);
});

function verifyPollQueue(h) {
    const heap = h.api.timerFixture.pollHeap;
    assert.equal(heap.length, h.pendingPolls.size);
    assert.equal(new Set(heap).size, heap.length);
    for (let i = 0; i < heap.length; i++) {
        const entry = h.pendingPolls.get(heap[i]);
        assert.equal(entry.position, i);
        if (i) assert.ok(h.pendingPolls.get(heap[Math.floor((i - 1) / 2)]).expiry <= entry.expiry);
    }
    assert.ok(h.timers.filter((timer) => !timer.cancelled).length <= 1);
}

test("ten thousand pending polls and repeated replacements retain one timer and one entry per poll", async () => {
    class Clock extends Date {
        static now() {
            return 1000;
        }
    }
    const h = polls(undefined, Clock);
    for (let i = 0; i < 10000; i++) await h.api.addPendingPoll({ id: String(i) }, 1000 + ((i * 7919) % 100000));
    assert.equal(h.pendingPolls.size, 10000);
    verifyPollQueue(h);
    for (let i = 0; i < 5000; i++) await h.api.addPendingPoll({ id: String(i) }, 500 + ((i * 3571) % 100000));
    verifyPollQueue(h);
    assert.equal(h.pendingPolls.size, 10000);
    for (let i = 0; i < 200; i++) await h.api.finalizePoll(String((i * 47) % 10000));
    verifyPollQueue(h);
    assert.equal(h.pendingPolls.size, 9800);
    await stop(h);
    assert.equal(h.api.timerFixture.pollHeap.length, 0);
    assert.equal(h.pendingPolls.size, 0);
    assert.ok(h.timers.every((timer) => timer.cancelled));
});

test("the poll timer finalizes due polls in expiry order with at most one admitted finalization", async () => {
    let now = 1000;
    let finish;
    let active = 0;
    let maximum = 0;
    const admitted = [];
    class Clock extends Date {
        static now() {
            return now;
        }
    }
    const h = polls(async ({ id }) => {
        admitted.push(id);
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => {
            finish = resolve;
        });
        active--;
        return false;
    }, Clock);
    await h.api.addPendingPoll({ id: "later" }, 30);
    await h.api.addPendingPoll({ id: "second" }, 20);
    await h.api.addPendingPoll({ id: "first" }, 10);
    now += 20;
    const work = h.timers.at(-1).run();
    await new Promise(setImmediate);
    assert.deepEqual(admitted, ["first"]);
    finish();
    await new Promise(setImmediate);
    assert.deepEqual(admitted, ["first", "second"]);
    finish();
    await work;
    assert.equal(maximum, 1);
    assert.deepEqual(h.reads, ["first", "second"]);
    assert.equal(h.pendingPolls.size, 1);
    assert.equal(h.timers.at(-1).delay, 10);
    verifyPollQueue(h);
    await stop(h);
});

test("shutdown drains the active expiry pass and leaves later due polls unclaimed", async () => {
    let now = 1000;
    let finish;
    const admitted = [];
    class Clock extends Date {
        static now() {
            return now;
        }
    }
    const h = polls(async ({ id }) => {
        admitted.push(id);
        await new Promise((resolve) => {
            finish = resolve;
        });
        return false;
    }, Clock);
    await h.api.addPendingPoll({ id: "a" }, 10);
    await h.api.addPendingPoll({ id: "b" }, 10);
    now += 10;
    const timer = h.timers.at(-1);
    const work = timer.run();
    assert.equal(timer.run(), undefined);
    await new Promise(setImmediate);
    let stopped = false;
    const stopping = stop(h).then(() => {
        stopped = true;
    });
    await new Promise(setImmediate);
    assert.equal(stopped, false);
    assert.deepEqual(admitted, ["a"]);
    finish();
    await Promise.all([work, stopping]);
    assert.deepEqual(h.reads, ["a"]);
    assert.equal(h.pendingPolls.size, 0);
    assert.equal(h.api.timerFixture.pollHeap.length, 0);
    assert.ok(h.timers.every((timer) => timer.cancelled));
});

test("saved polls use their durable expiry without extending the deadline", async () => {
    let now = 1_000;
    class Clock extends Date {
        static now() {
            return now;
        }
    }
    const h = polls(undefined, Clock);
    now = 4_000;
    h.api.scheduleSavedPoll({
        id: "saved",
        poll: { expiry: new Date(10_000), results: { is_finalized: false } },
    });
    assert.equal(h.pendingPolls.get("saved").expiry, 10_000);
    assert.equal(h.timers.at(-1).delay, 6_000);
    h.api.scheduleSavedPoll({ id: "overdue", poll: { expiry: new Date(3_000) } });
    assert.equal(h.pendingPolls.get("overdue").expiry, 3_000);
    assert.equal(h.timers.at(-1).delay, 0);
    await stop(h);
});

test("saved poll admission ignores finalized, missing and invalid expiries and shutdown", async () => {
    const h = polls();
    h.api.scheduleSavedPoll({ id: "ordinary" });
    h.api.scheduleSavedPoll({ id: "no-expiry", poll: {} });
    h.api.scheduleSavedPoll({ id: "invalid", poll: { expiry: "invalid" } });
    h.api.scheduleSavedPoll({
        id: "finalized",
        poll: { expiry: new Date(), results: { is_finalized: true } },
    });
    assert.equal(h.pendingPolls.size, 0);
    assert.equal(h.timers.length, 0);
    await stop(h);
    h.api.scheduleSavedPoll({ id: "stopped", poll: { expiry: new Date() } });
    assert.equal(h.pendingPolls.size, 0);
    assert.equal(h.timers.length, 0);
});

function messageSender(transaction) {
    const source = ts.createSourceFile("Message.ts", fs.readFileSync("src/api/util/handlers/Message.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "sendMessage");
    const module = { exports: {} };
    const scheduled = [];
    const published = [];
    const message = {
        id: "saved",
        flags: 0,
        channel: {},
        attachments: [],
        toJSON: () => ({ id: "saved" }),
    };
    vm.runInNewContext(
        ts.transpileModule(declaration.getText(source), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            handleMessage: async () => message,
            getDatabase: () => ({ transaction }),
            scheduleSavedPoll: (saved) => scheduled.push(saved.id),
            emitEvent: async (event) => published.push(event),
            MessageFlags: { FLAGS: { EPHEMERAL: 64 } },
            postHandleMessage: async () => {},
            console,
        },
    );
    return { send: module.exports.sendMessage, scheduled, published };
}

test("message poll admission waits until the whole transaction commits", async () => {
    let commit;
    const committed = new Promise((resolve) => {
        commit = resolve;
    });
    const h = messageSender(async (persist) => {
        await persist({ save: async () => {} });
        await committed;
    });
    const sending = h.send({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.scheduled.length, 0);
    assert.equal(h.published.length, 0);
    commit();
    await sending;
    assert.deepEqual(h.scheduled, ["saved"]);
    assert.equal(h.published.length, 1);
});

test("a rolled back message transaction never admits its poll", async () => {
    const h = messageSender(async (persist) => {
        let writes = 0;
        await persist({
            save: async () => {
                if (++writes === 2) throw new Error("channel write failed");
            },
        });
    });
    await assert.rejects(h.send({}), /channel write failed/);
    assert.equal(h.scheduled.length, 0);
    assert.equal(h.published.length, 0);
});
