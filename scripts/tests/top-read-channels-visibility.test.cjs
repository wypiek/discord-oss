const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function topRead(admin) {
    let handler;
    const channels = [
        { id: "general", last_message_id: "10", permission_overwrites: [] },
        { id: "staff", last_message_id: "20", permission_overwrites: [{ deny: "view" }] },
    ];
    const permission = (visible) => ({
        has: (flag) => (flag === "ADMINISTRATOR" ? admin : visible && flag === "VIEW_CHANNEL"),
        overwriteChannel: (overwrites) => permission(!overwrites.some((overwrite) => overwrite.deny === "view")),
    });
    const imports = {
        express: { Router: () => ({ get: (_, ...steps) => (handler = steps.at(-1)) }) },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/database": { Channel: { find: async () => channels } },
        "@spacebar/schemas": { ChannelType: { GUILD_TEXT: 0 } },
        typeorm: { Not: (value) => value, IsNull: () => null },
        "@spacebar/util": { getPermission: async () => permission(true) },
    };
    const loaded = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/routes/guilds/#guild_id/top-read-channels.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module: loaded,
            exports: loaded.exports,
            BigInt,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    return async () => {
        let body;
        await handler({ user_id: "member", params: { guild_id: "guild" } }, { json: (value) => (body = value) });
        return [...body];
    };
}

test("top read channels only lists channels the member can see", async () => {
    assert.deepEqual(await topRead(false)(), ["general"]);
    assert.deepEqual(await topRead(true)(), ["staff", "general"]);
});
