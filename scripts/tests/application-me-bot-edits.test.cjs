const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

class HTTPError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}

function botRoute() {
    const app = {
        id: "app",
        flags: 0,
        redirect_uris: [],
        description: "",
        tags: [],
        bot: { assign() {}, save: async () => {} },
        assign(values) {
            Object.assign(this, values);
        },
        save: async () => {},
    };
    let patch;
    const imports = {
        express: { Router: () => ({ get() {}, patch: (_, ...steps) => (patch = steps.at(-1)) }) },
        "lambert-server/HTTPError": { HTTPError },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/api/util/handlers/Application": { toOwnedApplication: (value) => value },
        "@spacebar/database": { Application: { findOneOrFail: async () => app } },
        "@spacebar/util": { handleFile: async () => "hash" },
        "@spacebar/schemas": {},
    };
    const loaded = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/routes/applications/@me.ts", "utf8"), {
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
    return { app, edit: (body) => patch({ user_id: "app", body }, { json() {} }) };
}

test("a bot token cannot change the oauth2 settings, flags or links of its application", async () => {
    for (const body of [
        { flags: 256 },
        { redirect_uris: ["https://evil.example/cb"] },
        { custom_install_url: "javascript:alert(1)" },
        { terms_of_service_url: "javascript:alert(1)" },
        { interactions_endpoint_url: "https://evil.example/interactions" },
        { integration_types_config: { 1: { oauth2_install_params: { scopes: ["email"], permissions: "8" } } } },
        { description: "fine", bot_public: true },
    ]) {
        const { app, edit } = botRoute();
        await assert.rejects(edit(body), (err) => err.code === 403, JSON.stringify(body));
        assert.equal(app.flags, 0);
        assert.equal(app.redirect_uris.length, 0);
        assert.equal(app.description, "");
    }
});

test("a bot can still change its description and tags", async () => {
    const { app, edit } = botRoute();
    await edit({ description: "a helpful bot", tags: [" fun ", "fun", "music"] });
    assert.equal(app.description, "a helpful bot");
    assert.deepEqual([...app.tags], ["fun", "music"]);
    await assert.rejects(edit({ tags: ["x".repeat(21)] }), (err) => err.code === 400);
});
