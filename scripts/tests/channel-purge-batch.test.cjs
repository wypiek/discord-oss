const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

test("a purge loads message ids only, at most 1000 per request", async () => {
    const queries = [];
    const deleted = [];
    const events = [];
    let handler;
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/routes/channels/#channel_id/purge.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) =>
                ({
                    express: { Router: () => ({ post: (_path, ...handlers) => (handler = handlers.at(-1)) }) },
                    "lambert-server/HTTPError": { HTTPError: Error },
                    typeorm: { Between: (a, b) => ({ between: [a, b] }), Not: (value) => ({ not: value }) },
                    "@spacebar/api/middlewares": { route: () => () => {} },
                    "@spacebar/api/util": { noteRightsBypass() {}, permitted: async () => true },
                    "@spacebar/database": {
                        Channel: { findOneOrFail: async () => ({ id: "channel", guild_id: "guild", type: 0 }) },
                        Message: {
                            find: async (query) => {
                                queries.push(query);
                                return Array.from({ length: query.take }, (_, i) => ({ id: String(i + 1) }));
                            },
                            delete: async (ids) => deleted.push(ids.length),
                        },
                    },
                    "@spacebar/util": {
                        emitEvent: async (event) => events.push(event),
                        getPermission: async () => ({ hasThrow() {}, has: () => true }),
                        getRights: async () => ({ has: () => false }),
                    },
                    "@spacebar/schemas": { isTextChannel() {} },
                })[name],
        },
    );
    let status;
    await handler({ params: { channel_id: "channel" }, user_id: "user", body: { before: "9", after: "1" } }, { sendStatus: (code) => (status = code) });
    assert.equal(module.exports.PURGE_BATCH, 1000);
    assert.equal(queries[0].take, 1000);
    assert.deepEqual(Object.keys(queries[0].select), ["id"]);
    assert.equal(queries[0].relations, undefined);
    assert.equal(deleted[0], 1000);
    assert.equal(events[0].data.ids.length, 1000);
    assert.equal(status, 204);
});
