const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const murmur = require("murmurhash-js/murmurhash3_gc");
const { EventEmitter } = require("node:events");

const VIEW_CHANNEL = 1n << 10n;

function harness() {
    const module = { exports: {} };
    const db = {};
    const lifecycle = { shutdownRequested: false, eventEmitter: new EventEmitter() };
    const sent = [];
    const online = new Map();
    const timer = () => ({
        unref() {
            return this;
        },
    });
    const source = `${fs.readFileSync("src/gateway/opcodes/LazyRequest.ts", "utf8")}\nmodule.exports.fixture = { lists, guildLists, refresh, getListId, subscribeMemberList, markMemberListsStale };`;
    vm.runInNewContext(
        ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            console: { error() {}, log() {} },
            setTimeout: timer,
            setInterval: timer,
            clearTimeout() {},
            clearInterval() {},
            require: (name) => {
                if (name === "murmurhash-js/murmurhash3_gc") return murmur;
                if (name.endsWith("/ProcessLifecycle")) return { ProcessLifecycle: lifecycle };
                if (name === "@spacebar/gateway")
                    return {
                        resolveSocket: (socket) => socket,
                        OPCODES: { Dispatch: 0 },
                        Send: async (socket, payload) => {
                            sent.push({ socket, payload });
                        },
                    };
                if (name === "@spacebar/util")
                    return {
                        Permissions: {
                            FLAGS: { VIEW_CHANNEL },
                            finalPermission: ({ user, channel }) => ({
                                has: () => !channel.overwrites.length || user.roles.includes("mods"),
                            }),
                        },
                        getUserPresences: async (ids) =>
                            new Map(ids.filter((id) => online.has(id)).map((id) => [id, { status: online.get(id), activities: [], client_status: {} }])),
                    };
                if (name === "@spacebar/database") return db;
                if (["typeorm", "../util/ThreadSync", "@spacebar/extensions", "@spacebar/schemas", "./instanceOf"].includes(name)) return {};
                throw Error(name);
            },
        },
    );
    const api = module.exports;
    const roles = [
        { id: "guild", hoist: false, position: 0, permissions: String(VIEW_CHANNEL) },
        { id: "mods", hoist: true, position: 2, permissions: "0" },
    ];
    const member = (index, roleIds = []) => {
        const id = String(1000 + index);
        const username = `member_${String(index).padStart(3, "0")}`;
        return {
            id,
            nick: null,
            roles: roleIds.map((role) => ({ id: role })),
            user: { username, global_name: null, toPartialUser: () => ({ id, username }) },
            toPublicMember: () => ({ joined_at: "2026-01-01T00:00:00.000Z" }),
        };
    };
    const members = Array.from({ length: 300 }, (_, i) => member(i, i < 15 ? ["mods"] : []));
    const channels = {
        channel: { id: "channel", permission_overwrites: [] },
        private: {
            id: "private",
            permission_overwrites: [
                { id: "guild", allow: "0", deny: String(VIEW_CHANNEL) },
                { id: "mods", allow: String(VIEW_CHANNEL), deny: "0" },
            ],
        },
    };
    Object.assign(db, {
        Role: { findOne: async ({ where }) => roles.find((role) => role.id === where.id) ?? null, find: async () => roles },
        Guild: { findOneOrFail: async () => ({ id: "guild", owner_id: "owner" }) },
        Member: { find: async () => [...members], attachRoles: async () => {} },
        Channel: { findOneOrFail: async ({ where }) => channels[where.id] },
    });
    const state = {
        key: "guild:everyone",
        guild_id: "guild",
        channel_id: "channel",
        loaded: { roles, channel: { permission_overwrites: [] }, members, visible: members },
        subscribers: new Set(),
    };
    api.fixture.lists.set(state.key, state);
    api.fixture.guildLists.set("guild", new Set([state.key]));
    const connect = (ranges) => {
        const socket = { user_id: "viewer", readyState: 1, sequence: 0, member_lists: { guild: { key: state.key, channel_id: "channel", ranges } } };
        state.subscribers.add(socket);
        return { socket, client: new ClientList() };
    };
    const deliver = (socket, client) => {
        for (const update of sent.splice(0)) if (update.socket === socket) client.apply(update.payload.d);
    };
    return { api, state, sent, online, member, members, channels, connect, deliver };
}

const itemKey = (item) => (item.group ? `group:${item.group.id}` : `member:${item.member.user.id}`);

class ClientList {
    rows = [];
    groups = [];
    constructor() {
        this.setGroups([{ id: "unknown", count: 0 }]);
    }
    setGroups(groups) {
        let total = 0;
        this.groups = groups.map((group) => {
            const index = total;
            total += Math.max(0, group.count ?? 0) + 1;
            return { ...group, index };
        });
        this.rows.length = total;
    }
    sync([start], items) {
        items.forEach((item, offset) => this.update(start + offset, item));
    }
    invalidate([start, end]) {
        for (let i = start; i <= end; i++) {
            if (this.rows[i] == null) break;
            delete this.rows[i];
        }
    }
    insert(index, item) {
        this.rows.splice(index, 0, itemKey(item));
    }
    update(index, item) {
        this.rows[index] = itemKey(item);
    }
    delete(index) {
        if (this.rows[index] != null) this.rows.splice(index, 1);
    }
    apply(update) {
        for (const op of update.ops) {
            if (op.op === "SYNC") this.sync(op.range, op.items);
            else if (op.op === "INVALIDATE") this.invalidate(op.range);
            else if (op.op === "INSERT") this.insert(op.index, op.item);
            else if (op.op === "UPDATE") this.update(op.index, op.item);
            else if (op.op === "DELETE") this.delete(op.index);
        }
        this.setGroups(update.groups);
    }
}

function assertMatches(client, state, ranges) {
    const truth = state.list.entries.map((entry) => entry.key);
    assert.equal(client.rows.length, truth.length);
    for (let i = 0; i < client.rows.length; i++) if (client.rows[i] != null) assert.equal(client.rows[i], truth[i], `row ${i}`);
    for (const [start, end] of ranges) for (let i = start; i <= Math.min(end, truth.length - 1); i++) assert.equal(client.rows[i], truth[i], `subscribed row ${i}`);
}

async function round(h, socket, client, ranges) {
    await h.api.fixture.refresh(h.state);
    h.deliver(socket, client);
    assertMatches(client, h.state, ranges);
}

test("a member leaving rows the client never loaded keeps later subscribed ranges aligned", async () => {
    const h = harness();
    for (let i = 0; i < 40; i++) h.online.set(String(1000 + i), "online");
    const ranges = [
        [0, 99],
        [200, 299],
    ];
    const { socket, client } = h.connect(ranges);
    await round(h, socket, client, ranges);
    h.online.set(String(1000 + 150), "online");
    await round(h, socket, client, ranges);
    h.online.delete(String(1000 + 150));
    await round(h, socket, client, ranges);
});

test("rows shifted into a subscribed range from unloaded space are filled", async () => {
    const h = harness();
    const ranges = [
        [0, 99],
        [200, 299],
    ];
    const { socket, client } = h.connect(ranges);
    await round(h, socket, client, ranges);
    for (const index of [300, 301, 302]) {
        const joined = h.member(index);
        joined.user.username = `aaa_${index}`;
        h.state.loaded.members.push(joined);
        h.online.set(joined.id, "online");
        await round(h, socket, client, ranges);
    }
    h.state.loaded.members.splice(120, 1);
    await round(h, socket, client, ranges);
});

test("random presence, role, join and leave changes never leave the client out of step", async () => {
    const h = harness();
    let seed = 7;
    const random = (n) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % n;
    };
    const ranges = [
        [0, 99],
        [100, 199],
        [200, 299],
    ];
    const { socket, client } = h.connect([[0, 99]]);
    await round(h, socket, client, [[0, 99]]);
    let next = 400;
    for (let step = 0; step < 120; step++) {
        const members = h.state.loaded.members;
        const pick = members[random(members.length)];
        const action = random(6);
        if (action <= 1) h.online.has(pick.id) ? h.online.delete(pick.id) : h.online.set(pick.id, "online");
        else if (action === 2) pick.roles = pick.roles.length ? [] : [{ id: "mods" }];
        else if (action === 3) members.push(h.member(next++));
        else if (action === 4 && members.length > 50) members.splice(members.indexOf(pick), 1);
        else pick.nick = `nick ${random(1000)}`;
        h.state.loaded.visible = members;
        if (step % 10 === 0) socket.member_lists.guild.ranges = ranges.slice(0, 1 + random(3));
        await round(h, socket, client, socket.member_lists.guild.ranges);
    }
});

test("the list id matches the client's own id for channels with view overrides", () => {
    const h = harness();
    const everyone = { permissions: String(VIEW_CHANNEL) };
    const allowOnly = { permission_overwrites: [{ id: "helpers", allow: String(VIEW_CHANNEL), deny: "0" }] };
    assert.equal(h.api.fixture.getListId(allowOnly, everyone), "everyone");
    const hidden = {
        permission_overwrites: [
            { id: "guild", allow: "0", deny: String(VIEW_CHANNEL) },
            { id: "mods", allow: String(VIEW_CHANNEL), deny: "0" },
        ],
    };
    assert.equal(h.api.fixture.getListId(hidden, everyone), murmur("allow:mods,deny:guild").toString());
    assert.equal(h.api.fixture.getListId({ permission_overwrites: [] }, { permissions: "0" }), murmur("").toString());
    assert.equal(h.api.fixture.getListId({ permission_overwrites: [] }, everyone), "everyone");
});

test("switching to another channel's list and back keeps the first list's loaded rows in step", async () => {
    const h = harness();
    h.api.fixture.lists.clear();
    h.api.fixture.guildLists.clear();
    for (let i = 0; i < 40; i++) h.online.set(String(1000 + i), "online");
    const socket = { user_id: "viewer", readyState: 1, sequence: 0 };
    const clients = new Map();
    const apply = () => {
        for (const { socket: target, payload } of h.sent.splice(0)) {
            if (target !== socket) continue;
            if (!clients.has(payload.d.id)) clients.set(payload.d.id, new ClientList());
            clients.get(payload.d.id).apply(payload.d);
        }
    };
    const ranges = [
        [0, 99],
        [200, 299],
    ];
    const everyone = () => h.api.fixture.lists.get("guild:everyone");
    await h.api.fixture.subscribeMemberList(socket, "guild", h.channels.channel, ranges);
    apply();
    assertMatches(clients.get("everyone"), everyone(), ranges);
    await h.api.fixture.subscribeMemberList(socket, "guild", h.channels.private, [[0, 99]]);
    apply();
    h.online.set("1150", "online");
    h.members.push(h.member(400));
    await h.api.fixture.subscribeMemberList(socket, "guild", h.channels.channel, ranges);
    apply();
    assertMatches(clients.get("everyone"), everyone(), ranges);
    h.online.set("1160", "online");
    h.api.fixture.markMemberListsStale("guild", "members");
    await h.api.fixture.refresh(everyone());
    apply();
    assertMatches(clients.get("everyone"), everyone(), ranges);
});
