const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const compile = (file, imports) => {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            Number,
            BigInt,
            Object,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    return module.exports;
};

const errors = {
    UNKNOWN_CHANNEL: Object.assign(new Error("Unknown Channel"), { code: 10003 }),
    CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE: Object.assign(new Error("Cannot execute action on this channel type"), { code: 50024 }),
};

const { ChannelFlags } = compile("src/util/util/ChannelFlags.ts", { "./BitField": compile("src/util/util/BitField.ts", {}) });
const ChannelType = { GUILD_TEXT: 0, GUILD_VOICE: 2, GROUP_DM: 3, GUILD_CATEGORY: 4, GUILD_NEWS: 5, GUILD_STAGE_VOICE: 13 };

function harness(target) {
    const channels = [
        { id: "own-category", guild_id: "guild-1", type: ChannelType.GUILD_CATEGORY },
        { id: "own-text", guild_id: "guild-1", type: ChannelType.GUILD_TEXT },
        { id: "foreign-category", guild_id: "guild-2", type: ChannelType.GUILD_CATEGORY },
    ];
    const updates = [];
    const channel = {
        id: "channel-1",
        guild_id: "guild-1",
        type: ChannelType.GUILD_TEXT,
        parent_id: null,
        flags: Number(ChannelFlags.FLAGS.IS_GUILD_RESOURCE_CHANNEL),
        permission_overwrites: [],
        isThread: () => false,
        isForum: () => false,
        toJSON() {
            return { ...this };
        },
        ...target,
    };
    let handler;
    const noop = () => {};
    compile("src/api/routes/channels/#channel_id/index.ts", {
        express: { Router: () => ({ get: noop, delete: noop, patch: (_, ...steps) => (handler = steps.at(-1)) }) },
        typeorm: { Not: (value) => value },
        "@spacebar/api/middlewares": { route: () => noop },
        "@spacebar/api/util": {
            assertOverwriteChanges: noop,
            AUTO_ARCHIVE_DURATION_ERROR: {},
            AUTO_ARCHIVE_DURATIONS: [],
            emitThreadUpdate: noop,
            enforceNameAutomod: async () => {},
            purgeDeletedChannels: noop,
            sendMessage: noop,
            setThreadArchived: noop,
            threadAuditState: noop,
        },
        "@spacebar/database": {
            AuditLog: { channelKeys: [], diff: () => [], log: async () => {} },
            Channel: {
                findOneOrFail: async () => channel,
                findOne: async ({ where }) => channels.find((c) => c.id === where.id && c.guild_id === where.guild_id) ?? null,
                getRepository: () => ({ metadata: { columns: ["name", "parent_id", "flags", "topic", "nsfw"].map((propertyName) => ({ propertyName })) } }),
                update: async (_, update) => updates.push(update),
                calculatePosition: async () => 0,
            },
            Guild: {},
            Recipient: {},
            Tag: {},
            ThreadMember: {},
            VoiceChannels: {},
        },
        "@spacebar/util": {
            ChannelFlags,
            Config: { get: () => ({ limits: { channel: { maxName: 100, maxTopic: 1024 } } }) },
            DiscordApiErrors: errors,
            emitEvent: async () => {},
            FieldError: Error,
            FieldErrors: () => new Error("field"),
            handleFile: async () => null,
            makeObjectErrorContent: noop,
            Snowflake: {},
        },
        "@spacebar/schemas": { AuditLogEvents: {}, ChannelType, MessageType: {} },
    });
    const patch = (body) => handler({ params: { channel_id: channel.id }, body, user_id: "manager", headers: {}, permission: { hasThrow: noop } }, { send() {} });
    return { patch, updates, channel };
}

test("a channel can only move under a category of its own guild", async () => {
    const { patch, updates } = harness();
    await assert.rejects(patch({ parent_id: "foreign-category" }), (err) => err === errors.UNKNOWN_CHANNEL);
    await assert.rejects(patch({ parent_id: "own-text" }), (err) => err === errors.UNKNOWN_CHANNEL);
    await assert.rejects(patch({ parent_id: "missing" }), (err) => err === errors.UNKNOWN_CHANNEL);
    assert.equal(updates.length, 0);
    await patch({ parent_id: "own-category" });
    assert.deepEqual(updates, [{ parent_id: "own-category" }]);
});

test("categories and group dms can't get a parent", async () => {
    await assert.rejects(harness({ type: ChannelType.GUILD_CATEGORY }).patch({ parent_id: "own-category" }), (err) => err === errors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE);
    await assert.rejects(harness({ type: ChannelType.GROUP_DM, guild_id: null }).patch({ parent_id: "own-category" }), (err) => err === errors.CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE);
});

test("channel PATCH keeps system flags and drops application_id", async () => {
    const { patch, updates } = harness();
    const system = ChannelFlags.FLAGS.IS_MODERATOR_REPORT_CHANNEL | ChannelFlags.FLAGS.IS_SPAM | ChannelFlags.FLAGS.CLYDE_AI;
    await patch({ flags: Number(system | ChannelFlags.FLAGS.REQUIRE_TAG), application_id: "123" });
    assert.deepEqual(updates, [{ flags: Number(ChannelFlags.FLAGS.IS_GUILD_RESOURCE_CHANNEL | ChannelFlags.FLAGS.REQUIRE_TAG) }]);
});
