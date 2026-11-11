// Exercise the actual opcode handler. Optional PostgreSQL suite uses TEMP tables,
// one transaction, and rollback; no server restart or persistent data mutation.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
const { DataSource, EntitySchema, In } = require("typeorm");

function handler(repository, find, permission = true) {
    const sent = [],
        hydrationSizes = [];
    const module = { exports: {} };
    const member = {
        exists: async () => true,
        find: async (options) => {
            const result = await find(options);
            hydrationSizes.push(result.length);
            return result.map((m) => ({
                ...m,
                toPublicMember: () => ({ user: { id: m.id }, nick: m.nick }),
            }));
        },
    };
    const mocks = {
        typeorm: { In },
        "@spacebar/database": {
            Member: member,
            getDatabase: () => ({ getRepository: () => repository }),
        },
        "@spacebar/gateway": {
            OPCODES: { Dispatch: 0, Request_Guild_Members: 8 },
            Send: async (_, event) => sent.push(event),
            handleOffloadedGatewayRequest: async () => false,
        },
        "@spacebar/schemas": {},
        "@spacebar/util": {
            Config: { get: () => ({ offload: { gateway: { guildMembersUrl: null } } }) },
            getPermission: async () => ({ hasThrow() {}, has: () => permission }),
            getUserPresences: async (ids) => new Map(ids.map((id) => [id, { status: "online" }])),
        },
        "./instanceOf": { check() {} },
        "@spacebar/util/util/UserFieldCaps": require("../../dist/util/util/UserFieldCaps.js"),
    };
    const source = fs.readFileSync(path.join(__dirname, "../../src/gateway/opcodes/RequestGuildMembers.ts"), "utf8");
    vm.runInNewContext(
        ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) => mocks[name],
            console: { log() {} },
        },
    );
    const socket = { user_id: "tester", large_threshold: 250, isBot: false, sequence: 1 };
    return {
        sent,
        hydrationSizes,
        socket,
        request: (d) => module.exports.onRequestGuildMembers.call(socket, { d: { guild_id: "guild", ...d } }),
    };
}

test("non-moderators cannot enumerate entire guild; moderator full requests are throttled", async () => {
    const forbidden = handler(null, null, false);
    await forbidden.request({ query: "", limit: 0 });
    assert.equal(forbidden.sent.length, 0);
    const throttled = handler(null, null);
    throttled.socket.fullMemberRequests = { guild: Date.now() };
    await throttled.request({ query: "", limit: 0, nonce: "again" });
    assert.equal(throttled.sent[0].t, "RATE_LIMITED");
    assert.equal(throttled.sent[0].d.meta.nonce, "again");
});

const database = process.env.MEMBER_REQUEST_DATABASE;
test("PostgreSQL: 1251-member guild pages without lost roles, name search or explicit IDs", { skip: !database }, async () => {
    const common = { id: { type: String, primary: true } };
    const entities = [
        new EntitySchema({
            name: "User",
            tableName: "users",
            columns: {
                ...common,
                username: { type: String },
                global_name: { type: String, nullable: true },
            },
        }),
        new EntitySchema({ name: "Role", tableName: "roles", columns: common }),
        new EntitySchema({
            name: "Member",
            tableName: "members",
            columns: {
                index: { type: Number, primary: true },
                id: { type: String },
                guild_id: { type: String },
                nick: { type: String, nullable: true },
            },
            relations: {
                user: { type: "many-to-one", target: "User", joinColumn: { name: "id" } },
                roles: {
                    type: "many-to-many",
                    target: "Role",
                    joinTable: {
                        name: "member_roles",
                        joinColumn: { name: "index", referencedColumnName: "index" },
                        inverseJoinColumn: { name: "role_id", referencedColumnName: "id" },
                    },
                },
            },
        }),
    ];
    const db = new DataSource({
        type: "postgres",
        url: database,
        entities,
        synchronize: false,
        logging: false,
    });
    await db.initialize();
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
        await runner.query("CREATE TEMP TABLE users (id varchar PRIMARY KEY, username varchar, global_name varchar) ON COMMIT DROP");
        await runner.query("CREATE TEMP TABLE roles (id varchar PRIMARY KEY) ON COMMIT DROP");
        await runner.query("CREATE TEMP TABLE members (index integer PRIMARY KEY, id varchar, guild_id varchar, nick varchar) ON COMMIT DROP");
        await runner.query("CREATE TEMP TABLE member_roles (index integer, role_id varchar) ON COMMIT DROP");
        await runner.query(
            "INSERT INTO users SELECT lpad(i::text, 5, '0'), CASE WHEN i=1 THEN 'NeedleUsername' ELSE 'user'||i END, CASE WHEN i=2 THEN 'NeedleGlobal' END FROM generate_series(1,1251) i",
        );
        await runner.query("INSERT INTO members SELECT i, lpad(i::text, 5, '0'), 'guild', CASE WHEN i=3 THEN 'NeedleNick' END FROM generate_series(1,1251) i");
        await runner.query("INSERT INTO roles VALUES ('guild'), ('extra1'), ('extra2')");
        await runner.query("INSERT INTO member_roles SELECT i, role_id FROM generate_series(1,1251) i CROSS JOIN (VALUES ('guild'), ('extra1'), ('extra2')) roles(role_id)");
        const repo = runner.manager.getRepository("Member");
        const make = () => handler(repo, (opts) => runner.manager.find("Member", opts));
        const full = make();
        await full.request({ query: "", limit: 0, presences: true, nonce: "full" });
        assert.deepEqual(full.hydrationSizes, [1000, 251]);
        assert.deepEqual(
            full.sent.map((x) => x.d.members.length),
            [1000, 251],
        );
        assert.equal(new Set(full.sent.flatMap((x) => x.d.members.map((m) => m.user.id))).size, 1251);
        assert.ok(full.sent.every((x) => x.d.chunk_count === 2 && x.d.nonce === "full" && x.d.presences.length === x.d.members.length));
        assert.ok(full.sent.flatMap((x) => x.d.members).every((m) => m.roles.length === 2 && !m.roles.includes("guild")));
        const search = make();
        await search.request({ query: "nEeDlE", limit: 100 });
        assert.deepEqual(
            Array.from(search.sent[0].d.members, (m) => m.user.id),
            ["00001", "00002", "00003"],
        );
        const limited = make();
        await limited.request({ query: "user", limit: 100 });
        assert.equal(limited.sent[0].d.members.length, 100);
        assert.ok(limited.sent[0].d.members.every((m) => m.roles.length === 2));
        const explicit = make();
        await explicit.request({ user_ids: ["00001", "01251", "missing"] });
        assert.deepEqual(
            Array.from(explicit.sent[0].d.members, (m) => m.user.id),
            ["00001", "01251"],
        );
        assert.deepEqual(Array.from(explicit.sent[0].d.not_found), ["missing"]);
        const absent = make();
        await absent.request({ user_ids: ["missing"] });
        assert.equal(absent.sent[0].d.chunk_count, 1);
        assert.equal(absent.sent[0].d.members.length, 0);
        assert.deepEqual(Array.from(absent.sent[0].d.not_found), ["missing"]);
    } finally {
        await runner.rollbackTransaction();
        await runner.release();
        await db.destroy();
    }
});
