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

function tagRoute() {
    const removed = [];
    const tag = (id, channel_id) => ({ id, channel_id, remove: async () => removed.push(id) });
    const channels = {
        mine: { id: "mine", available_tags: [tag("own-tag", "mine")] },
        theirs: { id: "theirs", available_tags: [tag("their-tag", "theirs")] },
    };
    const allTags = Object.values(channels).flatMap((channel) => channel.available_tags);
    let remove;
    const imports = {
        express: { Router: () => ({ post() {}, put() {}, delete: (_, ...steps) => (remove = steps.at(-1)) }) },
        "lambert-server/HTTPError": { HTTPError },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/database": {
            Channel: {
                findOneOrFail: async ({ where }) => {
                    const channel = channels[where.id];
                    return {
                        ...channel,
                        available_tags: [...channel.available_tags],
                        isForum: () => true,
                        toJSON() {
                            return this;
                        },
                    };
                },
            },
            Tag: {
                create: () => ({}),
                findOneByOrFail: async ({ id }) => {
                    const found = allTags.find((t) => t.id === id);
                    if (!found) throw new Error("not found");
                    return found;
                },
            },
        },
        "@spacebar/util": { emitEvent: async () => {}, FieldErrors: () => new Error("field") },
        "@spacebar/schemas": {},
    };
    const loaded = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/routes/channels/#channel_id/tags.ts", "utf8"), {
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
    return {
        removed,
        remove: (channel_id, tag_id) => remove({ params: { channel_id, tag_id } }, { json() {} }),
    };
}

test("deleting a tag through a forum the caller manages cannot remove another forum's tag", async () => {
    const route = tagRoute();
    await assert.rejects(route.remove("mine", "their-tag"), (err) => err.code === 404);
    assert.deepEqual(route.removed, []);
});

test("a forum's own tag can still be deleted", async () => {
    const route = tagRoute();
    await route.remove("mine", "own-tag");
    assert.deepEqual(route.removed, ["own-tag"]);
});
