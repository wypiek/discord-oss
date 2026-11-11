const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");

const UNKNOWN_CHANNEL = new Error("Unknown channel");
const UNKNOWN_MEMBER = new Error("Unknown member");

const state = () => ({
    guild: {
        id: "g",
        home_settings: {
            enabled: true,
            new_member_actions: [
                { channel_id: "a", action_type: 0, title: "Say hi", description: "", emoji: { name: "👋" }, icon: null },
                { channel_id: "b", action_type: 1, title: "Read", description: "", emoji: null, icon: "hash" },
            ],
            resource_channels: [{ channel_id: "r", title: "Rules", emoji: { name: "📜" }, icon: null }],
        },
    },
    members: [{ index: 1, id: "u", guild_id: "g", flags: 2, completed_new_member_actions: null, roles: [], user: { toPublicUser: () => ({ id: "u" }) } }],
    events: [],
    guildUpdates: 0,
});

const load = (file, db) => {
    const routes = [];
    const router = Object.fromEntries(["get", "post", "patch", "put"].map((method) => [method, (path, options, handler) => routes.push({ method, path, options, handler })]));
    const findMember = (where) => db.members.find((member) => (where.index ? member.index === where.index : member.id === where.id && member.guild_id === where.guild_id)) ?? null;
    const caps = () => {
        const errors = {};
        return {
            text: (path, value, max) => {
                if (value != null && (typeof value !== "string" || value.length > max)) errors[path] = true;
            },
            check: () => {
                if (Object.keys(errors).length) throw Object.assign(new Error("field errors"), { errors });
            },
        };
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), {
        module,
        exports: module.exports,
        require: (name) =>
            ({
                express: { Router: () => router },
                "@spacebar/api/middlewares": { route: (options) => options },
                "@spacebar/database": {
                    Guild: {
                        findOneOrFail: async () => structuredClone(db.guild),
                        update: async (where, values) => {
                            db.guildUpdates++;
                            Object.assign(db.guild, values);
                        },
                    },
                    Member: {
                        findOne: async ({ where }) => {
                            const member = findMember(where);
                            return member && { ...member };
                        },
                        findOneOrFail: async ({ where }) => ({ ...findMember(where), toPublicMember: () => ({ id: "u", flags: findMember(where).flags }) }),
                        update: async (where, values) => Object.assign(findMember(where), values),
                    },
                },
                "@spacebar/util": { DiscordApiErrors: { UNKNOWN_CHANNEL, UNKNOWN_MEMBER }, emitEvent: async (event) => db.events.push(event) },
                "@spacebar/schemas": {},
                "@spacebar/api/util/utility/fieldCaps": { fieldCaps: caps, emojiCaps: () => {} },
            })[name],
    });
    return routes;
};

const call = async (route, req) => {
    const res = { status: 200 };
    res.sendStatus = (status) => Object.assign(res, { status });
    res.json = (body) => Object.assign(res, { body: JSON.parse(JSON.stringify(body)) });
    await route.handler({ user_id: "u", body: {}, ...req }, res);
    return res;
};

test("completing server guide actions is saved per member and sets the home action member flags", async () => {
    const db = state();
    const [complete] = load("dist/api/routes/guilds/#guild_id/new-member-action/#channel_id.js", db);
    const [list] = load("dist/api/routes/guilds/#guild_id/new-member-actions.js", db);

    assert.deepEqual((await call(list, { params: { guild_id: "g" } })).body, { channel_actions: {} });
    assert.equal((await call(complete, { params: { guild_id: "g", channel_id: "a" } })).status, 204);
    assert.equal(db.members[0].flags, 2 | 32);
    assert.deepEqual([...db.members[0].completed_new_member_actions], ["a"]);
    assert.deepEqual((await call(list, { params: { guild_id: "g" } })).body, { channel_actions: { a: { completed: true } } });

    assert.equal((await call(complete, { params: { guild_id: "g", channel_id: "a" } })).status, 204);
    assert.equal(db.events.length, 1);
    await call(complete, { params: { guild_id: "g", channel_id: "b" } });
    assert.equal(db.members[0].flags, 2 | 32 | 64);
    assert.equal(db.events.length, 2);
    assert.equal(db.events[1].event, "GUILD_MEMBER_UPDATE");
    assert.equal(db.events[1].data.flags, 2 | 32 | 64);

    await assert.rejects(call(complete, { params: { guild_id: "g", channel_id: "r" } }), UNKNOWN_CHANNEL);
    await assert.rejects(call(complete, { user_id: "x", params: { guild_id: "g", channel_id: "a" } }), UNKNOWN_MEMBER);
});

test("actions removed from the guide no longer count as completed", async () => {
    const db = state();
    db.members[0].completed_new_member_actions = ["a", "gone"];
    const [list] = load("dist/api/routes/guilds/#guild_id/new-member-actions.js", db);
    assert.deepEqual((await call(list, { params: { guild_id: "g" } })).body, { channel_actions: { a: { completed: true } } });
});

test("moderators can swap one guide action's emoji or icon and a resource channel's icon", async () => {
    const db = state();
    const routes = load("dist/api/routes/guilds/#guild_id/new-member-actions.js", db);
    const patch = routes.find((route) => route.method === "patch");
    assert.equal(patch.path, "/:channel_id");
    assert.equal(patch.options.permission, "MANAGE_GUILD");
    const swapped = await call(patch, { params: { guild_id: "g", channel_id: "b" }, body: { emoji: { name: "🎉" } } });
    assert.deepEqual(swapped.body.emoji, { name: "🎉" });
    assert.equal(swapped.body.icon, null);
    assert.deepEqual(JSON.parse(JSON.stringify(db.guild.home_settings.new_member_actions[1].emoji)), { name: "🎉" });
    await assert.rejects(call(patch, { params: { guild_id: "g", channel_id: "missing" }, body: { emoji: { name: "x" } } }), UNKNOWN_CHANNEL);

    const [put] = load("dist/api/routes/guilds/#guild_id/resource-channels/#channel_id.js", db);
    assert.equal(put.options.permission, "MANAGE_GUILD");
    const resource = await call(put, { params: { guild_id: "g", channel_id: "r" }, body: { icon: "abc" } });
    assert.equal(resource.body.icon, "abc");
    assert.equal(resource.body.emoji, null);
    await assert.rejects(call(put, { params: { guild_id: "g", channel_id: "r" }, body: { icon: "x".repeat(65) } }), /field errors/);
    await assert.rejects(call(put, { params: { guild_id: "g", channel_id: "a" }, body: { icon: null } }), UNKNOWN_CHANNEL);
});
