const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { EventEmitter } = require("node:events");

function harness(records, read, mutate) {
    const module = { exports: {} };
    const lifecycle = { eventEmitter: new EventEmitter() };
    const pendingPolls = new Map();
    const queries = [];
    const published = [];
    const mutations = [];
    const Message = {
        createQueryBuilder: () => {
            const query = { after: undefined, take: undefined, selected: undefined };
            queries.push(query);
            const builder = {
                select: (field) => {
                    query.selected = [field];
                    return builder;
                },
                addSelect: (field) => {
                    query.selected.push(field);
                    return builder;
                },
                where: () => builder,
                andWhere: (where, parameters) => {
                    if (parameters) query.after = parameters.after;
                    return builder;
                },
                orderBy: () => builder,
                take: (count) => {
                    query.take = count;
                    return builder;
                },
                getRawMany: async () =>
                    read
                        ? read(query)
                        : records
                              .filter((r) => !r.poll.results.is_finalized && (!query.after || r.id > query.after))
                              .slice(0, query.take)
                              .map((r) => ({ id: r.id, expiry: r.poll.expiry.toISOString() })),
            };
            return builder;
        },
        mutate: async ({ id }, fn) => {
            mutations.push(id);
            if (mutate) await mutate(id);
            return fn(records.find((r) => r.id === id));
        },
        findOne: async ({ where }) => records.find((r) => r.id === where.id),
    };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/util/utility/polls.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            Date,
            console: { log() {}, error() {} },
            require: (name) => {
                if (name.endsWith("/ProcessLifecycle")) return { ProcessLifecycle: lifecycle };
                if (name === "@spacebar/database") return { Message };
                if (name === "@spacebar/util") return { pendingPolls, emitEvent: async () => {} };
                if (name === "@spacebar/api") return { sendMessage: async (m) => published.push(m) };
                if (name === "@spacebar/schemas") return { EmbedType: {}, MessageReferenceType: {}, MessageType: {} };
                if (name === "lambert-server/HTTPError") return { HTTPError: Error };
                throw Error(name);
            },
            setTimeout: (run, delay) => ({
                run,
                delay,
                unref() {
                    return this;
                },
            }),
            clearTimeout() {},
        },
    );
    return { api: module.exports, lifecycle, pendingPolls, queries, published, mutations };
}
const poll = (i, expired = false) => ({
    id: String(i).padStart(5, "0"),
    channel_id: "fixture",
    poll: {
        expiry: new Date(Date.now() + (expired ? -60000 : 3600000)),
        question: { text: "fixture poll" },
        answers: [],
        results: { is_finalized: false, answer_counts: [] },
    },
    toJSON() {
        return {};
    },
});

async function stop(h) {
    for (const listener of h.lifecycle.eventEmitter.listeners("stopping")) await listener();
}

test("poll recovery pages only IDs and expiry data and finalizes expired polls sequentially", async () => {
    let active = 0,
        peak = 0;
    const records = Array.from({ length: 205 }, (_, i) => poll(i, i < 3));
    const h = harness(records, undefined, async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise(setImmediate);
        active--;
    });
    await h.api.recoverPendingPolls();
    assert.equal(h.queries.length, 3);
    assert.deepEqual(
        h.queries.map((q) => q.after),
        [undefined, "00099", "00199"],
    );
    assert.ok(h.queries.every((q) => q.take === 100 && q.selected.join() === "message.id,message.poll->>'expiry'"));
    assert.equal(h.pendingPolls.size, 202);
    assert.equal(h.published.length, 3);
    assert.equal(peak, 1);
    assert.equal(new Set(h.published.map((m) => m.message_reference.message_id)).size, 3);
    await stop(h);
});

test("poll recovery coalesces concurrent startup scans", async () => {
    let finish;
    const h = harness(
        [],
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    const first = h.api.recoverPendingPolls();
    assert.equal(h.api.recoverPendingPolls(), first);
    assert.equal(h.queries.length, 1);
    finish([]);
    await first;
});

test("poll shutdown drains a pending scan without scheduling or finalizing later records", async () => {
    let finish;
    const h = harness(
        [poll(1), poll(2, true)],
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    const recovering = h.api.recoverPendingPolls();
    let done = false;
    const stopping = stop(h).then(() => {
        done = true;
    });
    await new Promise(setImmediate);
    assert.equal(done, false);
    finish([poll(1), poll(2, true)]);
    await Promise.all([recovering, stopping]);
    assert.equal(h.pendingPolls.size, 0);
    assert.equal(h.mutations.length, 0);
    await h.api.recoverPendingPolls();
    assert.equal(h.queries.length, 1);
});

test("failed poll recovery scans release their shared promise for retry", async () => {
    let failed = false;
    const h = harness([], async () => {
        if (!failed) {
            failed = true;
            throw Error("synthetic read failure");
        }
        return [];
    });
    await assert.rejects(h.api.recoverPendingPolls(), /synthetic read failure/);
    await h.api.recoverPendingPolls();
    assert.equal(h.queries.length, 2);
});

test("a shutdown request interrupts startup recovery before lifecycle cleanup begins", async () => {
    let finish;
    const records = [poll(1), poll(2, true)];
    const h = harness(
        records,
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    const recovering = h.api.recoverPendingPolls();
    h.lifecycle.shutdownRequested = true;
    finish(records.map((r) => ({ id: r.id, expiry: r.poll.expiry.toISOString() })));
    await recovering;
    assert.equal(h.pendingPolls.size, 0);
    assert.equal(h.mutations.length, 0);
    await assert.rejects(h.api.finalizePoll(records[1].id), /Server is shutting down/);
    await h.api.addPendingPoll(records[0], 1000);
    assert.equal(h.pendingPolls.size, 0);
});
