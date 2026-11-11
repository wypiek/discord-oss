const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");

const load = (users, events) => {
    const routes = {};
    const router = {
        get: (path, options, handler) => (routes[`GET ${path}`] = handler),
        patch: (path, options, handler) => (routes[`PATCH ${path}`] = handler),
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync("dist/api/routes/users/@me/notification-settings.js", "utf8"), {
        module,
        exports: module.exports,
        require: (name) =>
            ({
                express: { Router: () => router },
                "@spacebar/api/middlewares": { route: (options) => options },
                "@spacebar/database": {
                    User: {
                        findOneOrFail: async ({ where }) => ({ ...users[where.id] }),
                        setAccountPreferences: async (id, values) => (users[id].account_preferences = { ...users[id].account_preferences, ...values }),
                    },
                },
                "@spacebar/util": {
                    FieldErrors: (fields) => Object.assign(new Error("Invalid Form Body"), { fields }),
                    emitEvent: async (event) => events.push(event),
                },
            })[name],
    });
    return routes;
};

const call = async (handler, user_id, body) => {
    let json;
    await handler({ user_id, body }, { json: (value) => (json = value) });
    return JSON.parse(JSON.stringify(json));
};
const plain = (value) => JSON.parse(JSON.stringify(value));

test("account notification flags start at zero and keep only the new notifications and mention flags", async () => {
    const users = { 1: { id: "1", account_preferences: { consents: { personalization: true } } } };
    const events = [];
    const routes = load(users, events);
    assert.deepEqual(await call(routes["GET /"], "1"), { flags: 0 });
    assert.deepEqual(await call(routes["PATCH /"], "1", { flags: 16 | 32 | 1 }), { flags: 48 });
    assert.deepEqual(plain(users[1].account_preferences), { consents: { personalization: true }, notification_flags: 48 });
    assert.deepEqual(plain(events), [{ event: "NOTIFICATION_SETTINGS_UPDATE", data: { flags: 48 }, user_id: "1" }]);
    assert.deepEqual(await call(routes["GET /"], "1"), { flags: 48 });
});

test("account notification flags reject anything but a non-negative integer", async () => {
    const users = { 1: { id: "1", account_preferences: null } };
    const routes = load(users, []);
    for (const flags of [undefined, "16", -1, 1.5]) await assert.rejects(call(routes["PATCH /"], "1", { flags }), /Invalid Form Body/);
    assert.equal(users[1].account_preferences, null);
});

test("READY sends the stored account notification flags", () => {
    const identify = fs.readFileSync("src/gateway/opcodes/Identify.ts", "utf8");
    assert.match(identify, /flags: preferences\?\.account_preferences\?\.notification_flags \?\? 0/);
});
