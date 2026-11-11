const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadRoutes, response } = require("./helpers/route-harness.cjs");

const ids = (roles) => Array.from(roles, (role) => role.id);
const In = (values) => ({ in: values });

function setup(prompts, held = []) {
    const finds = [];
    const member = {
        roles: held.map((id) => ({ id })),
        flags: 0,
        user: { toPublicUser: () => ({ id: "user_1" }) },
        toPublicMember: () => ({}),
        save: async () => {},
    };
    const routes = loadRoutes("src/api/routes/guilds/#guild_id/onboarding-responses.ts", {
        "@spacebar/database": {
            Guild: { findOneOrFail: async () => ({ id: "1", onboarding: { prompts } }) },
            Member: { findOneOrFail: async () => member },
            Role: {
                find: async (query) => {
                    finds.push(query);
                    return query.where.id.in.filter((id) => id.startsWith("own")).map((id) => ({ id }));
                },
            },
        },
        "@spacebar/util": { emitEvent: async () => {} },
        "@spacebar/api/util/utility/fieldCaps": require("../../src/api/util/utility/fieldCaps.ts"),
        typeorm: { In },
    });
    return { routes, member, finds };
}

const prompts = [
    {
        options: [
            { id: "opt_a", role_ids: ["own_a"] },
            { id: "opt_b", role_ids: ["own_b", "other_guild"] },
        ],
    },
];

test("onboarding with no selected options grants no roles and never queries every role", async () => {
    const { routes, member, finds } = setup(prompts, ["own_a"]);
    await routes["PUT /"]({ params: { guild_id: "1" }, user_id: "user_1", body: { onboarding_responses: [] } }, response());
    assert.deepEqual(ids(member.roles), []);
    assert.equal(finds.length, 0);
});

test("onboarding without prompts keeps the roles a member already has", async () => {
    const { routes, member, finds } = setup([], ["mod"]);
    await routes["POST /"]({ params: { guild_id: "1" }, user_id: "user_1", body: {} }, response());
    assert.deepEqual(ids(member.roles), ["mod"]);
    assert.equal(finds.length, 0);
});

test("onboarding only grants unmanaged roles of the same guild for the chosen options", async () => {
    const { routes, member, finds } = setup(prompts);
    await routes["PUT /"]({ params: { guild_id: "1" }, user_id: "user_1", body: { onboarding_responses: ["opt_b"] } }, response());
    assert.equal(finds.length, 1);
    assert.equal(finds[0].where.guild_id, "1");
    assert.equal(finds[0].where.managed, false);
    assert.deepEqual(Array.from(finds[0].where.id.in).sort(), ["other_guild", "own_b"]);
    assert.deepEqual(ids(member.roles), ["own_b"]);
});
