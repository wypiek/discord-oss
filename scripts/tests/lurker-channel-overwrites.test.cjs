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
            Date,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    return module.exports;
};

const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const READ_MESSAGE_HISTORY = 1n << 16n;

function permissions({ member, discoverable = true }) {
    const everyone = { id: "guild", guild_id: "guild", permissions: String(VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY) };
    class Member {}
    const query = (result) => ({ setFindOptions: () => ({ getOne: async () => result, getOneOrFail: async () => result }) });
    return compile("src/util/util/Permissions.ts", {
        "../../database/entities": {
            Application: {},
            Member: Object.assign(Member, { createQueryBuilder: () => query(member ? Object.assign(new Member(), member) : null) }),
            User: {},
            Role: { find: async () => [everyone] },
            Guild: {
                findOneOrFail: async () => ({ id: "guild", owner_id: "owner", verification_level: 0, mfa_level: 0 }),
                existsBy: async () => discoverable,
            },
            Channel: class {},
            ThreadMember: class {},
        },
        "./BitField": compile("src/util/util/BitField.ts", {}),
        "lambert-server/HTTPError": { HTTPError: class extends Error {} },
        "./Constants": { DiscordApiErrors: {} },
        "@spacebar/schemas": {
            ChannelType: { GUILD_PRIVATE_THREAD: 12 },
            ChannelPermissionOverwriteType: { role: 0, member: 1 },
            UserFlags: { FLAGS: { QUARANTINED: 1n << 44n } },
        },
        typeorm: { ArrayContains: () => ({}), EntityNotFoundError: class extends Error {} },
        "@spacebar/util": { OrmUtils: { keysToObject: (list) => Object.fromEntries(list.map((key) => [key, true])) } },
    });
}

const user = { id: "lurker", flags: 0, mfa_enabled: false, bot: false };
const hidden = [{ id: "guild", type: 0, allow: "0", deny: String(VIEW_CHANNEL) }];
const chatty = [{ id: "guild", type: 0, allow: String(SEND_MESSAGES), deny: "0" }];

test("a lurker keeps the @everyone deny when channel overwrites are applied to their guild permissions", async () => {
    const { getPermission } = permissions({ member: null });
    const guildLevel = await getPermission("lurker", "guild", undefined, { user });
    assert.equal(guildLevel.has("VIEW_CHANNEL"), true);
    assert.equal(guildLevel.overwriteChannel(hidden).has("VIEW_CHANNEL"), false);
});

test("channel overwrites cannot lift a lurker above view and read history", async () => {
    const { getPermission } = permissions({ member: null });
    const guildLevel = await getPermission("lurker", "guild", undefined, { user });
    const channel = guildLevel.overwriteChannel(chatty);
    assert.equal(channel.has("VIEW_CHANNEL"), true);
    assert.equal(channel.has("SEND_MESSAGES"), false);
});

test("an automod quarantined member keeps the quarantine mask after channel overwrites", async () => {
    const { getPermission } = permissions({
        member: { id: "lurker", guild_id: "guild", flags: 128, roles: [{ id: "guild", guild_id: "guild", permissions: "0" }], communication_disabled_until: null },
    });
    const guildLevel = await getPermission("lurker", "guild", undefined, { user });
    assert.equal(guildLevel.overwriteChannel(chatty).has("SEND_MESSAGES"), false);
});
