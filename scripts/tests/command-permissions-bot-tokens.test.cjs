const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const BOT_PROHIBITED_ENDPOINT = Object.assign(new Error("Bots cannot use this endpoint"), { code: 20001 });

function permissionsRoute() {
    const saved = [];
    const handlers = {};
    const router = () => ({
        get: (_, ...steps) => (handlers.get = steps.at(-1)),
        put: (_, ...steps) => (handlers.put = steps.at(-1)),
        post() {},
        patch() {},
        delete() {},
    });
    const imports = {
        express: { Router: router },
        typeorm: { In: (values) => values, IsNull: () => null },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/database": {
            Application: {},
            ApplicationAuthorization: {},
            ApplicationCommand: { exists: async () => true },
            ApplicationCommandPermission: {
                create: (values) => ({ ...values, save: async () => saved.push(values), toJSON: () => values }),
                delete: async () => {},
            },
            ApplicationCommandPermissionOverwrite: {},
            Member: { exists: async () => true },
        },
        "@spacebar/schemas": { ApplicationCommandType: {} },
        "@spacebar/util": {
            ApiError: class extends Error {},
            DiscordApiErrors: { BOT_PROHIBITED_ENDPOINT, UNKNOWN_APPLICATION_COMMAND: new Error("unknown command") },
            emitEvent: async () => {},
            FieldErrors: () => new Error("field"),
            getPermission: async () => ({ hasThrow() {} }),
            Snowflake: {},
        },
        "@spacebar/api/util/handlers/FieldCaps": { commandLocalizationErrors: () => ({}) },
    };
    const loaded = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/util/handlers/ApplicationCommands.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module: loaded,
            exports: loaded.exports,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    loaded.exports.commandPermissionsRouter();
    const put = (user_bot) =>
        handlers.put(
            {
                user_id: user_bot ? "other-bot" : "admin",
                user_bot,
                params: { application_id: "app", guild_id: "guild", command_id: "1234" },
                body: { permissions: [{ id: "guild", type: 1, permission: true }] },
            },
            { json() {} },
        );
    return { put, saved };
}

test("a bot token cannot rewrite command permissions", async () => {
    const { put, saved } = permissionsRoute();
    await assert.rejects(put(true), (err) => err === BOT_PROHIBITED_ENDPOINT);
    assert.equal(saved.length, 0);
    await put(false);
    assert.equal(saved.length, 1);
});
