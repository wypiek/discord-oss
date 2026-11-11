const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const compile = (source, imports = {}) => {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            Date,
            Buffer,
            require: (name) => {
                assert.ok(name in imports, name);
                return imports[name];
            },
        },
    );
    return module.exports;
};
const bits = compile(fs.readFileSync("src/util/util/BitField.ts", "utf8"));
function fixture() {
    let reads = 0;
    class Member {}
    const member = Object.assign(new Member(), {
        index: 1,
        id: "user",
        guild_id: "guild",
        flags: 0,
        communication_disabled_until: null,
        roles: [{ id: "guild", guild_id: "guild", permissions: "3072" }],
    });
    Member.createQueryBuilder = () => ({
        setFindOptions: () => ({
            getOne: async () => {
                reads++;
                return member;
            },
        }),
    });
    const User = { findOneOrFail: async () => ({ id: "user", flags: 0 }) };
    const { getPermission, Permissions } = compile(fs.readFileSync("src/util/util/Permissions.ts", "utf8"), {
        "../../database/entities": { Member, User },
        "./BitField": bits,
        "lambert-server/HTTPError": { HTTPError: class extends Error {} },
        "./Constants": {},
        "@spacebar/schemas": {
            ChannelType: { GUILD_PRIVATE_THREAD: 12 },
            ChannelPermissionOverwriteType: { role: 0, member: 1 },
            UserFlags: { FLAGS: { QUARANTINED: 1n } },
        },
        typeorm: {},
        "@spacebar/util": {
            OrmUtils: { keysToObject: (list) => Object.fromEntries(list.map((key) => [key, true])) },
        },
    });
    const guild = { id: "guild", owner_id: "owner" };
    const channel = {
        id: "channel",
        guild_id: "guild",
        permission_overwrites: [],
        isThread: () => false,
    };
    return {
        member,
        Member,
        Permissions,
        reads: () => reads,
        check: (preloaded) => getPermission("user", guild, channel, { user: { id: "user", flags: 0 }, member: preloaded }),
    };
}
test("validated preload retains baseline permissions without a member lookup", async () => {
    const f = fixture();
    const baseline = await f.check();
    assert.equal(f.reads(), 1);
    const preloaded = await f.check(f.member);
    assert.equal(f.reads(), 1);
    assert.equal(preloaded.bitfield, baseline.bitfield);
});
test("wrong user, guild, role scope and incomplete preload fall back to current database membership", async () => {
    const f = fixture();
    for (const mutation of [
        { id: "other" },
        { guild_id: "other" },
        { roles: [{ id: "admin", guild_id: "other", permissions: "8" }] },
        { flags: undefined },
        { communication_disabled_until: undefined },
        { index: undefined },
    ]) {
        const member = Object.assign(new f.Member(), f.member, mutation);
        const permission = await f.check(member);
        assert.equal(permission.has("ADMINISTRATOR"), false);
    }
    assert.equal(f.reads(), 6);
    const plain = { ...f.member, roles: [{ id: "guild", guild_id: "guild", permissions: "8" }] };
    assert.equal((await f.check(plain)).has("ADMINISTRATOR"), false);
    assert.equal(f.reads(), 7);
});
test("hydrated preloads preserve timeout and member quarantine masks", async () => {
    const f = fixture();
    f.member.communication_disabled_until = new Date(Date.now() + 60000);
    assert.equal((await f.check(f.member)).has("SEND_MESSAGES"), false);
    f.member.communication_disabled_until = null;
    f.member.flags = f.Permissions.AUTOMOD_QUARANTINE_MEMBER_FLAGS;
    assert.equal((await f.check(f.member)).has("SEND_MESSAGES"), false);
    assert.equal(f.reads(), 0);
});
