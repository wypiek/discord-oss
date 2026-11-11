const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const compile = (file, imports) => {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            Number,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    return module.exports;
};

const errors = {
    MISSING_PERMISSIONS: Object.assign(new Error("Missing Permissions"), { code: 50013 }),
    MISSING_ACCESS: Object.assign(new Error("Missing Access"), { code: 50001 }),
    TWO_FACTOR_REQUIRED: Object.assign(new Error("Two factor is required for this operation"), { code: 60003 }),
    INVALID_FORM_BODY: Object.assign(new Error("Invalid Form Body"), { code: 50035 }),
    UNKNOWN_CHANNEL: Object.assign(new Error("Unknown Channel"), { code: 10003 }),
    CANNOT_EXECUTE_ON_THIS_CHANNEL_TYPE: Object.assign(new Error("Cannot execute action on this channel type"), { code: 50024 }),
};

const { Permissions } = compile("src/util/util/Permissions.ts", {
    "../../database/entities": { Application: {}, Member: class {}, User: {}, Role: class {}, Guild: {}, Channel: class {}, ThreadMember: class {} },
    "./BitField": compile("src/util/util/BitField.ts", {}),
    "lambert-server/HTTPError": { HTTPError: class extends Error {} },
    "./Constants": { DiscordApiErrors: errors },
    "@spacebar/schemas": {
        ChannelType: { GUILD_PRIVATE_THREAD: 12 },
        ChannelPermissionOverwriteType: { role: 0, member: 1 },
        UserFlags: { FLAGS: { QUARANTINED: 1n } },
    },
    typeorm: { ArrayContains: () => ({}), EntityNotFoundError: class extends Error {} },
    "@spacebar/util": { OrmUtils: { keysToObject: (list) => Object.fromEntries(list.map((key) => [key, true])) } },
});
const { assertOverwriteChanges } = compile("src/api/util/utility/channelOverwrites.ts", { "@spacebar/util": { DiscordApiErrors: errors, Permissions } });

function reorder(...flags) {
    const updates = [];
    const channels = [
        { id: "open", type: 4, parent_id: null, permission_overwrites: [], toJSON: () => ({}) },
        {
            id: "staff",
            type: 0,
            parent_id: null,
            permission_overwrites: [{ id: "guild-1", type: 0, allow: "0", deny: String(Permissions.FLAGS.VIEW_CHANNEL) }],
            toJSON: () => ({}),
        },
    ];
    let handler;
    const noop = () => {};
    compile("src/api/routes/guilds/#guild_id/channels.ts", {
        express: { Router: () => ({ get: noop, post: noop, patch: (_, ...steps) => (handler = steps.at(-1)) }) },
        "@spacebar/api/middlewares": { route: () => noop },
        "@spacebar/database": {
            AuditLog: {},
            Channel: { find: async () => channels, update: async (where, update) => updates.push({ ...where, ...update }) },
            Guild: { findOneOrFail: async () => ({ id: "guild-1", channel_ordering: ["open", "staff"] }), update: async () => {} },
            Tag: {},
        },
        "@spacebar/util": {
            ChannelCreateEvent: {},
            ChannelUpdateEvent: {},
            Config: {},
            DiscordApiErrors: errors,
            emitEvent: async () => {},
            FieldErrors: noop,
            getPermission: noop,
        },
        "@spacebar/api/util": { assertOverwriteChanges, enforceNameAutomod: noop, THREAD_TYPES: [10, 11, 12] },
        "@spacebar/schemas": { AuditLogEvents: {}, ChannelType: { GUILD_CATEGORY: 4 } },
        typeorm: { In: (value) => value, Not: (value) => value },
    });
    const permission = new Permissions(flags.reduce((total, flag) => total | Permissions.FLAGS[flag], 0n));
    permission.cache = { guild: { id: "guild-1", mfa_level: 0 } };
    const move = (body) => handler({ params: { guild_id: "guild-1" }, body, permission, user_id: "manager" }, { sendStatus() {} });
    return { move, updates };
}

test("syncing a channel to its new category needs the overwrite authority that editing them does", async () => {
    const manager = reorder("VIEW_CHANNEL", "MANAGE_CHANNELS");
    await assert.rejects(manager.move([{ id: "staff", parent_id: "open", lock_permissions: true }]), (err) => err === errors.MISSING_PERMISSIONS);
    assert.equal(manager.updates.length, 0);

    const plain = reorder("VIEW_CHANNEL", "MANAGE_CHANNELS");
    await plain.move([{ id: "staff", parent_id: "open" }]);
    assert.deepEqual(plain.updates, [{ id: "staff", parent_id: "open" }]);

    const roles = reorder("VIEW_CHANNEL", "MANAGE_CHANNELS", "MANAGE_ROLES");
    await roles.move([{ id: "staff", parent_id: "open", lock_permissions: true }]);
    assert.deepEqual(roles.updates, [{ id: "staff", parent_id: "open", permission_overwrites: [] }]);
});
