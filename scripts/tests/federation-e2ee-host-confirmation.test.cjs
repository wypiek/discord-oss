const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const OWN = "home.example";
const EVIL = "evil.example";

function sharing({ channels = [], guilds = [], members = [], recipients = [] }) {
    const relayed = [];
    const ids = new Map([
        ["@900@evil.example", "local-dm"],
        ["@901@evil.example", "local-text"],
        ["@902@evil.example", "local-unknown"],
    ]);
    const where = (rows, query) => rows.some((row) => Object.entries(query).every(([key, value]) => row[key] === value));
    const emptyCount = () => {
        const builder = { getCount: async () => 0 };
        for (const method of ["innerJoin", "where", "andWhere"]) builder[method] = () => builder;
        return builder;
    };
    const module = { exports: {} };
    const imports = {
        typeorm: { In: (values) => values, IsNull: () => null, Not: (value) => value },
        "@spacebar/database": {
            Channel: { findOne: async ({ where: query }) => channels.find((channel) => channel.id === query.id) ?? null },
            Guild: { exists: async ({ where: query }) => where(guilds, query) },
            Member: { exists: async ({ where: query }) => where(members, query) },
            Recipient: { exists: async ({ where: query }) => where(recipients, query), find: async () => [], createQueryBuilder: emptyCount },
            Relationship: { find: async () => [], createQueryBuilder: emptyCount },
            FormerRecipient: { find: async () => [] },
            FederatedE2eeKeys: {},
            User: { findOne: async ({ where: query }) => ({ id: query.id, username: "victim" }), exists: async () => false },
        },
        "@spacebar/schemas": { RelationshipType: { BLOCKED: 2, FRIEND: 1 } },
        "@spacebar/util": {
            Config: { get: () => ({ federation: { enabled: true } }) },
            parseCanonicalId: (value) => {
                const match = /^@(\d+)@(.+)$/.exec(String(value ?? ""));
                return match ? { id: match[1], instance: match[2] } : null;
            },
        },
        "./e2ee": {},
        "./federationIds": { canonicalOf: async () => null, localOf: async (canonical) => ids.get(canonical) ?? null },
        "./federationNetwork": { ownInstance: () => OWN, signedFetch: async () => null },
        "./federationRelay": {
            relayToHost: async (instance, user, method, path) => {
                relayed.push(`${instance} ${method} ${path}`);
                return { status: 200, body: {} };
            },
        },
    };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/util/utility/federationE2ee.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            Date,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    return { shares: module.exports.sharesWithInstance, relayed };
}

const hostedDm = { id: "local-dm", guild_id: null, federated_instance: EVIL };
const hostedText = { id: "local-text", guild_id: "local-guild", federated_instance: null };

test("a host's empty answer about its own channel doesn't hand it the keys of a local user who isn't in that channel", async () => {
    const { shares, relayed } = sharing({ channels: [hostedDm, hostedText], guilds: [{ id: "local-guild", federated_instance: EVIL }] });
    assert.equal(await shares("victim", EVIL, "@900@evil.example"), false);
    assert.equal(await shares("victim", EVIL, "@901@evil.example"), false);
    assert.equal(await shares("victim", EVIL, "@902@evil.example"), false);
    assert.deepEqual(relayed, []);
});

test("a channel this instance doesn't record as hosted by the requester is no evidence", async () => {
    const { shares } = sharing({
        channels: [{ ...hostedDm, federated_instance: "other.example" }],
        recipients: [{ channel_id: "local-dm", user_id: "victim" }],
    });
    assert.equal(await shares("victim", EVIL, "@900@evil.example"), false);
});

test("a local user in a group DM or guild the requester hosts still shares with it", async () => {
    const dm = sharing({ channels: [hostedDm], recipients: [{ channel_id: "local-dm", user_id: "member" }] });
    assert.equal(await dm.shares("member", EVIL, "@900@evil.example"), true);
    assert.deepEqual(dm.relayed, [`${EVIL} GET /channels/local-dm`]);
    const guild = sharing({
        channels: [hostedText],
        guilds: [{ id: "local-guild", federated_instance: EVIL }],
        members: [{ id: "member", guild_id: "local-guild" }],
    });
    assert.equal(await guild.shares("member", EVIL, "@901@evil.example"), true);
});
