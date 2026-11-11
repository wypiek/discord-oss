const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");

const load = (file, modules) => {
    const routes = [];
    const router = Object.fromEntries(
        ["get", "post", "patch", "put", "delete"].map((method) => [
            method,
            (path, options, handler) => {
                routes.push({ method, path, options, handler });
            },
        ]),
    );
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), {
        module,
        exports: module.exports,
        require: (name) => {
            if (name === "express") return { Router: () => router };
            if (name === "@spacebar/api/middlewares") return { route: (options) => options };
            return modules[name] ?? {};
        },
    });
    return routes;
};

test("bulk leave silently leaves only the group DMs the user is in and ignores bad ids", async () => {
    const left = [];
    const queries = [];
    const routes = load("dist/api/routes/users/@me/channels.js", {
        typeorm: { In: (values) => ({ in: values }) },
        "@spacebar/schemas": { ChannelType: { GROUP_DM: 3 } },
        "@spacebar/database": {
            Recipient: {
                find: async (query) => {
                    queries.push(query);
                    return query.where.channel_id.in.filter((id) => id !== "30").map((channel_id) => ({ channel_id }));
                },
            },
            Channel: {
                find: async (query) => {
                    assert.equal(query.where.type, 3);
                    return query.where.id.in.filter((id) => id !== "20").map((id) => ({ id, type: 3, recipients: [] }));
                },
                removeRecipientFromChannel: async (channel, user_id, actor_id, silent) => left.push({ id: channel.id, user_id, actor_id, silent }),
            },
        },
    });
    const route = routes.find((r) => r.method === "post" && r.path === "/bulk-leave");
    assert.ok(route, "POST /bulk-leave is registered");
    assert.equal(route.options.requestBody, "BulkLeaveGroupDmsSchema");

    let status;
    await route.handler({ user_id: "u", body: { channel_ids: ["10", "10", "20", "30", "x'); drop"] } }, { sendStatus: (code) => (status = code) });
    assert.equal(status, 204);
    assert.deepEqual(JSON.parse(JSON.stringify(queries[0].where)), { user_id: "u", channel_id: { in: ["10", "20", "30"] } });
    assert.deepEqual(left, [{ id: "10", user_id: "u", actor_id: "u", silent: true }]);
});

test("the bulk leave schema caps the request at 1000 channel ids", () => {
    const source = fs.readFileSync("src/schemas/uncategorised/BulkLeaveGroupDmsSchema.ts", "utf8");
    assert.match(source, /@maxItems 1000/);
    assert.match(source, /@minItems 1/);
});
