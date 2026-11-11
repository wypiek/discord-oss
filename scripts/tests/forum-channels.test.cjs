const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const plain = (value) => JSON.parse(JSON.stringify(value));

const compile = (file, imports, globals = {}) => {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, experimentalDecorators: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            BigInt,
            Number,
            Object,
            Promise,
            ...globals,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    return module.exports;
};

test("forum settings accept the client's unicode default reaction, which has no emoji_id", () => {
    const schemas = JSON.parse(fs.readFileSync("assets/schemas.json", "utf8").replaceAll("#/definitions/", ""));
    const ajv = new Ajv({ allErrors: true, coerceTypes: true, strict: true, strictRequired: true, allowUnionTypes: true, parseDate: true, allowDate: true });
    addFormats(ajv);
    for (const [name, schema] of Object.entries(schemas)) ajv.addSchema(schema, name);
    for (const name of ["ChannelModifySchema", "GuildChannelCreateSchema"]) {
        assert.equal(ajv.validate(name, { name: "forum", type: 15, default_reaction_emoji: { emoji_name: "🔥" } }), true, `${name} ${JSON.stringify(ajv.errors)}`);
        assert.equal(ajv.validate(name, { default_reaction_emoji: { emoji_id: "123" } }), true, name);
        assert.equal(ajv.validate(name, { default_reaction_emoji: null }), true, name);
    }
});

test("a default reaction is stored as either a custom emoji id or a unicode name", () => {
    const { normalizeDefaultReaction } = compile("src/schemas/api/channels/Channel.ts", {
        "@spacebar/database": {},
        "lambert-server/HTTPError": {},
        "../../Identifiers": {},
        "../users": {},
    });
    assert.deepEqual(plain(normalizeDefaultReaction({ emoji_name: "🔥" })), { emoji_id: null, emoji_name: "🔥" });
    assert.deepEqual(plain(normalizeDefaultReaction({ emoji_id: "123", emoji_name: "custom" })), { emoji_id: "123", emoji_name: null });
    assert.equal(normalizeDefaultReaction({ emoji_id: null, emoji_name: null }), null);
    assert.equal(normalizeDefaultReaction(null), null);
});

test("editing a tag replaces its emoji instead of keeping the old one", () => {
    const decorator = () => () => {};
    const { Tag } = compile("src/database/entities/Tag.ts", {
        typeorm: { Column: decorator, Entity: decorator, JoinColumn: decorator, ManyToOne: decorator, Index: decorator },
        "./BaseClass": { BaseClass: class {} },
        "./Channel": { Channel: class {} },
    });
    const tag = new Tag().assignInput({ name: "Bug", emoji_id: "123" });
    assert.deepEqual(plain(tag.toJSON()), { name: "Bug", moderated: false, emoji_id: "123", emoji_name: null });
    tag.assignInput({ name: "Bug", emoji_name: "🔥", moderated: true });
    assert.deepEqual([tag.emoji_id, tag.emoji_name, tag.moderated], [null, "🔥", true]);
    tag.assignInput({ name: "Bug", emoji_name: null });
    assert.deepEqual([tag.emoji_id, tag.emoji_name], [null, null]);
});

test("forum tag routes refuse channels that aren't forums with a channel type error", async () => {
    const CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE = Object.assign(new Error("Cannot execute action on this channel type"), { code: 50024 });
    const handlers = {};
    const capture =
        (method) =>
        (_, ...steps) =>
            (handlers[method] = steps.at(-1));
    compile("src/api/routes/channels/#channel_id/tags.ts", {
        express: { Router: () => ({ post: capture("post"), put: capture("put"), delete: capture("delete") }) },
        "lambert-server/HTTPError": { HTTPError: Error },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/api/util": { removeAppliedTags: async () => {} },
        "@spacebar/database": { Channel: { findOneOrFail: async () => ({ id: "thread", available_tags: [], isForum: () => false }) }, Tag: {} },
        "@spacebar/util": { DiscordApiErrors: { CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE }, emitEvent: async () => {}, FieldErrors: () => new Error("field") },
        "@spacebar/schemas": {},
    });
    const req = { params: { channel_id: "thread", tag_id: "1" }, body: { name: "tag" } };
    for (const method of ["post", "put", "delete"]) await assert.rejects(handlers[method](req, { json() {} }), (err) => err.code === 50024, method);
});

function forumUnreads({ forum = { type: 15 }, threads = [], counts = {}, permissions = ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"] } = {}) {
    const sent = [];
    const countQueries = [];
    const { onRequestForumUnreads, MAX_FORUM_UNREAD_THREADS } = compile("src/gateway/opcodes/RequestForumUnreads.ts", {
        "@spacebar/database": {
            Channel: {
                findOne: async () => (forum ? { ...forum, isForum: () => forum.type === 15 || forum.type === 16 } : null),
                find: async ({ where }) =>
                    threads
                        .filter((thread) => where.id.includes(thread.id))
                        .map((thread) => ({ type: 11, ...thread, isThread: () => true, isPrivateThread: () => thread.type === 12 })),
            },
            Message: {
                count: async ({ where }) => {
                    countQueries.push([where.channel_id, where.id]);
                    return counts[where.channel_id] ?? 0;
                },
            },
        },
        typeorm: { In: (values) => values, MoreThan: (value) => value },
        "@spacebar/gateway": { OPCODES: { Dispatch: 0 }, Send: async (_socket, payload) => sent.push(payload) },
        "@spacebar/util": { getPermission: async () => ({ has: (permission) => permissions.includes(permission) }) },
    });
    const socket = { user_id: "user", sequence: 1 };
    return { request: (d) => onRequestForumUnreads.call(socket, { op: 28, d }), sent, countQueries, MAX_FORUM_UNREAD_THREADS };
}

test("the gateway answers a forum unread request with message counts after each ack", async () => {
    const harness = forumUnreads({
        threads: [
            { id: "100", last_message_id: "130" },
            { id: "200", last_message_id: "200" },
            { id: "300", last_message_id: "320" },
        ],
        counts: { 100: 3, 300: 2 },
    });
    await harness.request({
        guild_id: "1",
        channel_id: "2",
        threads: [
            { thread_id: "100", ack_message_id: "110" },
            { thread_id: "200", ack_message_id: null },
            { thread_id: "300", ack_message_id: null },
            { thread_id: "400", ack_message_id: "1" },
            { thread_id: "not-a-snowflake", ack_message_id: null },
        ],
    });
    assert.equal(harness.sent.length, 1);
    assert.equal(harness.sent[0].t, "FORUM_UNREADS");
    assert.deepEqual(plain(harness.sent[0].d), {
        guild_id: "1",
        channel_id: "2",
        threads: [
            { thread_id: "100", count: 3 },
            { thread_id: "200", count: 0 },
            { thread_id: "300", count: 2 },
            { thread_id: "400", missing: true },
        ],
    });
    assert.deepEqual(plain(harness.countQueries), [
        ["100", "110"],
        ["300", "300"],
    ]);
});

test("a forum unread request without read access or for a text channel is denied", async () => {
    for (const harness of [forumUnreads({ permissions: ["VIEW_CHANNEL"] }), forumUnreads({ forum: { type: 0 } }), forumUnreads({ forum: null })]) {
        await harness.request({ guild_id: "1", channel_id: "2", threads: [{ thread_id: "100", ack_message_id: null }] });
        assert.deepEqual(plain(harness.sent[0].d), { guild_id: "1", channel_id: "2", threads: [], permission_denied: true });
        assert.equal(harness.countQueries.length, 0);
    }
});

test("a forum unread request counts at most as many posts as the client asks for", async () => {
    const harness = forumUnreads();
    const threads = Array.from({ length: 500 }, (_, i) => ({ thread_id: String(1000 + i), ack_message_id: null }));
    await harness.request({ guild_id: "1", channel_id: "2", threads });
    assert.equal(harness.sent[0].d.threads.length, harness.MAX_FORUM_UNREAD_THREADS);
});

test("typing in a forum post needs Send Messages in Posts, not Create Posts", async () => {
    let options;
    let handler;
    compile("src/api/routes/channels/#channel_id/typing.ts", {
        express: { Router: () => ({ post: (_, routeOptions, step) => ((options = routeOptions), (handler = step)) }) },
        "@spacebar/api/util/handlers/Slowmode": { messageSlowmodeCooldown: async () => 0 },
        "@spacebar/api/middlewares": { route: (routeOptions) => routeOptions },
        "@spacebar/database": {
            Channel: { findOneOrFail: async () => ({ id: "post", guild_id: null, isThread: () => true }) },
            Member: {},
        },
        "@spacebar/util": { emitEvent: async () => {}, getPermission: async () => {} },
    });
    assert.equal(options.permission, "VIEW_CHANNEL");
    const checked = [];
    await handler({ params: { channel_id: "post" }, user_id: "user", permission: { hasThrow: (permission) => checked.push(permission) } }, { sendStatus() {} }).catch(() => {});
    assert.deepEqual(plain(checked), ["SEND_MESSAGES_IN_THREADS"]);
});

test("replies in threads check Send Messages in Threads while the forum starter message checks neither", () => {
    const source = fs.readFileSync("src/api/util/handlers/Message.ts", "utf8");
    assert.match(
        source,
        /if \(!channel\.isThread\(\)\) permission\.hasThrow\("SEND_MESSAGES"\);\s+else if \(message\.id !== channel\.id\) permission\.hasThrow\("SEND_MESSAGES_IN_THREADS"\);/,
    );
    const edit = fs.readFileSync("src/api/routes/channels/#channel_id/messages/#message_id/index.ts", "utf8");
    assert.match(edit, /req\.permission!\.hasThrow\(req\.channel!\.isThread\(\) \? "SEND_MESSAGES_IN_THREADS" : "SEND_MESSAGES"\);/);
});
