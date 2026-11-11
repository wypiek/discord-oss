const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function fixture(channels, rows = []) {
    let handler;
    const reads = [];
    const permissionReads = [];
    const source = ts.transpileModule(fs.readFileSync("src/api/routes/channels/preload-messages.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exported = { exports: {} };
    vm.runInNewContext(source, {
        module: exported,
        exports: exported.exports,
        require(name) {
            if (name === "express")
                return {
                    Router: () => ({
                        post: (...args) => {
                            handler = args.at(-1);
                        },
                    }),
                };
            if (name === "@spacebar/api/middlewares") return { route: () => () => {} };
            if (name === "@spacebar/util")
                return {
                    Config: { get: () => ({ limits: { message: { maxPreloadCount: 10 } } }) },
                    getPermission: async (userId, guildId, channelId) => {
                        permissionReads.push({ userId, guildId, channelId });
                        if (!channels[channelId]) throw new Error("unknown or inaccessible channel");
                        return { has: (permission) => channels[channelId].includes(permission) };
                    },
                };
            if (name === "@spacebar/database")
                return {
                    Message: {
                        createQueryBuilder(alias) {
                            const call = { alias };
                            reads.push(call);
                            return {
                                setFindOptions(options) {
                                    call.options = options;
                                    return this;
                                },
                                andWhere(sql, parameters) {
                                    call.sql = sql;
                                    call.parameters = parameters;
                                    return this;
                                },
                                async getOne() {
                                    assert.equal(call.sql, "((message.flags & :ephemeral) != :ephemeral OR message.interaction_metadata ->> 'user_id' = :requester)");
                                    assert.equal(call.parameters.ephemeral, 64);
                                    assert.equal(call.parameters.requester, "requester");
                                    return (
                                        rows
                                            .filter((row) => row.channel_id === call.options.where.channel_id)
                                            .filter((row) => !(row.flags & call.parameters.ephemeral) || row.interaction_metadata?.user_id === call.parameters.requester)
                                            .sort((left, right) => right.timestamp - left.timestamp || Number(right.id) - Number(left.id))[0] ?? null
                                    );
                                },
                            };
                        },
                    },
                };
            throw new Error(name);
        },
    });
    async function invoke(body) {
        let status;
        let result;
        await handler(
            { user_id: "requester", body },
            {
                status(value) {
                    status = value;
                    return this;
                },
                send(value) {
                    result = value;
                    return this;
                },
            },
        );
        return { status, result };
    }
    return { invoke, reads, permissionReads };
}

const allowed = ["VIEW_CHANNEL", "READ_MESSAGE_HISTORY"];
const message = (id, channel_id, flags = 0, user_id) => ({
    id,
    channel_id,
    timestamp: Number(id),
    flags,
    interaction_metadata: user_id ? { user_id } : undefined,
    toJSON() {
        return { id: this.id, reactions: [{ emoji: "test" }] };
    },
});

test("preloading omits inaccessible guilds, DMs, threads and channels without history before reading messages", async () => {
    const app = fixture({ visible: allowed, noHistory: ["VIEW_CHANNEL"], hidden: ["READ_MESSAGE_HISTORY"] });
    const response = await app.invoke({ channels: ["guildOutsider", "dmOutsider", "privateThread", "noHistory", "hidden", "visible"] });
    assert.equal(response.status, 200);
    assert.equal(response.result.length, 0);
    assert.deepEqual(
        app.reads.map((read) => read.options.where.channel_id),
        ["visible"],
    );
    assert.ok(app.permissionReads.every((read) => read.userId === "requester" && read.guildId === undefined));
});

test("preloading selects the latest visible message instead of dropping an older public message behind somebody else's ephemeral response", async () => {
    const app = fixture({ visible: allowed }, [message("1", "visible"), message("2", "visible", 64, "other"), message("3", "visible", 64)]);
    const response = await app.invoke({ channel_ids: ["visible", "visible"] });
    assert.deepEqual(
        Array.from(response.result, (row) => row.id),
        ["1"],
    );
    assert.equal(response.result[0].reactions, undefined);
    assert.equal(app.reads.length, 1);
    assert.equal(app.reads[0].options.take, 1);
});

test("the interaction requester can preload their own ephemeral response", async () => {
    const app = fixture({ visible: allowed }, [message("1", "visible"), message("2", "visible", 64, "requester"), message("3", "visible", 64, "other")]);
    const response = await app.invoke({ channels: ["visible"] });
    assert.deepEqual(
        Array.from(response.result, (row) => row.id),
        ["2"],
    );
});

test("preloading enforces the configured input bound before permission or message queries", async () => {
    const app = fixture({ visible: allowed });
    const response = await app.invoke({ channels: Array(11).fill("visible") });
    assert.equal(response.status, 400);
    assert.equal(app.permissionReads.length, 0);
    assert.equal(app.reads.length, 0);
});
