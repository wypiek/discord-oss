const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const helperPath = "src/api/util/utility/memberRoleAuthorization.ts";
const routePath = "src/api/routes/guilds/#guild_id/members/#member_id/roles/#role_id/index.ts";
function harness({ owner = false, actorRoles, roleOverrides = {} } = {}) {
    const roles = [
        { id: "100", guild_id: "100", position: 0, managed: false },
        { id: "200", guild_id: "100", position: 2, managed: false },
        { id: "300", guild_id: "100", position: 3, managed: false },
        { id: "400", guild_id: "100", position: 4, managed: false, permissions: "8" },
        { id: "500", guild_id: "100", position: 1, managed: true },
        { id: "600", guild_id: "999", position: 1, managed: false },
    ].map((r) => ({ ...r, ...roleOverrides[r.id] }));
    const errors = {
        MISSING_PERMISSIONS: new Error("Missing permissions"),
        UNKNOWN_ROLE: new Error("Unknown role"),
        INVALID_ROLE: new Error("Invalid role"),
        INVALID_FORM_BODY: new Error("Invalid form body"),
    };
    const writes = [];
    const imports = {
        "@spacebar/database": {
            Guild: { findOneOrFail: async () => ({ id: "100", owner_id: owner ? "bot" : "owner" }) },
            Member: {
                findOneOrFail: async () => ({
                    roles: actorRoles || roles.filter((r) => ["100", "300"].includes(r.id)),
                }),
                addRole: async (...args) => writes.push(["add", ...args]),
                removeRole: async (...args) => writes.push(["remove", ...args]),
            },
            Role: {
                find: async ({ where }) =>
                    roles.filter((r) => (Array.isArray(where) ? where.some((w) => w.id === r.id && w.guild_id === r.guild_id) : r.guild_id === where.guild_id)),
                findOne: async ({ where }) => roles.find((r) => r.id === where.id && r.guild_id === where.guild_id),
            },
            AuditLog: { log: async () => {} },
        },
        "@spacebar/util": { DiscordApiErrors: errors },
        "@spacebar/util/util/IdentityModeration": {},
        "@spacebar/schemas": { AuditLogEvents: { MEMBER_ROLE_UPDATE: 25 } },
        "@spacebar/api/middlewares": { route: () => () => {} },
    };
    function load(path) {
        const module = { exports: {} };
        vm.runInNewContext(
            ts.transpileModule(fs.readFileSync(path, "utf8"), {
                compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
            }).outputText,
            {
                module,
                exports: module.exports,
                require: (name) => {
                    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
                    return imports[name];
                },
            },
        );
        return module.exports;
    }
    const helper = fs.existsSync(helperPath) ? load(helperPath) : {};
    imports["@spacebar/api/util/utility/memberRoleAuthorization"] = helper;
    const handlers = {};
    const patchHandlers = {};
    const member = {
        roles: roles.filter((r) => ["100", "300"].includes(r.id)),
        user: { toPublicUser: () => ({ id: "bot" }) },
        assign: (changes) => Object.assign(member, changes),
        save: async () => writes.push(["save"]),
        toPublicMember: () => ({ id: "bot" }),
    };
    imports.express = {
        Router: () => ({
            put: (path, ...steps) => {
                handlers.put = steps.at(-1);
            },
            delete: (path, ...steps) => {
                handlers.delete = steps.at(-1);
            },
        }),
    };
    load(routePath);
    imports.express = {
        Router: () =>
            Object.fromEntries(
                ["get", "put", "patch", "delete"].map((method) => [
                    method,
                    (path, ...steps) => {
                        patchHandlers[method] = steps.at(-1);
                    },
                ]),
            ),
    };
    imports.typeorm = {};
    imports["@spacebar/api/util"] = {};
    imports["@spacebar/util"].getPermission = async () => ({ hasThrow: () => {} });
    imports["@spacebar/util"].emitEvent = async () => {};
    imports["@spacebar/database"].AuditLog.diff = () => [];
    imports["@spacebar/database"].Member.findOneOrFail = async ({ where }) =>
        where.id === "target" ? member : { roles: actorRoles || roles.filter((r) => ["100", "300"].includes(r.id)) };
    load("src/api/routes/guilds/#guild_id/members/#member_id/index.ts");
    const memberPatch = patchHandlers.patch;
    imports.typeorm.In = (ids) => ids;
    imports["@spacebar/database"].Member.find = async ({ where }) => (where.id.includes("800") ? [{ ...member, id: "800" }] : []);
    load("src/api/routes/guilds/#guild_id/roles/#role_id/members.ts");
    const bulkRolePatch = patchHandlers.patch;
    return {
        roles,
        errors,
        writes,
        helper,
        patch: (body) => memberPatch({ user_id: "bot", params: { guild_id: "100", member_id: "target" }, body, headers: {} }, { json: () => {} }),
        bulkRole: (role_id, member_ids = ["800"]) => bulkRolePatch({ user_id: "bot", params: { guild_id: "100", role_id }, body: { member_ids } }, { json: () => {} }),
        invoke: (method, role_id) =>
            handlers[method](
                {
                    user_id: "bot",
                    params: { guild_id: "100", member_id: "@me", role_id },
                    headers: {},
                },
                { sendStatus: () => {} },
            ),
    };
}
test("MANAGE_ROLES bot cannot grant itself a higher administrator role", async () => {
    const h = harness();
    await assert.rejects(h.invoke("put", "400"), (e) => e === h.errors.MISSING_PERMISSIONS);
    assert.equal(h.writes.length, 0);
});
test("role add and remove reject equal, managed and everyone roles before mutation", async () => {
    for (const method of ["put", "delete"]) {
        for (const id of ["300", "400", "500", "100"]) {
            const h = harness();
            await assert.rejects(h.invoke(method, id), (e) => e === h.errors.MISSING_PERMISSIONS);
            assert.equal(h.writes.length, 0);
        }
    }
});
test("both individual endpoints permit a lower ordinary role", async () => {
    for (const method of ["put", "delete"]) {
        const h = harness();
        await h.invoke(method, "200");
        assert.equal(h.writes.length, 1);
        assert.equal(h.writes[0][1], "bot");
    }
});
test("individual foreign-guild and nonexistent roles are unknown without mutation", async () => {
    for (const method of ["put", "delete"]) {
        for (const id of ["600", "700"]) {
            const h = harness();
            await assert.rejects(h.invoke(method, id), (e) => e === h.errors.UNKNOWN_ROLE);
            assert.equal(h.writes.length, 0);
        }
    }
});
test("guild owner can change higher ordinary roles but never managed roles", async () => {
    const h = harness({ owner: true });
    await h.invoke("put", "400");
    await h.invoke("delete", "400");
    assert.equal(h.writes.length, 2);
    await assert.rejects(h.invoke("put", "500"), (e) => e === h.errors.MISSING_PERMISSIONS);
});
test("administrator permission does not bypass role hierarchy", async () => {
    const h = harness({ roleOverrides: { 300: { permissions: "8" } } });
    await assert.rejects(h.invoke("put", "400"), (e) => e === h.errors.MISSING_PERMISSIONS);
});
test("bulk changes reject adding or removing protected roles and foreign guild roles", async () => {
    for (const [previous, requested, error] of [
        [["100", "300"], ["300", "400"], "MISSING_PERMISSIONS"],
        [["100", "300", "400"], ["300"], "MISSING_PERMISSIONS"],
        [["100"], ["500"], "MISSING_PERMISSIONS"],
        [["100", "500"], [], "MISSING_PERMISSIONS"],
        [["100"], ["600"], "UNKNOWN_ROLE"],
        [["100"], ["700"], "UNKNOWN_ROLE"],
    ]) {
        const h = harness();
        await assert.rejects(h.helper.authorizeMemberRoleChanges("bot", "100", previous, requested), (e) => e === h.errors[error]);
    }
});
test("bulk lower-role changes preserve unchanged higher and managed roles", async () => {
    const h = harness();
    const result = await h.helper.authorizeMemberRoleChanges("bot", "100", ["100", "400", "500"], ["400", "500", "200", "200"]);
    assert.deepEqual(
        Array.from(result, (role) => role.id),
        ["400", "500", "200", "100"],
    );
});
test("bulk omission retains mandatory everyone role and permits removing lower role", async () => {
    const h = harness();
    const result = await h.helper.authorizeMemberRoleChanges("bot", "100", ["100", "200"], []);
    assert.deepEqual(
        Array.from(result, (role) => role.id),
        ["100"],
    );
});
test("actor without a non-everyone role cannot grant positioned roles", async () => {
    const h = harness({ actorRoles: [{ id: "100", guild_id: "100", position: 0 }] });
    await assert.rejects(h.invoke("put", "200"), (e) => e === h.errors.MISSING_PERMISSIONS);
});

test("actual bulk member PATCH blocks escalation before member assignment or save", async () => {
    const h = harness();
    await assert.rejects(h.patch({ roles: ["300", "400"] }), (e) => e === h.errors.MISSING_PERMISSIONS);
    assert.equal(h.writes.length, 0);
});
test("actual bulk member PATCH permits lower role while retaining actor-level existing role", async () => {
    const h = harness();
    await h.patch({ roles: ["300", "200"] });
    assert.deepEqual(Array.from(h.writes[0]), ["save"]);
});

test("bulk role member endpoint rejects protected and foreign roles before every write", async () => {
    for (const [role, error] of [
        ["100", "INVALID_ROLE"],
        ["300", "MISSING_PERMISSIONS"],
        ["400", "MISSING_PERMISSIONS"],
        ["500", "MISSING_PERMISSIONS"],
        ["600", "UNKNOWN_ROLE"],
        ["700", "UNKNOWN_ROLE"],
    ]) {
        const h = harness();
        await assert.rejects(h.bulkRole(role), (e) => e === h.errors[error]);
        assert.equal(h.writes.length, 0);
    }
});
test("bulk role member endpoint validates the complete member list without truncation", async () => {
    for (const ids of [undefined, null, "800", {}, [800], ["800", "bad"], Array(31).fill("800")]) {
        const h = harness();
        const supplied = ids === undefined ? null : ids;
        await assert.rejects(h.bulkRole("200", supplied), (e) => e === h.errors.INVALID_FORM_BODY);
        assert.equal(h.writes.length, 0);
    }
});
test("bulk role member endpoint deduplicates and permits a lower role", async () => {
    const h = harness();
    await h.bulkRole("200", ["800", "800", "900"]);
    assert.deepEqual(Array.from(h.writes[0]), ["add", "800", "100", "200"]);
    assert.equal(h.writes.length, 1);
});
test("bulk role member endpoint preserves the owner exception for ordinary roles", async () => {
    const h = harness({ owner: true });
    await h.bulkRole("400");
    assert.equal(h.writes.length, 1);
    await assert.rejects(h.bulkRole("500"), (e) => e === h.errors.MISSING_PERMISSIONS);
    assert.equal(h.writes.length, 1);
});
