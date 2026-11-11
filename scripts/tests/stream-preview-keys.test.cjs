const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

class HTTPError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

function load() {
    const routes = {};
    const previews = new Map();
    const streams = [{ owner_id: "owner", channel_id: "channel", channel: { guild_id: "guild" } }];
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/routes/streams/#stream_key/preview.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            setTimeout,
            clearTimeout,
            require: (name) =>
                ({
                    express: { Router: () => ({ get: (_path, ...handlers) => (routes.get = handlers.at(-1)), post: (_path, ...handlers) => (routes.post = handlers.at(-1)) }) },
                    "@spacebar/api/middlewares": { route: () => () => {} },
                    "lambert-server": { HTTPError },
                    "@spacebar/database": {
                        Stream: { find: async ({ where }) => streams.filter((stream) => stream.owner_id === where.owner_id), exists: async () => true },
                        StreamPreviews: previews,
                        GoLiveStreams: {
                            key: (stream) =>
                                stream.channel?.guild_id
                                    ? `guild:${stream.channel.guild_id}:${stream.channel_id}:${stream.owner_id}`
                                    : `call:${stream.channel_id}:${stream.owner_id}`,
                        },
                    },
                })[name],
        },
    );
    const post = async (key, user = "owner") => {
        let status;
        await routes.post({ params: { stream_key: key }, user_id: user, body: { thumbnail: "data:image/png;base64,AAAA" } }, { sendStatus: (code) => (status = code) });
        return status;
    };
    return { post, previews };
}

test("an owner can only store a preview under the key of a stream they are running", async () => {
    const { post, previews } = load();
    assert.equal(await post("guild:guild:channel:owner"), 204);
    for (let i = 0; i < 50; i++) await assert.rejects(post(`junk${i}:owner`), (error) => error.status === 404);
    await assert.rejects(post("guild:guild:other:owner"), (error) => error.status === 404);
    assert.deepEqual([...previews.keys()], ["guild:guild:channel:owner"]);
});

test("someone else can't upload a preview for the owner's stream", async () => {
    const { post, previews } = load();
    await assert.rejects(post("guild:guild:channel:owner", "intruder"), (error) => error.status === 403);
    assert.equal(previews.size, 0);
});
