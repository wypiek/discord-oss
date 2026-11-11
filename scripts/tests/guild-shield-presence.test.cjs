const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

test("the public shield counts only members whose presence is visible", async () => {
    const presences = { 10: "online", 20: "invisible", 30: "idle", 40: "dnd" };
    const finds = [];
    let handler;
    const imports = {
        "node:fs": { readFileSync: () => "" },
        "node:path": { join: (...parts) => parts.join("/") },
        "badge-maker": { makeBadge: (options) => JSON.stringify(options) },
        express: { Router: () => ({ get: (_, ...steps) => (handler = steps.at(-1)) }) },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/database": {
            Guild: { findOneOrFail: async () => ({ widget_enabled: true }) },
            Member: {
                find: async (options) => {
                    finds.push(options);
                    return ["10", "20", "30", "40", "50"].map((id) => ({ id }));
                },
            },
        },
        "@spacebar/util": {
            DiscordApiErrors: {},
            instanceName: () => "Meow",
            getUserPresences: async (ids) => new Map(ids.filter((id) => presences[id] && presences[id] !== "invisible").map((id) => [id, { status: presences[id] }])),
        },
    };
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/routes/guilds/#guild_id/shield.svg.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            Buffer,
            Date,
            Map,
            __dirname: "/srv",
            console: { log() {} },
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    let body;
    await handler({ params: { guild_id: "guild-1" } }, { set() {}, status: () => ({ send: (value) => (body = JSON.parse(value)) }) });
    assert.equal(body.message, "3 online");
    assert.equal(body.label, "Meow");
    assert.equal(finds[0].relations, undefined);
});
