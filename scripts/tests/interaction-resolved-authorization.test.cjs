const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function fixture(messages = [], readable = true) {
    const source = fs.readFileSync("src/api/util/handlers/Interaction.ts", "utf8");
    const extracted =
        source.slice(source.indexOf("export function canReadInteractionMessage"), source.indexOf("async function emitToAudience")) +
        source.slice(source.indexOf("export async function buildResolved"), source.indexOf("async function interactionMetadata"));
    const calls = [];
    const context = {
        exports: {},
        EPHEMERAL: 64,
        messageRelations: {},
        In: (ids) => ids,
        ApplicationCommandOptionType: { USER: 6, ROLE: 8, CHANNEL: 7, MENTIONABLE: 9 },
        DiscordApiErrors: { MISSING_PERMISSIONS: new Error("missing permissions"), UNKNOWN_MESSAGE: new Error("unknown message") },
        getPermission: async () => ({
            has: () => readable,
            hasThrow: () => {
                if (!readable) throw new Error("missing permissions");
            },
        }),
        Message: {
            find: async (query) => {
                calls.push(query);
                return messages.filter((message) => message.channel_id === query.where.channel_id);
            },
        },
        User: {
            find: async (query) => {
                calls.push(query);
                return [];
            },
        },
        Member: { find: async () => [{ id: "member" }] },
        Channel: {
            findOneOrFail: async () => ({ recipients: [{ user_id: "recipient" }] }),
            find: async () => [
                { id: "selected", guild_id: "guild" },
                { id: "hidden", guild_id: "guild" },
            ],
        },
    };
    vm.runInNewContext(ts.transpileModule(extracted, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
    return { ...context.exports, calls };
}

const message = (channel_id, flags = 0, user_id = "requester") => ({
    id: "message",
    channel_id,
    flags,
    interaction_metadata: { user_id },
    toJSON() {
        return { id: this.id, content: "private" };
    },
});

test("message context targets require the selected channel and history access", async () => {
    const crossChannel = fixture([message("other")]);
    await assert.rejects(crossChannel.buildResolved([], "guild", "selected", { messages: ["message"] }, "requester"), /unknown message/);
    assert.equal(crossChannel.calls[0].where.channel_id, "selected");
    const denied = fixture([message("selected")], false);
    await assert.rejects(denied.buildResolved([], "guild", "selected", { messages: ["message"] }, "requester"), /missing permissions/);
    assert.equal(denied.calls.length, 0);
});

test("ephemeral targets belong only to their interaction requester", async () => {
    const denied = fixture([message("selected", 64, "other")]);
    await assert.rejects(denied.buildResolved([], "guild", "selected", { messages: ["message"] }, "requester"), /unknown message/);
    const allowed = fixture([message("selected", 64)]);
    const resolved = await allowed.buildResolved([], "guild", "selected", { messages: ["message"] }, "requester");
    assert.equal(resolved.messages.message.id, "message");
    assert.equal(allowed.canReadInteractionMessage(message("other"), "selected", "requester"), false);
});

test("channel entity options do not resolve inaccessible channels", async () => {
    const denied = fixture([], false);
    assert.equal(await denied.buildResolved([{ type: 7, value: "hidden" }], "guild", "selected", {}, "requester"), undefined);
    const allowed = fixture();
    const resolved = await allowed.buildResolved([{ type: 7, value: "selected" }], "guild", "selected", {}, "requester");
    assert.deepEqual(Object.keys(resolved.channels), ["selected"]);
});

test("user entity options are limited to guild members or DM recipients", async () => {
    const guild = fixture();
    await guild.buildResolved(
        [
            { type: 6, value: "unrelated" },
            { type: 6, value: "member" },
        ],
        "guild",
        "selected",
        {},
        "requester",
    );
    assert.deepEqual(Array.from(guild.calls[0].where.id), ["member"]);
    const dm = fixture();
    await dm.buildResolved(
        [
            { type: 6, value: "unrelated" },
            { type: 6, value: "recipient" },
        ],
        undefined,
        "selected",
        {},
        "requester",
    );
    assert.deepEqual(Array.from(dm.calls[0].where.id), ["recipient"]);
});
