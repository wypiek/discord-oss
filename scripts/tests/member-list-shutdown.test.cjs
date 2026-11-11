const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { EventEmitter } = require("node:events");

function harness(presences = async () => new Map(), send = async () => {}) {
    const module = { exports: {} };
    const lifecycle = { shutdownRequested: false, eventEmitter: new EventEmitter() };
    const timers = [];
    const sent = [];
    let reads = 0;
    const timer = (run, delay) => {
        const value = {
            run,
            delay,
            cancelled: false,
            unreferenced: false,
            unref() {
                this.unreferenced = true;
                return this;
            },
        };
        timers.push(value);
        return value;
    };
    const clear = (value) => {
        if (value) value.cancelled = true;
    };
    const source = fs.readFileSync("src/gateway/opcodes/LazyRequest.ts", "utf8") + "\nmodule.exports.fixture = { lists, guildLists, refresh, rebuild, sendListUpdate };";
    vm.runInNewContext(
        ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            console: { error() {} },
            setTimeout: timer,
            setInterval: timer,
            clearTimeout: clear,
            clearInterval: clear,
            require: (name) => {
                if (name === "murmurhash-js/murmurhash3_gc") return require(name);
                if (name.endsWith("/ProcessLifecycle")) return { ProcessLifecycle: lifecycle };
                if (name === "@spacebar/gateway")
                    return {
                        resolveSocket: (socket) => socket,
                        OPCODES: { Dispatch: 0 },
                        Send: async (...args) => {
                            sent.push(args);
                            await send(...args);
                        },
                    };
                if (name === "@spacebar/util")
                    return {
                        getUserPresences: async (...args) => {
                            reads++;
                            return presences(...args);
                        },
                    };
                if (["typeorm", "../util/ThreadSync", "@spacebar/database", "@spacebar/extensions", "@spacebar/schemas", "./instanceOf"].includes(name)) return {};
                throw Error(name);
            },
        },
    );
    const api = module.exports;
    const socket = {
        user_id: "owner",
        readyState: 1,
        sequence: 0,
        member_lists: { guild: { key: "guild:everyone", ranges: [[0, 99]] } },
    };
    const state = {
        key: "guild:everyone",
        guild_id: "guild",
        channel_id: "channel",
        loaded: { roles: [], channel: { permission_overwrites: [] }, members: [], visible: [] },
        subscribers: new Set([socket]),
    };
    api.fixture.lists.set(state.key, state);
    api.fixture.guildLists.set("guild", new Set([state.key]));
    return { api, lifecycle, timers, sent, state, reads: () => reads };
}
const tick = () => new Promise(setImmediate);
const stop = async (h) => {
    for (const listener of h.lifecycle.eventEmitter.listeners("stopping")) await listener();
};

test("shutdown cancels unreferenced refresh and cleanup timers and rejects later refresh admission", async () => {
    const h = harness();
    h.api.markMemberListsStale("guild", "presence");
    assert.equal(h.timers.length, 2);
    assert.ok(h.timers.every((timer) => timer.unreferenced));
    await stop(h);
    assert.ok(h.timers.every((timer) => timer.cancelled));
    assert.equal(h.api.fixture.lists.size, 0);
    assert.equal(h.api.fixture.guildLists.size, 0);
    await h.api.fixture.refresh(h.state);
    h.api.markMemberListsStale("guild", "members");
    assert.equal(h.reads(), 0);
    assert.equal(h.timers.length, 2);
});

test("shutdown drains a coalesced active rebuild and suppresses its later broadcast", async () => {
    let finish;
    const h = harness(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    const work = h.api.fixture.refresh(h.state);
    assert.equal(h.api.fixture.refresh(h.state), work);
    let stopped = false;
    const stopping = stop(h).then(() => {
        stopped = true;
    });
    await tick();
    assert.equal(stopped, false);
    assert.equal(h.reads(), 1);
    finish(new Map());
    await Promise.all([work, stopping]);
    assert.equal(h.sent.length, 0);
    assert.equal(h.api.fixture.lists.size, 0);
});

test("shutdown waits for an admitted member-list broadcast before clearing subscribers", async () => {
    let finish;
    const h = harness(
        undefined,
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    const work = h.api.fixture.refresh(h.state);
    await tick();
    assert.equal(h.sent.length, 1);
    let stopped = false;
    const stopping = stop(h).then(() => {
        stopped = true;
    });
    await tick();
    assert.equal(stopped, false);
    assert.equal(h.api.fixture.lists.size, 1);
    h.api.markMemberListsStale("guild", "presence");
    assert.equal(h.timers.length, 1);
    finish();
    await Promise.all([work, stopping]);
    assert.equal(h.api.fixture.lists.size, 0);
});

test("shutdown drains an initial rebuild before clearing its list", async () => {
    let finish;
    const h = harness(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    const work = h.api.fixture.rebuild(h.state);
    let stopped = false;
    const stopping = stop(h).then(() => {
        stopped = true;
    });
    await tick();
    assert.equal(stopped, false);
    finish(new Map());
    await Promise.all([work, stopping]);
    assert.equal(h.api.fixture.lists.size, 0);
    assert.equal(h.sent.length, 0);
});

test("staleness arriving during a coalesced refresh schedules a later pass", async () => {
    let finish;
    let calls = 0;
    const h = harness(() =>
        ++calls === 1
            ? new Promise((resolve) => {
                  finish = resolve;
              })
            : Promise.resolve(new Map()),
    );
    const work = h.api.fixture.refresh(h.state);
    h.api.markMemberListsStale("guild", "presence");
    const coalesced = h.timers[1].run();
    finish(new Map());
    await Promise.all([work, coalesced]);
    assert.equal(h.reads(), 1);
    assert.equal(h.timers.length, 3);
    await h.timers[2].run();
    assert.equal(h.reads(), 2);
    await stop(h);
});

test("shutdown drains an initial member-list broadcast without an active refresh", async () => {
    let finish;
    const h = harness(
        undefined,
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    const work = h.api.fixture.sendListUpdate(h.state.subscribers.values().next().value, { online_count: 0, member_count: 0, id: "everyone", guild_id: "guild", groups: [] }, []);
    let stopped = false;
    const stopping = stop(h).then(() => {
        stopped = true;
    });
    await tick();
    assert.equal(stopped, false);
    finish();
    await Promise.all([work, stopping]);
    assert.equal(h.api.fixture.lists.size, 0);
});
