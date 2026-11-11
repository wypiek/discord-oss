// Gateway permission regressions, exercising actual listener code in isolation.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
function load(file, mocks, globals = {}) {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../..", file), "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
    }).outputText;
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        require: (name) => (Object.hasOwn(mocks, name) ? mocks[name] : require(name)),
        console,
        process,
        ...globals,
    });
    return module.exports;
}
class Permissions {
    constructor(value = 0) {
        if (value === "view") this.cache = {};
        this.view = value === "ADMINISTRATOR" || value === "view";
        this.admin = value === "ADMINISTRATOR";
    }
    has(name) {
        return name === "VIEW_CHANNEL" ? this.view : this.admin;
    }
    overwriteChannel(overwrites = []) {
        return overwrites.some((x) => x.denyView) ? new Permissions(0) : this;
    }
    static finalPermission() {
        return new Permissions("view");
    }
    static DEFAULT_DM_PERMISSIONS = new Permissions("view");
}
function harness() {
    const channels = [channel("public"), channel("private", 12), channel("thread", 11, "public")];
    let permission = new Permissions("view");
    const sends = [],
        cancels = [],
        subscriptions = new Map();
    const reads = { channels: 0, members: 0, threads: 0, threadChannels: 0 };
    const listens = new Map();
    const permissionBatches = [];
    const memberFinds = [];
    const Member = {
        find: async (options) => {
            memberFinds.push(options);
            return [{ guild: { id: "guild", owner_id: "other" }, roles: [], guild_id: "guild" }];
        },
    };
    const entities = {
        Member,
        Channel: {
            find: async (options) => {
                const threads = options?.where?.type?.type === "in";
                reads[threads ? "threadChannels" : "channels"]++;
                return channels.filter((x) => [10, 11, 12].includes(x.type) === threads);
            },
        },
        ThreadMember: {
            find: async () => {
                reads.threads++;
                return [];
            },
        },
        Recipient: { find: async () => [] },
        Relationship: { find: async () => [] },
        User: { findOne: async () => ({ flags: 0 }) },
        Ban: { findOne: async () => null },
        Message: {
            prototype: {
                withSignedAttachments(signature) {
                    return {
                        ...this,
                        attachments: this.attachments?.map((attachment) => ({ ...attachment, url: `${attachment.url}?ip=${signature.ip}` })),
                        components: this.components,
                    };
                },
            },
        },
    };
    const util = {
        Permissions,
        NewUrlUserSignatureData: class {
            constructor(data) {
                Object.assign(this, data);
            }
        },
        EVENTEnum: {},
        RabbitMQ: new EventEmitter(),
        getPermission: async () => {
            reads.members++;
            return permission;
        },
        getGuildPermissions: async (guild_id, users) => {
            reads.members++;
            permissionBatches.push({ guild_id, users });
            return new Map(users.map((user) => [user, permission]));
        },
        listenEvent: async (id, callback) => {
            listens.set(id, (listens.get(id) ?? 0) + 1);
            subscriptions.set(id, callback);
            return async () => {
                cancels.push(id);
                subscriptions.delete(id);
            };
        },
    };
    const listener = load(
        "src/gateway/listener/listener.ts",
        {
            "@spacebar/database": entities,
            "@spacebar/util": util,
            "@spacebar/gateway": {},
            "@spacebar/schemas": {
                ChannelType: { GUILD_NEWS_THREAD: 10, GUILD_PUBLIC_THREAD: 11, GUILD_PRIVATE_THREAD: 12 },
                RelationshipType: { FRIEND: 1 },
            },
            "../util": {
                Send: async (_, payload) => sends.push(payload),
                OPCODES: { Dispatch: 0 },
                resolveSocket: (x) => x,
                holdForResume() {},
                CLOSECODES: {},
            },
            "../opcodes/LazyRequest": { markMemberListsStale() {}, resyncMemberList: async () => {} },
        },
        { setImmediate },
    );
    const socket = Object.assign(new EventEmitter(), {
        user_id: "user",
        session_id: "session",
        permissions: {},
        events: {},
        member_events: {},
        recentTransactions: [],
        readyState: 1,
        CLOSED: 3,
        sequence: 0,
    });
    const event = (name, data, ids = { guild_id: "guild" }) => listener.consume.call(socket, { event: name, data, ...ids, cancel() {} });
    const subscribed = (id, target = socket) => listener.subscribedChannels(target).has(id);
    return {
        listener,
        listens,
        subscribed,
        permissionBatches,
        socket,
        sends,
        cancels,
        reads,
        channels,
        memberFinds,
        subscriptions,
        event,
        setup: () => listener.setupListener.call(socket),
        eventOn: (other, name, data) => listener.consume.call(other, { event: name, data, guild_id: "guild", cancel() {} }),
        revoke: () => {
            permission = new Permissions(0);
        },
        hide: () => {
            channels[0].permission_overwrites = [{ denyView: true }];
        },
    };
}
function makeSocket(user_id, extra = {}) {
    return Object.assign(new EventEmitter(), {
        user_id,
        session_id: `${user_id}-session`,
        permissions: {},
        events: {},
        member_events: {},
        recentTransactions: [],
        readyState: 1,
        CLOSED: 3,
        sequence: 0,
        ...extra,
    });
}
function channel(id, type = 0, parent_id) {
    return {
        id,
        guild_id: "guild",
        type,
        parent_id,
        permission_overwrites: [],
        isThread: () => type === 11 || type === 12,
    };
}

test("guild CHANNEL_UPDATE revokes channel and child thread subscriptions; queued messages fail closed", async () => {
    const h = harness();
    await h.setup();
    assert.ok(h.subscribed("public"));
    assert.ok(h.subscribed("thread"));
    assert.equal(h.subscribed("private"), false);
    h.hide();
    await Promise.all([h.event("CHANNEL_UPDATE", { id: "public", guild_id: "guild" }), h.event("MESSAGE_CREATE", { channel_id: "public", content: "must not leak" })]);
    assert.equal(h.subscribed("public"), false);
    assert.equal(h.subscribed("thread"), false);
    assert.equal(h.sends.length, 0);
    // Legacy channel-only producers still cannot fall back to DM permissions.
    await h.event("MESSAGE_CREATE", { channel_id: "public", content: "must not leak" }, { channel_id: "public" });
    assert.equal(h.sends.length, 0);
});
test("role and own-member updates refresh cached permissions and remove private/public subscriptions", async () => {
    for (const name of ["GUILD_ROLE_CREATE", "GUILD_ROLE_UPDATE", "GUILD_ROLE_DELETE", "GUILD_MEMBER_UPDATE"]) {
        const h = harness();
        await h.setup();
        h.revoke();
        await h.event(name, { guild_id: "guild", user: { id: "user" }, role_id: "role" });
        assert.equal(h.reads.members, 1);
        assert.equal(h.subscribed("public"), false);
        assert.equal(h.subscribed("thread"), false);
        await h.event("MESSAGE_CREATE", { channel_id: "public" });
        assert.equal(h.sends.filter((x) => x.t === "MESSAGE_CREATE").length, 0);
    }
});
test("a role update refreshes every socket in the guild with one batched permission read", async () => {
    const h = harness();
    await h.setup();
    const others = Array.from({ length: 49 }, (_, i) => makeSocket(`user${i}`));
    for (const other of others) await h.listener.setupListener.call(other);
    const before = h.reads.members;
    await Promise.all(
        [h.socket, ...others].map((socket) => h.listener.consume.call(socket, { event: "GUILD_ROLE_UPDATE", data: { guild_id: "guild" }, guild_id: "guild", cancel() {} })),
    );
    assert.equal(h.reads.members - before, 1);
    assert.equal(h.permissionBatches.at(-1).users.length, 50);
    h.revoke();
    await Promise.all(
        [h.socket, ...others].map((socket) => h.listener.consume.call(socket, { event: "GUILD_ROLE_UPDATE", data: { guild_id: "guild" }, guild_id: "guild", cancel() {} })),
    );
    assert.equal(h.reads.members - before, 2);
    await h.event("MESSAGE_CREATE", { channel_id: "public" });
    assert.equal(h.sends.filter((x) => x.t === "MESSAGE_CREATE").length, 0);
});
test("sockets in one guild share one bus listener per channel and thread events reach them through the parent", async () => {
    const h = harness();
    await h.setup();
    const others = Array.from({ length: 99 }, (_, i) => makeSocket(`user${i}`));
    for (const other of others) await h.listener.setupListener.call(other);
    assert.equal(h.listens.get("public"), 1);
    assert.equal(h.listens.get("thread"), 1);
    assert.equal(h.listens.get("private"), 1);
    await h.subscriptions.get("thread")({ event: "MESSAGE_CREATE", data: { channel_id: "thread", guild_id: "guild" }, channel_id: "thread", cancel() {} });
    assert.equal(h.sends.filter((x) => x.t === "MESSAGE_CREATE").length, 100);
    for (const socket of [h.socket, ...others]) await socket.listenerCleanup();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.cancels.filter((id) => id === "public").length, 1);
    assert.equal(h.cancels.filter((id) => id === "thread").length, 1);
    assert.equal(h.subscriptions.has("public"), false);
});
test("attachments are signed per socket without changing the shared event data", async () => {
    const h = harness();
    await h.setup();
    h.socket.ipAddress = "first";
    const other = makeSocket("other", { ipAddress: "second" });
    await h.listener.setupListener.call(other);
    const data = { channel_id: "public", attachments: [{ url: "file" }], components: [] };
    await Promise.all([h.socket, other].map((socket) => h.listener.consume.call(socket, { event: "MESSAGE_CREATE", data, guild_id: "guild", cancel() {} })));
    const urls = h.sends.filter((x) => x.t === "MESSAGE_CREATE").map((x) => x.d.attachments[0].url);
    assert.deepEqual(urls.sort(), ["file?ip=first", "file?ip=second"]);
    assert.equal(data.attachments[0].url, "file");
});
test("guild deletion removes every owned channel listener and cached permission", async () => {
    const h = harness();
    await h.setup();
    await h.event("GUILD_DELETE", { id: "guild" }, { user_id: "user" });
    assert.equal(h.socket.events.guild, undefined);
    assert.equal(h.subscribed("public"), false);
    assert.equal(h.subscribed("thread"), false);
    assert.equal(h.socket.permissions.guild, undefined);
    await h.event("MESSAGE_CREATE", { channel_id: "public" }, { channel_id: "public" });
    assert.equal(h.sends.filter((x) => x.t === "MESSAGE_CREATE").length, 0);
});
test("10,000 gateway messages reuse cached permissions without database reads", async () => {
    const h = harness();
    await h.setup();
    const baseline = { ...h.reads };
    for (let i = 0; i < 10000; i++) await h.event("MESSAGE_CREATE", { channel_id: "public", content: "message" });
    assert.equal(h.sends.length, 10000);
    assert.deepEqual(h.reads, baseline);
});

test("resumed socket retains channel ownership with its transferred permission cache", async () => {
    const h = harness();
    await h.setup();
    const resumed = Object.assign(new EventEmitter(), h.socket);
    await h.eventOn(resumed, "MESSAGE_CREATE", { channel_id: "public" });
    assert.equal(h.sends.length, 1);
    h.revoke();
    await h.eventOn(resumed, "GUILD_ROLE_UPDATE", { guild_id: "guild" });
    await h.eventOn(resumed, "MESSAGE_CREATE", { channel_id: "public" });
    assert.equal(h.sends.filter((x) => x.t === "MESSAGE_CREATE").length, 1);
});

test("process and local IPC cancellation removes actual callback and is idempotent over 1,000 churn cycles", async () => {
    for (const mode of ["process", "local"]) {
        const fakeProcess = Object.assign(new EventEmitter(), { env: { EVENT_TRANSMISSION: mode } });
        const mocks = {
            "../Config": {},
            "./RabbitMQ": { RabbitMQ: {} },
            "./BackgroundWork": { trackBackground: (work) => work },
            "./EventWork": require("../tests/event-work-fixture.cjs")({
                eventEmitter: new EventEmitter(),
            }),
        };
        for (const file of [
            "listener/BaseEventListener",
            "writer/BaseEventWriter",
            "writer/UnixSocketWriter",
            "listener/UnixSocketListener",
            "listener/RabbitMqSingleListener",
            "writer/RabbitMqSingleWriter",
        ])
            mocks["./" + file] = {};
        const ipc = load("src/util/util/ipc/Event.ts", mocks, { process: fakeProcess });
        const emitter = mode === "process" ? fakeProcess : ipc.events;
        const baseline = emitter.getMaxListeners();
        let delivered = 0;
        for (let i = 0; i < 1000; i++) {
            const cancel = await ipc.listenEvent("guild", () => delivered++);
            await cancel();
            await cancel();
        }
        assert.equal(emitter.listenerCount(mode === "process" ? "message" : "guild"), 0);
        assert.equal(emitter.getMaxListeners(), baseline);
        emitter.emit(mode === "process" ? "message" : "guild", {
            type: "event",
            id: "guild",
            event: {},
        });
        assert.equal(delivered, 0);
    }
});

test("partial relationship events do not crash or retain subscriptions after blocking", async () => {
    const h = harness();
    await h.setup();
    await h.event("RELATIONSHIP_ADD", { id: "friend", type: 1 }, { user_id: "user" });
    assert.ok(h.socket.events.friend);
    await h.event("RELATIONSHIP_ADD", { id: "friend", type: 1 }, { user_id: "user" });
    await h.event("RELATIONSHIP_ADD", { id: "friend", type: 2 }, { user_id: "user" });
    assert.equal(h.socket.events.friend, undefined);
    assert.equal(h.cancels.filter((id) => id === "friend").length, 1);
});

test("an event sent to a session only reaches it when the session belongs to the named user", async () => {
    const h = harness();
    await h.setup();
    const before = h.sends.length;
    await h.event("SESSIONS_REPLACE", [], { session_id: "session", session_user_id: "someone-else" });
    assert.equal(h.sends.length, before);
    await h.event("SESSIONS_REPLACE", [], { session_id: "session", session_user_id: "user" });
    assert.equal(h.sends.length, before + 1);
    const route = fs.readFileSync(path.resolve(__dirname, "../..", "src/api/routes/guilds/#guild_id/members/#member_id/index.ts"), "utf8");
    assert.match(route, /session_id: sessionId, session_user_id: member_id/);
});

test("identify loads guild channels in their own query instead of joining them to every member role", async () => {
    const h = harness();
    await h.setup();
    assert.equal(h.memberFinds.length, 1);
    assert.deepEqual(Object.keys(h.memberFinds[0].relations).sort(), ["guild", "roles"]);
    assert.equal(h.memberFinds[0].relations.guild, true);
    assert.equal(h.reads.channels, 1);
    assert.equal(h.reads.threadChannels, 1);
    assert.ok(h.subscribed("public"));
    assert.ok(h.subscribed("thread"));
});

test("a created guild channel is subscribed from the event without rereading the guild", async () => {
    const h = harness();
    await h.setup();
    const before = { ...h.reads };
    await h.event("CHANNEL_CREATE", { id: "fresh", guild_id: "guild", type: 0, permission_overwrites: [] });
    assert.ok(h.subscribed("fresh"));
    await h.event("CHANNEL_CREATE", { id: "hidden", guild_id: "guild", type: 0, permission_overwrites: [{ denyView: true }] });
    assert.equal(h.subscribed("hidden"), false);
    assert.deepEqual(h.reads, before);
    await h.event("MESSAGE_CREATE", { channel_id: "fresh", content: "hello" });
    assert.equal(h.sends.filter((x) => x.t === "MESSAGE_CREATE").length, 1);
});

test("guild reconciliation only reads thread memberships when the guild has private threads", async () => {
    const h = harness();
    await h.setup();
    const threadsAfterSetup = h.reads.threads;
    h.channels.splice(
        h.channels.findIndex((x) => x.type === 12),
        1,
    );
    await h.event("THREAD_CREATE", { id: "thread", guild_id: "guild", type: 11, parent_id: "public" });
    assert.equal(h.reads.threads, threadsAfterSetup);
    h.channels.push(channel("secret", 12, "public"));
    await h.event("THREAD_CREATE", { id: "secret", guild_id: "guild", type: 12, parent_id: "public" });
    assert.equal(h.reads.threads, threadsAfterSetup + 1);
    assert.equal(h.subscribed("secret"), false);
});
