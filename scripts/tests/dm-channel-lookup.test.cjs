const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");

const UNKNOWN_CHANNEL = new Error("Unknown channel");

const load = (channels) => {
    const routes = [];
    const joins = [];
    const router = Object.fromEntries(["get", "post"].map((method) => [method, (path, options, handler) => routes.push({ method, path, options, handler })]));
    const builder = {
        select: () => builder,
        innerJoin: (relation, alias, condition, params) => {
            joins.push({ relation, alias, condition, params });
            return builder;
        },
        where: (condition, params) => {
            builder.type = params.type;
            return builder;
        },
        getOne: async () => {
            const [mine, theirs] = joins.slice(-2).map((join) => Object.values(join.params)[0]);
            return channels.find((channel) => channel.type === builder.type && channel.recipients.includes(mine) && channel.recipients.includes(theirs)) ?? null;
        },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync("dist/api/routes/users/@me/dms/#user_id.js", "utf8"), {
        module,
        exports: module.exports,
        require: (name) =>
            ({
                express: { Router: () => router },
                "@spacebar/api/middlewares": { route: (options) => options },
                "@spacebar/database": {
                    Channel: {
                        createQueryBuilder: () => builder,
                        findOneOrFail: async ({ where }) => channels.find((channel) => channel.id === where.id),
                    },
                },
                "@spacebar/util": {
                    DiscordApiErrors: { UNKNOWN_CHANNEL },
                    DmChannelDTO: { from: async (channel, excluded) => ({ id: channel.id, recipients: channel.recipients.filter((id) => !excluded.includes(id)) }) },
                },
                "@spacebar/schemas": { ChannelType: { DM: 1, GROUP_DM: 3 } },
            })[name],
    });
    return routes[0];
};

const lookup = async (route, user_id, other) => {
    let body;
    await route.handler({ user_id, params: { user_id: other } }, { json: (value) => (body = value) });
    return body;
};

test("the DM lookup returns the existing one to one DM and never a group DM", async () => {
    const route = load([
        { id: "g", type: 3, recipients: ["1", "2", "3"] },
        { id: "d", type: 1, recipients: ["1", "2"] },
    ]);
    assert.equal(route.path, "/");
    assert.deepEqual(await lookup(route, "1", "2"), { id: "d", recipients: ["2"] });
    assert.deepEqual(await lookup(route, "2", "1"), { id: "d", recipients: ["1"] });
});

test("the DM lookup answers Unknown Channel without a DM, for yourself and for bad ids", async () => {
    const route = load([{ id: "g", type: 3, recipients: ["1", "3"] }]);
    await assert.rejects(lookup(route, "1", "3"), UNKNOWN_CHANNEL);
    await assert.rejects(lookup(route, "1", "1"), UNKNOWN_CHANNEL);
    await assert.rejects(lookup(route, "1", "abc"), UNKNOWN_CHANNEL);
});
