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
            Buffer,
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
    UNKNOWN_WEBHOOK: Object.assign(new Error("Unknown Webhook"), { code: 10015 }),
    UNKNOWN_CHANNEL: Object.assign(new Error("Unknown Channel"), { code: 10003 }),
    THREAD_IS_LOCKED: Object.assign(new Error("Thread is locked"), { code: 160005 }),
    CANNOT_EDIT_ARCHIVED_THREAD: Object.assign(new Error("Archived"), { code: 50083 }),
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

const moderator = (flags, mfa_enabled) => {
    const permission = new Permissions(flags.reduce((total, flag) => total | Permissions.FLAGS[flag], 0n));
    permission.cache = { guild: { id: "guild-1", mfa_level: 1 }, mfa_enabled };
    return permission;
};

const routes = (file, imports) => {
    const handlers = {};
    const register =
        (method) =>
        (path, ...steps) => {
            handlers[`${method} ${path}`] = steps.at(-1);
        };
    const router = { get: register("get"), post: register("post"), put: register("put"), patch: register("patch"), delete: register("delete") };
    compile(file, {
        express: { Router: () => router },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "lambert-server/HTTPError": { HTTPError: class extends Error {} },
        ...imports,
    });
    return handlers;
};

const response = () => {
    const res = { statusCode: 200 };
    res.status = (code) => {
        res.statusCode = code;
        return res;
    };
    res.json = (body) => {
        res.body = body;
        return res;
    };
    res.sendStatus = res.status;
    return res;
};

test("hasWithMfa demands 2FA only when the elevated permission is the one granting access", () => {
    assert.equal(moderator(["VIEW_CHANNEL"], false).hasWithMfa("MANAGE_THREADS"), false);
    assert.throws(
        () => moderator(["MANAGE_THREADS"], false).hasWithMfa("MANAGE_THREADS"),
        (err) => err === errors.TWO_FACTOR_REQUIRED,
    );
    assert.equal(moderator(["MANAGE_THREADS"], true).hasWithMfa("MANAGE_THREADS"), true);
    assert.equal(moderator(["MANAGE_THREADS"], false).mfaSatisfied("MANAGE_THREADS"), false);
    assert.equal(moderator(["MANAGE_THREADS"], false).mfaSatisfied("SEND_MESSAGES"), true);
});

test("webhook GET refuses a MANAGE_WEBHOOKS moderator without 2FA in an mfa_level 1 guild", async () => {
    let permission;
    const webhook = { id: "hook-1", guild_id: "guild-1", channel_id: "channel-1", user_id: "someone-else" };
    const handlers = routes("src/api/routes/webhooks/#webhook_id/index.ts", {
        "@spacebar/database": { AuditLog: {}, Webhook: { findOneOrFail: async () => webhook } },
        "@spacebar/util": { DiscordApiErrors: errors, getPermission: async () => permission, emitEvent: async () => {} },
        "@spacebar/schemas": { AuditLogEvents: {} },
        "@spacebar/api/util/handlers/Webhook": { applyWebhookUpdate: async () => {}, webhookToJSON: (hook) => ({ id: hook.id, token: "secret" }) },
    });
    const req = { params: { webhook_id: "hook-1" }, user_id: "moderator", headers: {}, body: {} };

    permission = moderator(["MANAGE_WEBHOOKS"], false);
    await assert.rejects(
        () => handlers["get /"](req, response()),
        (err) => err === errors.TWO_FACTOR_REQUIRED,
    );
    await assert.rejects(
        () => handlers["delete /"](req, response()),
        (err) => err === errors.TWO_FACTOR_REQUIRED,
    );

    permission = moderator(["MANAGE_WEBHOOKS"], true);
    const res = response();
    await handlers["get /"](req, res);
    assert.equal(res.body.id, "hook-1");
});

test("soundboard edits of another member's sound need 2FA, edits of one's own sound do not", async () => {
    let permission;
    const sounds = {
        theirs: { id: "theirs", guild_id: "guild-1", user_id: "someone-else", save: async () => {}, toJSON: () => ({}) },
        mine: { id: "mine", guild_id: "guild-1", user_id: "moderator", save: async () => {}, toJSON: () => ({}) },
    };
    const handlers = routes("src/api/routes/guilds/#guild_id/soundboard-sounds.ts", {
        "@spacebar/database": { Member: {}, SoundboardSound: { findOne: async ({ where }) => sounds[where.id] } },
        "@spacebar/util": {
            DiscordApiErrors: errors,
            FieldErrors: () => new Error("field"),
            Snowflake: {},
            deleteFile: async () => {},
            emitEvent: async () => {},
            getPermission: async () => permission,
            handleFile: async () => {},
        },
        "@spacebar/schemas": {},
    });
    const edit = (sound_id) => handlers["patch /:sound_id"]({ params: { guild_id: "guild-1", sound_id }, user_id: "moderator", body: { name: "x" } }, response());

    permission = moderator(["MANAGE_EMOJIS_AND_STICKERS", "CREATE_GUILD_EXPRESSIONS"], false);
    await assert.rejects(
        () => edit("theirs"),
        (err) => err === errors.TWO_FACTOR_REQUIRED,
    );
    await edit("mine");

    permission = moderator(["MANAGE_EMOJIS_AND_STICKERS"], true);
    await edit("theirs");
});

test("removing another member from a thread with MANAGE_THREADS needs 2FA", async () => {
    let left = 0;
    const thread = { id: "thread-1", guild_id: "guild-1", owner_id: "owner", thread_metadata: {}, isThread: () => true, isPrivateThread: () => false };
    const handlers = routes("src/api/routes/channels/#channel_id/thread-members.ts", {
        typeorm: { In: () => ({}), MoreThan: () => ({}) },
        "@spacebar/database": { Channel: { findOne: async () => thread }, Member: {}, ThreadMember: { leave: async () => left++ }, ThreadMemberFlags: {} },
        "@spacebar/util": { DiscordApiErrors: errors, emitEvent: async () => {}, getPermission: async () => {} },
    });
    const remove = (permission, user_id) => handlers["delete /:user_id"]({ params: { channel_id: "thread-1", user_id }, user_id: "moderator", permission }, response());

    await assert.rejects(
        () => remove(moderator(["VIEW_CHANNEL", "MANAGE_THREADS"], false), "victim"),
        (err) => err === errors.TWO_FACTOR_REQUIRED,
    );
    await remove(moderator(["VIEW_CHANNEL"], false), "@me");
    await remove(moderator(["VIEW_CHANNEL", "MANAGE_THREADS"], true), "victim");
    assert.equal(left, 2);
});
