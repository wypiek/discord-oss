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
            Date,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    return module.exports;
};

const errors = {
    MISSING_ACCESS: Object.assign(new Error("Missing Access"), { code: 50001 }),
    MISSING_PERMISSIONS: Object.assign(new Error("Missing Permissions"), { code: 50013 }),
    TWO_FACTOR_REQUIRED: Object.assign(new Error("Two factor is required for this operation"), { code: 60003 }),
    INVALID_FORM_BODY: Object.assign(new Error("Invalid Form Body"), { code: 50035 }),
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

const { assertOverwriteChanges } = compile("src/api/util/utility/channelOverwrites.ts", {
    "@spacebar/util": { DiscordApiErrors: errors, Permissions },
});

const member = (...flags) => {
    const permission = new Permissions(flags.reduce((total, flag) => total | Permissions.FLAGS[flag], 0n));
    permission.cache = { guild: { id: "guild-1", mfa_level: 0 } };
    return permission;
};

const self = (allow, deny = "0") => ({ id: "user-1", type: 1, allow: String(allow), deny: String(deny) });
const everyone = (allow, deny = "0") => ({ id: "guild-1", type: 0, allow: String(allow), deny: String(deny) });

test("a channel manager without MANAGE_ROLES cannot rewrite overwrites through PATCH", () => {
    const manager = member("VIEW_CHANNEL", "SEND_MESSAGES", "MANAGE_CHANNELS");
    assert.throws(
        () => assertOverwriteChanges(manager, [], [self(Permissions.FLAGS.ADMINISTRATOR)], true),
        (err) => err === errors.MISSING_PERMISSIONS,
    );
    assert.throws(
        () => assertOverwriteChanges(manager, [everyone(0, Permissions.FLAGS.SEND_MESSAGES)], [], true),
        (err) => err === errors.MISSING_PERMISSIONS,
    );
    assert.doesNotThrow(() => assertOverwriteChanges(manager, [everyone(0, 2048)], [everyone(0, 2048)], true));
});

test("overwrites can only grant or deny bits the caller holds", () => {
    const manager = member("VIEW_CHANNEL", "SEND_MESSAGES", "MANAGE_CHANNELS", "MANAGE_ROLES");
    assert.throws(
        () => assertOverwriteChanges(manager, [], [self(Permissions.FLAGS.ADMINISTRATOR)], true),
        (err) => err === errors.MISSING_PERMISSIONS,
    );
    assert.throws(
        () => assertOverwriteChanges(manager, [], [self(Permissions.FLAGS.BAN_MEMBERS)], false),
        (err) => err === errors.MISSING_PERMISSIONS,
    );
    assert.throws(
        () => assertOverwriteChanges(manager, [], [self(Permissions.FLAGS.MANAGE_ROLES)], false),
        (err) => err === errors.MISSING_PERMISSIONS,
    );
    assert.doesNotThrow(() => assertOverwriteChanges(manager, [], [everyone(0, Permissions.FLAGS.VIEW_CHANNEL), self(Permissions.FLAGS.VIEW_CHANNEL)], false));
    assert.doesNotThrow(() =>
        assertOverwriteChanges(manager, [everyone(0, Permissions.FLAGS.BAN_MEMBERS)], [everyone(Permissions.FLAGS.SEND_MESSAGES, Permissions.FLAGS.BAN_MEMBERS)], true),
    );
});

test("administrators may set any overwrite", () => {
    assert.doesNotThrow(() => assertOverwriteChanges(member("ADMINISTRATOR"), [], [self(Permissions.FLAGS.MANAGE_ROLES | Permissions.FLAGS.BAN_MEMBERS)], true));
});

test("both channel routes run the overwrite check before writing", () => {
    const patch = fs.readFileSync("src/api/routes/channels/#channel_id/index.ts", "utf8");
    assert.match(patch, /assertOverwriteChanges\(req\.permission!, channel\.permission_overwrites, payload\.permission_overwrites, true\)/);
    const create = fs.readFileSync("src/api/routes/guilds/#guild_id/channels.ts", "utf8");
    assert.ok(create.indexOf("assertOverwriteChanges(") < create.indexOf("Channel.createChannel("));
});

function overwriteRoute(permission, overwrites) {
    const routes = {};
    const channel = { id: "channel-1", guild_id: "guild-1", permission_overwrites: overwrites, save: async () => {}, toJSON: () => ({}) };
    compile("src/api/routes/channels/#channel_id/permissions.ts", {
        express: {
            Router: () => ({
                put: (_, ...steps) => {
                    routes.put = steps.at(-1);
                },
                delete: (_, ...steps) => {
                    routes.delete = steps.at(-1);
                },
            }),
        },
        "lambert-server/HTTPError": { HTTPError: class extends Error {} },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/api/util": { assertOverwriteChanges },
        "@spacebar/database": {
            AuditLog: { diff: () => [], log: async () => {} },
            Channel: { findOneOrFail: async () => channel, calculatePosition: async () => 0 },
            Member: { count: async () => 1 },
            Role: { count: async () => 1 },
        },
        "@spacebar/util": { emitEvent: async () => {} },
        "@spacebar/schemas": { AuditLogEvents: {}, ChannelPermissionOverwriteType: { role: 0, member: 1 } },
    });
    const request = (overwrite_id, body) => ({ params: { channel_id: "channel-1", overwrite_id }, body, permission, user_id: "user-1", headers: {} });
    return {
        channel,
        put: (overwrite_id, body) => routes.put(request(overwrite_id, body), { sendStatus() {} }),
        remove: (overwrite_id) => routes.delete(request(overwrite_id), { sendStatus() {} }),
    };
}

test("the overwrite PUT stores what an administrator asks for and refuses bits a member lacks", async () => {
    const owner = overwriteRoute(member("ADMINISTRATOR"), []);
    const granted = String(Permissions.FLAGS.VIEW_CHANNEL | Permissions.FLAGS.MANAGE_ROLES);
    await owner.put("user-1", { type: 1, allow: granted, deny: String(Permissions.FLAGS.SEND_MESSAGES) });
    assert.deepEqual(JSON.parse(JSON.stringify(owner.channel.permission_overwrites)), [{ id: "user-1", type: 1, allow: granted, deny: String(Permissions.FLAGS.SEND_MESSAGES) }]);

    const roles = overwriteRoute(member("VIEW_CHANNEL", "MANAGE_ROLES"), []);
    await assert.rejects(roles.put("user-1", { type: 1, allow: String(Permissions.FLAGS.BAN_MEMBERS), deny: "0" }), (err) => err === errors.MISSING_PERMISSIONS);
    await assert.rejects(roles.put("user-1", { type: 1, allow: String(Permissions.FLAGS.MANAGE_ROLES), deny: "0" }), (err) => err === errors.MISSING_PERMISSIONS);
    await roles.put("user-1", { type: 1, allow: String(Permissions.FLAGS.VIEW_CHANNEL), deny: "0" });
    assert.deepEqual(JSON.parse(JSON.stringify(roles.channel.permission_overwrites)), [{ id: "user-1", type: 1, allow: String(Permissions.FLAGS.VIEW_CHANNEL), deny: "0" }]);
});

test("deleting an overwrite needs authority over the bits it held", async () => {
    const route = overwriteRoute(member("VIEW_CHANNEL", "MANAGE_ROLES"), [everyone(0, Permissions.FLAGS.BAN_MEMBERS), self(Permissions.FLAGS.VIEW_CHANNEL)]);
    await assert.rejects(route.remove("guild-1"), (err) => err === errors.MISSING_PERMISSIONS);
    await route.remove("user-1");
    assert.deepEqual(route.channel.permission_overwrites, [everyone(0, Permissions.FLAGS.BAN_MEMBERS)]);
});
