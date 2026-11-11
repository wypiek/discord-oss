const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function gateway() {
    const sent = [];
    const channels = [
        { id: "open", type: 2, permission_overwrites: [], isThread: () => false },
        { id: "hidden", type: 2, permission_overwrites: [{ deny: "view" }], isThread: () => false },
    ];
    const permission = (visible) => ({
        cache: {},
        has: (flag) => visible && flag === "VIEW_CHANNEL",
        overwriteChannel: (overwrites) => permission(!overwrites.some((overwrite) => overwrite.deny === "view")),
    });
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/gateway/listener/listener.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            Promise,
            Map,
            Set,
            WeakMap,
            console,
            require: (name) => {
                const imports = {
                    picocolors: { bgRedBright: (text) => text },
                    "@spacebar/database": {
                        Channel: { find: async () => channels },
                        ThreadMember: { find: async () => [] },
                        Message: {},
                    },
                    "@spacebar/schemas": { ChannelType: { GUILD_NEWS_THREAD: 10, GUILD_PUBLIC_THREAD: 11, GUILD_PRIVATE_THREAD: 12 }, RelationshipType: {} },
                    typeorm: { In: (ids) => ids, Not: (value) => value },
                    "@spacebar/util": {
                        EVENTEnum: {},
                        RabbitMQ: { on() {} },
                        getPermission: async () => permission(true),
                        listenEvent: async () => () => {},
                        Permissions: class {
                            static DEFAULT_DM_PERMISSIONS = {};
                        },
                    },
                    "../util": { OPCODES: { Dispatch: 0 }, CLOSECODES: {}, Send: async (_, payload) => sent.push(payload) },
                    "../opcodes/LazyRequest": { markMemberListsStale() {}, resyncMemberList() {} },
                };
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    const socket = { user_id: "viewer", session_id: "session", sequence: 0, permissions: {}, events: {}, member_events: {}, listen_options: {} };
    const consume = (opts) => module.exports.consume.call(socket, opts);
    return { consume, sent };
}

test("voice channel status and start time updates only reach members who can see the channel", async () => {
    const { consume, sent } = gateway();
    await consume({ event: "GUILD_CREATE", guild_id: "guild", data: { id: "guild" } });
    sent.length = 0;
    for (const event of ["VOICE_CHANNEL_STATUS_UPDATE", "VOICE_CHANNEL_START_TIME_UPDATE"])
        for (const id of ["open", "hidden"]) await consume({ event, guild_id: "guild", data: { id, guild_id: "guild", status: "secret" } });
    assert.deepEqual(
        sent.map((payload) => `${payload.t} ${payload.d.id}`),
        ["VOICE_CHANNEL_STATUS_UPDATE open", "VOICE_CHANNEL_START_TIME_UPDATE open"],
    );
});
