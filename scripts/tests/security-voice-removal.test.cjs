const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const stub = () =>
    new Proxy(() => {}, {
        get: (_, key) => (key === Symbol.toPrimitive ? () => "" : stub()),
        apply: () => stub(),
        construct: () => stub(),
    });

function load(file, imports) {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, experimentalDecorators: true },
    }).outputText;
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        console: { log() {}, error() {} },
        Reflect,
        Date,
        setTimeout,
        clearTimeout,
        require: (name) => imports[name] ?? stub(),
    });
    return module.exports;
}

const decorators = new Proxy({}, { get: (_, key) => (key === "__esModule" ? false : () => () => {}) });

test("removing a member from a guild disconnects them from voice before the member row goes", async () => {
    const calls = [];
    const { Member } = load("src/database/entities/Member.ts", {
        typeorm: decorators,
        "./BaseClass": { BaseClassWithoutId: class {} },
        "../voice/VoiceChannels": { VoiceChannels: { move: async (...args) => calls.push(["move", ...args]) } },
        "./Guild": { Guild: { findOneOrFail: async () => ({ owner_id: "owner" }), decrement: async () => {} } },
        "./Role": { Role: { find: async () => [] } },
        "../insights/GuildInsights": { GuildInsights: { recordLeave() {} } },
        "@spacebar/util/util": { emitEvent: async () => {}, dropGuildTags: async () => {} },
    });
    Member.findOneOrFail = async () => ({ joined_at: new Date(), user: { bot: false, toPublicUser: () => ({}) } });
    Member.delete = async () => calls.push(["delete"]);
    await Member.removeFromGuild("user", "guild");
    assert.deepEqual(calls, [["move", "guild", "user", null], ["delete"]]);
});

test("banning members disconnects them from voice", async () => {
    const moved = [];
    const { banUsers } = load("src/api/util/utility/bans.ts", {
        typeorm: { In: (value) => value, MoreThan: (value) => value },
        "@spacebar/schemas": { AuditLogEvents: {}, PublicUserProjection: [] },
        "@spacebar/util": { emitEvent: async () => {}, dropGuildTags: async () => {}, Snowflake: { generate: () => "1" } },
        "@spacebar/database": {
            VoiceChannels: { move: async (...args) => moved.push(args) },
            User: { find: async () => [{ id: "user", bot: false, toPublicUser: () => ({}) }] },
            Ban: { find: async () => [], insert: async () => {} },
            Member: { find: async () => [{ id: "user", guild_id: "guild", joined_at: new Date() }], delete: async () => {} },
            Guild: { decrement: async () => {} },
            GuildInsights: { recordLeave() {} },
            Message: { find: async () => [] },
            AuditLog: { logMany: async () => {} },
        },
    });
    await banUsers({ guild_id: "guild", user_ids: ["user"], executor_id: "owner", delete_message_seconds: 0 });
    assert.deepEqual(moved, [["guild", "user", null]]);
});

test("removing a group DM recipient makes them leave the call", async () => {
    const calls = [];
    const { Channel } = load("src/database/entities/Channel.ts", {
        typeorm: decorators,
        "./BaseClass": { BaseClass: class {} },
        "../voice/VoiceChannels": { VoiceChannels: { leaveCall: async (...args) => calls.push(["leaveCall", ...args]) } },
        "./Recipient": { Recipient: { delete: async () => calls.push(["recipient"]) } },
        "./User": { User: { findOneOrFail: async () => ({ toPublicUser: () => ({}) }) } },
        "../../util/dtos": { DmChannelDTO: { from: async () => ({}) } },
        "@spacebar/util/util": { emitEvent: async () => {} },
        "@spacebar/schemas": { ChannelType: { GROUP_DM: 3 }, PublicUserProjection: [], MessageType: {} },
    });
    const channel = { id: "call", type: 3, owner_id: "owner", recipients: [{ user_id: "owner" }, { user_id: "user" }], save: async () => {} };
    await Channel.removeRecipientFromChannel(channel, "user", "owner", true);
    assert.deepEqual(calls[0], ["leaveCall", "call", "user"]);
});

test("leaving a call clears the voice state and tells the call", async () => {
    const events = [];
    const saved = [];
    const state = { user_id: "user", session_id: "session", channel_id: "call", guild_id: null, connected_at: 5, self_video: true, self_stream: true };
    let where;
    const { VoiceChannels } = load("src/database/voice/VoiceChannels.ts", {
        typeorm: { IsNull: () => "null" },
        "@spacebar/util/util": { emitEvent: async (event) => events.push(event), Config: {} },
        "../entities/VoiceState": {
            VoiceState: {
                findOne: async (options) => {
                    where = options.where;
                    return {
                        ...state,
                        save: async function () {
                            saved.push({ ...this });
                        },
                        toPublicVoiceState() {
                            return { user_id: this.user_id, session_id: this.session_id, channel_id: this.channel_id };
                        },
                    };
                },
            },
        },
        "./PrivateCalls": { PrivateCalls: { leave: async () => {} } },
        "./StreamPreviews": { GoLiveStreams: { end: async () => {} } },
        "./ActivityInstances": { ActivityInstances: { userLeftChannel: async () => {} } },
        "../insights/GuildInsights": { GuildInsights: { voiceLeft() {} } },
    });
    assert.equal(await VoiceChannels.leaveCall("call", "user"), true);
    assert.deepEqual({ ...where }, { user_id: "user", channel_id: "call", guild_id: "null" });
    assert.equal(saved[0].channel_id, null);
    assert.equal(events[0].event, "VOICE_STATE_UPDATE");
    assert.equal(events[0].channel_id, "call");
    assert.equal(events[0].data.channel_id, null);
});
