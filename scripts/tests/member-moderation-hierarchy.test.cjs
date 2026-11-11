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
            Math,
            Map,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    return module.exports;
};

const MISSING_PERMISSIONS = Object.assign(new Error("Missing Permissions"), { code: 50013 });

function guild() {
    const roles = { mod: { id: "mod", position: 5 }, high: { id: "high", position: 10 }, low: { id: "low", position: 1 } };
    const members = [
        { id: "moderator", roles: [roles.mod] },
        { id: "peer", roles: [roles.mod] },
        { id: "admin", roles: [roles.high] },
        { id: "newbie", roles: [roles.low] },
        { id: "owner", roles: [] },
    ];
    const database = {
        AuditLog: {},
        Ban: {},
        Guild: { findOneOrFail: async () => ({ id: "guild-1", owner_id: "owner" }) },
        GuildInsights: {},
        Member: {
            find: async ({ where }) => members.filter((member) => where.id.includes(member.id)),
            changeNickname: async (id, _, nick) => (members.find((member) => member.id === id).nick = nick),
            findOne: async () => ({ toPublicMember: () => ({}) }),
        },
        Message: {},
        User: {},
    };
    const bans = compile("src/api/util/utility/bans.ts", {
        "@spacebar/database": database,
        "@spacebar/util": { DiscordApiErrors: { MISSING_PERMISSIONS } },
        "@spacebar/schemas": { AuditLogEvents: {}, PublicUserProjection: [] },
        typeorm: { In: (ids) => ids, MoreThan: () => ({}) },
    });
    return { bans, database, members };
}

test("a moderator can only act on members whose top role is lower than theirs", async () => {
    const { bans } = guild();
    await bans.assertOutranks("guild-1", "moderator", "newbie");
    for (const target of ["peer", "admin", "owner"]) await assert.rejects(bans.assertOutranks("guild-1", "moderator", target), (err) => err === MISSING_PERMISSIONS, target);
    for (const target of ["admin", "moderator", "newbie"]) await bans.assertOutranks("guild-1", "owner", target);
});

test("the nick route applies the role hierarchy to other members and not to yourself", async () => {
    const { bans, database, members } = guild();
    let handler;
    compile("src/api/routes/guilds/#guild_id/members/#member_id/nick.ts", {
        express: { Router: () => ({ patch: (_, ...steps) => (handler = steps.at(-1)) }) },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/api/util": bans,
        "@spacebar/database": database,
        "@spacebar/util": { getPermission: async () => ({ hasThrow() {} }) },
    });
    const rename = (member_id, nick) => handler({ params: { guild_id: "guild-1", member_id }, user_id: "moderator", body: { nick } }, { send() {} });
    await assert.rejects(rename("admin", "pwned"), (err) => err === MISSING_PERMISSIONS);
    await assert.rejects(rename("peer", "pwned"), (err) => err === MISSING_PERMISSIONS);
    await rename("newbie", "renamed");
    await rename("moderator", "me");
    await rename("@me", "me again");
    assert.deepEqual(
        members.map((member) => member.nick ?? null),
        ["me again", null, null, "renamed", null],
    );
});

test("every route that changes another member's nick checks the hierarchy", () => {
    for (const file of ["src/api/routes/guilds/#guild_id/members/#member_id/index.ts", "src/api/routes/guilds/#guild_id/profile/index.ts"]) {
        const source = fs.readFileSync(file, "utf8");
        assert.match(source, /hasThrow\((Permissions\.FLAGS\.MANAGE_NICKNAMES|"MANAGE_NICKNAMES")\);\s+await assertOutranks\(guild_id, req\.user_id, member_id\);/, file);
    }
});

test("kicking another member checks the hierarchy before removing them", () => {
    const source = fs.readFileSync("src/api/routes/guilds/#guild_id/members/#member_id/index.ts", "utf8");
    const kick = source.slice(source.indexOf("router.delete("));
    assert.match(kick, /permission\.hasThrow\("KICK_MEMBERS"\);\s+await assertOutranks\(guild_id, req\.user_id, member_id\);/);
    assert.ok(kick.indexOf("assertOutranks(") < kick.indexOf("Member.removeFromGuild("));
});
