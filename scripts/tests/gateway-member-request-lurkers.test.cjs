const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function requestMembers(members) {
    const sent = [];
    const everyone = [{ id: "owner" }, { id: "member" }];
    const module = { exports: {} };
    const imports = {
        "@spacebar/database/Sql": { sqlLike: (value) => value },
        typeorm: { In: (ids) => ids },
        "@spacebar/database": {
            Member: {
                exists: async ({ where }) => members.includes(where.id) && where.guild_id === "guild",
                find: async () => everyone.map((member) => ({ ...member, roles: [], toPublicMember: () => ({ user: { id: member.id } }) })),
                attachRoles: async (members) => members,
            },
            getDatabase: () => ({
                getRepository: () => ({
                    createQueryBuilder: () => {
                        const builder = {
                            getCount: async () => everyone.length,
                            getRawMany: async () => everyone,
                        };
                        for (const method of ["where", "andWhere", "leftJoin", "clone", "select", "orderBy", "limit"]) builder[method] = () => builder;
                        return builder;
                    },
                }),
            }),
        },
        "@spacebar/gateway": {
            OPCODES: { Dispatch: 0, Request_Guild_Members: 8 },
            Send: async (_, event) => sent.push(event),
            handleOffloadedGatewayRequest: async () => false,
        },
        "@spacebar/schemas": {},
        "@spacebar/util": {
            Config: { get: () => ({ offload: { gateway: { guildMembersUrl: null } } }) },
            getPermission: async () => ({ hasThrow() {}, has: (flag) => flag === "VIEW_CHANNEL" }),
            getUserPresences: async (ids) => new Map(ids.map((id) => [id, { status: "online" }])),
            Intents: { FLAGS: {} },
        },
        "./instanceOf": { check() {} },
        "@spacebar/util/util/UserFieldCaps": { clampText: (value) => value, UserFieldCaps: { memberRequestNonce: 32, memberQuery: 100, memberRequestUserIds: 100 } },
    };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/gateway/opcodes/RequestGuildMembers.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
            console: { log() {} },
        },
    );
    return async (user_id) => {
        sent.length = 0;
        const socket = { user_id, large_threshold: 250, isBot: false, sequence: 1 };
        await module.exports.onRequestGuildMembers.call(socket, { d: { guild_id: "guild", user_ids: ["owner", "member"], limit: 10, presences: true, nonce: "n" } });
        return sent.filter((event) => event.t === "GUILD_MEMBERS_CHUNK");
    };
}

test("someone lurking a discoverable guild cannot request its members or presences", async () => {
    const request = requestMembers(["owner", "member"]);
    assert.equal((await request("lurker")).length, 0);
    assert.ok((await request("member")).length > 0);
});
