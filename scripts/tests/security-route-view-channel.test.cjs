const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
require("../../dist/util");
const { ApiError } = require("../../dist/util/util/ApiError.js");
const { DiscordApiErrors } = require("../../dist/util/util/Constants.js");
const { Permissions } = require("../../dist/util/util/Permissions.js");

function gate(options, granted) {
    const module = { exports: {} };
    const imports = {
        "@spacebar/util": {
            ApiError,
            DiscordApiErrors,
            Permissions,
            Config: { get: () => ({ login: { requireVerification: false } }) },
            getPermission: async () => new Permissions(granted),
        },
        "@spacebar/database": {},
        "@spacebar/schemas": { getAjv: () => ({}) },
        "bignumber.js": { BigNumber: class {} },
        "../util/utility/staffAudit": { watchStaffRequest: () => {} },
        "../util/utility/fieldCaps": { auditLogReason: () => undefined },
    };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/middlewares/Route.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            Set,
            require: (id) => {
                assert.ok(id in imports, id);
                return imports[id];
            },
        },
    );
    const handler = module.exports.route(options);
    return async (params) => {
        let passed = false;
        await handler({ method: "POST", params, headers: {}, body: {}, isAuthenticated: true, user: { id: "1", verified: true }, user_id: "1" }, {}, () => {
            passed = true;
        });
        return passed;
    };
}

const missingAccess = (error) => error instanceof ApiError && error.code === DiscordApiErrors.MISSING_ACCESS.code;

test("a channel route refuses a permission held without VIEW_CHANNEL", async () => {
    const request = gate({ permission: "CREATE_INSTANT_INVITE" }, Permissions.FLAGS.CREATE_INSTANT_INVITE);
    await assert.rejects(request({ channel_id: "123" }), missingAccess);
});

test("a channel route passes with the permission and VIEW_CHANNEL", async () => {
    const request = gate({ permission: "CREATE_INSTANT_INVITE" }, Permissions.FLAGS.CREATE_INSTANT_INVITE | Permissions.FLAGS.VIEW_CHANNEL);
    assert.equal(await request({ channel_id: "123" }), true);
});

test("a guild route without a channel doesn't need VIEW_CHANNEL", async () => {
    const request = gate({ permission: "MANAGE_GUILD" }, Permissions.FLAGS.MANAGE_GUILD);
    assert.equal(await request({ guild_id: "1" }), true);
});
