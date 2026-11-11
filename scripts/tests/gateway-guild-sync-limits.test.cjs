const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const GUILD_MEMBERS = 1n << 1n;
const GUILD_PRESENCES = 1n << 8n;

function harness({ flags = ["VIEW_CHANNEL"], isBot = false, intents = 0n, memberCount = 250 } = {}) {
    const sent = [];
    const finds = [];
    const everyone = Array.from({ length: memberCount }, (_, index) => ({
        id: String(index + 1),
        user: { toPublicUser: () => ({ id: String(index + 1) }) },
        toPublicMember: () => ({ user: { id: String(index + 1) } }),
    }));
    const module = { exports: {} };
    const imports = {
        typeorm: { In: (ids) => ids },
        "@spacebar/database": {
            Member: {
                find: async (options) => {
                    if (options.where.id) return options.where.guild_id.map((guild_id) => ({ guild_id }));
                    finds.push(options);
                    return everyone.slice(0, options.take ?? everyone.length);
                },
            },
        },
        "@spacebar/extensions": {
            Stopwatch: { startNew: () => ({ elapsed: () => ({ totalMilliseconds: 0 }) }) },
            timePromise: async (run) => ({ result: await run(), elapsed: { totalMilliseconds: 0 } }),
        },
        "@spacebar/gateway": {
            OPCODES: { Dispatch: 0 },
            Send: async (_, event) => sent.push(event),
            handleOffloadedGatewayRequest: async () => false,
        },
        "@spacebar/schemas": {},
        "@spacebar/util": {
            Config: { get: () => ({ offload: { gateway: { guildSyncUrl: null } } }) },
            getPermission: async () => ({ has: (flag) => flags.includes(flag) }),
            getUserPresences: async (ids) => new Map(ids.map((id) => [id, { status: "online" }])),
            Intents: { FLAGS: { GUILD_MEMBERS, GUILD_PRESENCES } },
        },
        "./RequestGuildMembers": { FullMemberRequestWindow: 30_000 },
    };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/gateway/opcodes/GuildSync.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            Date,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
            console: { log() {}, error() {} },
        },
    );
    const socket = { user_id: "member", isBot, intents: { has: (bit) => (intents & bit) === bit }, sequence: 1 };
    const sync = async (guild_ids) => {
        await module.exports.onGuildSync.call(socket, { d: guild_ids });
        await new Promise((resolve) => setTimeout(resolve, 10));
    };
    return { sent, finds, sync };
}

test("op 12 gives a regular member at most 100 members, like op 8", async () => {
    const { sent, sync } = harness();
    await sync(["guild-1"]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].d.members.length, 100);
});

test("op 12 sends a moderator the full list at most once per window", async () => {
    const { sent, sync } = harness({ flags: ["VIEW_CHANNEL", "KICK_MEMBERS"] });
    await sync(["guild-1"]);
    await sync(["guild-1"]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].d.members.length, 250);
});

test("op 12 respects bot intents", async () => {
    const without = harness({ isBot: true });
    await without.sync(["guild-1"]);
    assert.equal(without.finds.length, 0);

    const membersOnly = harness({ isBot: true, intents: GUILD_MEMBERS });
    await membersOnly.sync(["guild-1"]);
    assert.equal(membersOnly.sent[0].d.members.length, 250);
    assert.equal(membersOnly.sent[0].d.presences.length, 0);
});
