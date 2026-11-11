const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const transpile = (file) => ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function threadSync(memberOf) {
    const calls = { threadQueries: 0, sent: [] };
    const module = { exports: {} };
    vm.runInNewContext(transpile("src/gateway/util/ThreadSync.ts"), {
        module,
        exports: module.exports,
        require: (name) =>
            ({
                typeorm: { In: (values) => values },
                "@spacebar/database": {
                    Channel: {
                        find: async () => {
                            calls.threadQueries++;
                            return [];
                        },
                    },
                    Member: { exists: async ({ where }) => memberOf.has(where.guild_id) },
                    Message: {},
                    Session: {},
                    ThreadMember: {},
                },
                "@spacebar/util": { getMostRelevantSession() {}, getPermission() {}, Permissions: class {} },
                "@spacebar/schemas": { ChannelType: { GUILD_NEWS_THREAD: 10, GUILD_PUBLIC_THREAD: 11, GUILD_PRIVATE_THREAD: 12 } },
                "./Constants": { OPCODES: { Dispatch: 0 } },
                "./Send": { Send: async (_socket, payload) => calls.sent.push(payload) },
                "./WebSocket": {},
            })[name],
    });
    return { sync: module.exports.syncThreadList, calls };
}

test("thread sync loads nothing for a guild the socket's user isn't in", async () => {
    const { sync, calls } = threadSync(new Set(["mine"]));
    const socket = { user_id: "user", sequence: 0 };
    for (let i = 0; i < 100; i++) await sync.call(socket, `stranger${i}`);
    assert.equal(calls.threadQueries, 0);
    assert.equal(calls.sent.length, 0);
    await sync.call(socket, "mine");
    await sync.call(socket, "mine");
    assert.equal(calls.threadQueries, 1);
    assert.equal(calls.sent.length, 1);
});

test("a bulk subscription frame handles at most 100 guilds", async () => {
    const handled = [];
    const module = { exports: {} };
    vm.runInNewContext(transpile("src/gateway/opcodes/GuildSubscriptionsBulk.ts"), {
        module,
        exports: module.exports,
        Date,
        Object,
        console: { log() {} },
        require: (name) =>
            ({
                "@spacebar/gateway": {},
                "./LazyRequest": { onLazyRequest: async ({ d }) => handled.push(d.guild_id) },
                "@spacebar/schemas": { GuildSubscriptionsBulkSchema: {} },
                "./instanceOf": { check() {} },
            })[name],
    });
    const subscriptions = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [String(i + 1), { threads: true }]));
    await module.exports.onGuildSubscriptionsBulk.call({ user_id: "user" }, { op: 37, d: { subscriptions } });
    assert.equal(handled.length, 100);
    assert.equal(module.exports.MAX_BULK_SUBSCRIPTIONS, 100);
});
