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
        BigInt,
        Date,
        Number,
        String,
        Math,
        Promise,
        require: (name) => {
            if (name === "express") return { Router: () => router };
            if (name === "@spacebar/api/middlewares") return { route: (options) => options };
            if (name in modules) return modules[name];
            throw new Error(`unexpected import ${name}`);
        },
    });
    return routes;
};

const respond = () => {
    const res = { status: 200 };
    res.sendStatus = (status) => {
        res.status = status;
        return res;
    };
    res.json = (body) => {
        res.body = body;
        return res;
    };
    res.send = res.json;
    return res;
};

test("the prune estimate v2 answers 204 and sends the count as GUILD_PRUNE_UPDATE to the requester", async () => {
    const events = [];
    const old = new Date(Date.now() - 40 * 86400000);
    const member = (id, roles) => ({ id, joined_at: old, roles: roles.map((role) => ({ id: role, position: role === "g" ? 0 : 1 })) });
    const routes = load("dist/api/routes/guilds/#guild_id/prune.js", {
        typeorm: { IsNull: () => null, LessThan: (value) => value },
        "@spacebar/database": {
            Member: {
                find: async () => [member("a", ["g"]), member("b", ["g", "r1"]), member("c", ["g", "r2"])],
                findOneOrFail: async () => member("owner", ["g"]),
            },
            Guild: { findOneOrFail: async () => ({ id: "g", owner_id: "owner" }) },
            AuditLog: { log: async () => {} },
        },
        "@spacebar/schemas": { AuditLogEvents: {} },
        "@spacebar/util": { Snowflake: { EPOCH: 1420070400000 }, emitEvent: async (event) => events.push(event) },
    });
    const route = routes.find((r) => r.method === "get" && r.path === "/v2");
    assert.ok(route, "GET /v2 is registered");
    assert.equal(route.options.permission, "KICK_MEMBERS");

    const res = respond();
    await route.handler({ params: { guild_id: "g" }, query: { days: "7", include_roles: ["r1"] }, user_id: "owner" }, res);
    assert.equal(res.status, 204);
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "GUILD_PRUNE_UPDATE");
    assert.equal(events[0].user_id, "owner");
    assert.equal(events[0].guild_id, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(events[0].data)), {
        guild_id: "g",
        prune: { is_preview: true, is_finished: true, days: 7, prune_count: 2, include_roles: ["r1"] },
    });
});

test("bulk ban v2 bans like v1 and reports the result as GUILD_BULK_BAN_UPDATE to the requester", async () => {
    const events = [];
    const util = {
        Config: { get: () => ({ limits: { guild: { maxBulkBanUsers: 200 } } }) },
        DiscordApiErrors: { BULK_BAN_FAILED: new Error("bulk ban failed") },
        FieldErrors: (errors) => Object.assign(new Error("field errors"), { errors }),
        emitEvent: async (event) => events.push(event),
    };
    const routes = load("dist/api/routes/guilds/#guild_id/bulk-ban.js", {
        "@spacebar/util": util,
        "@spacebar/api/util": {
            banDeleteSeconds: () => 0,
            bannableUsers: async (guild_id, actor, ids) => ids.filter((id) => id !== "2"),
            banUsers: async ({ user_ids }) => ({ banned: user_ids }),
        },
        "@spacebar/api/util/utility/fieldCaps": { auditLogReason: () => undefined },
    });
    assert.deepEqual(
        routes.map((r) => `${r.method} ${r.path}`),
        ["post /", "post /v2"],
    );
    const v1 = respond();
    await routes[0].handler({ params: { guild_id: "g" }, body: { user_ids: ["1", "2"] }, headers: {}, user_id: "owner" }, v1);
    assert.deepEqual(JSON.parse(JSON.stringify(v1.body)), { banned_users: ["1"], failed_users: ["2"] });
    assert.equal(events.length, 0);

    const v2 = respond();
    await routes[1].handler({ params: { guild_id: "g" }, body: { user_ids: ["1", "2", "3"] }, headers: {}, user_id: "owner" }, v2);
    assert.deepEqual(JSON.parse(JSON.stringify(v2.body)), { banned_users: ["1", "3"], failed_users: ["2"] });
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "GUILD_BULK_BAN_UPDATE");
    assert.equal(events[0].user_id, "owner");
    assert.deepEqual(JSON.parse(JSON.stringify(events[0].data)), { guild_id: "g", bulk_ban: { banned_users: ["1", "3"], failed_users: ["2"] } });

    await assert.rejects(routes[1].handler({ params: { guild_id: "g" }, body: { user_ids: ["2"] }, headers: {}, user_id: "owner" }, respond()), /bulk ban failed/);
    assert.equal(events.length, 1);
});
