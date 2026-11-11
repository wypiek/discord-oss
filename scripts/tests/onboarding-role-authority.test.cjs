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
            Math,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    return module.exports;
};

const errors = {
    MISSING_PERMISSIONS: Object.assign(new Error("Missing Permissions"), { code: 50013 }),
    UNKNOWN_ROLE: Object.assign(new Error("Unknown Role"), { code: 10011 }),
};

function onboarding({ actorFlags, actorRoles = [] }) {
    const roles = [
        { id: "guild-1", guild_id: "guild-1", position: 0, managed: false },
        { id: "low", guild_id: "guild-1", position: 1, managed: false },
        { id: "mod", guild_id: "guild-1", position: 5, managed: false },
        { id: "admin", guild_id: "guild-1", position: 10, managed: false },
    ];
    const guild = { id: "guild-1", owner_id: "owner", features: [], onboarding: null, save: async () => {} };
    const database = {
        Guild: { findOneOrFail: async () => guild, emitUpdate: async () => {} },
        Member: { findOneOrFail: async () => ({ roles: roles.filter((role) => actorRoles.includes(role.id)) }) },
        Role: { find: async ({ where }) => roles.filter((role) => where.id.includes(role.id) && role.guild_id === where.guild_id) },
    };
    const util = {
        DiscordApiErrors: errors,
        getPermission: async () => ({
            hasThrow: (flag) => {
                if (!actorFlags.includes(flag)) throw errors.MISSING_PERMISSIONS;
            },
            bitfield: 0n,
        }),
    };
    let handler;
    compile("src/api/routes/guilds/#guild_id/onboarding.ts", {
        express: { Router: () => ({ get() {}, put: (_, ...steps) => (handler = steps.at(-1)) }) },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/database": database,
        "@spacebar/schemas": {},
        "@spacebar/util": util,
        typeorm: { In: (ids) => ids },
        "@spacebar/api/util/utility/fieldCaps": { onboardingCaps() {} },
        "@spacebar/api/util/utility/roleAuthorization": compile("src/api/util/utility/roleAuthorization.ts", { "@spacebar/database": database, "@spacebar/util": util }),
    });
    const put = (role_ids) =>
        handler(
            {
                params: { guild_id: "guild-1" },
                user_id: "moderator",
                body: { enabled: true, prompts: [{ id: "1", title: "pick", options: [{ id: "2", title: "power", role_ids }] }] },
            },
            { json() {} },
        );
    return { put, guild };
}

test("an onboarding option can't hand out a role without MANAGE_ROLES", async () => {
    const { put, guild } = onboarding({ actorFlags: ["MANAGE_GUILD"], actorRoles: ["mod"] });
    await assert.rejects(
        () => put(["admin"]),
        (err) => err === errors.MISSING_PERMISSIONS,
    );
    await assert.rejects(
        () => put(["low"]),
        (err) => err === errors.MISSING_PERMISSIONS,
    );
    assert.equal(guild.onboarding, null);
    await put([]);
    assert.equal(guild.onboarding.prompts.length, 1);
});

test("an onboarding option can only hand out roles below the editor's highest role", async () => {
    const { put, guild } = onboarding({ actorFlags: ["MANAGE_GUILD", "MANAGE_ROLES"], actorRoles: ["mod"] });
    await assert.rejects(
        () => put(["admin"]),
        (err) => err === errors.MISSING_PERMISSIONS,
    );
    await assert.rejects(
        () => put(["missing"]),
        (err) => err === errors.UNKNOWN_ROLE,
    );
    await put(["low"]);
    assert.deepEqual(guild.onboarding.prompts[0].options[0].role_ids, ["low"]);
});
