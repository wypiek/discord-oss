const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const MISSING_RIGHTS = new Error("Missing rights");
const SAVED = new Error("member saved");
const stubs = (known) => new Proxy(known, { get: (target, key) => (key in target ? target[key] : () => ({})) });

function memberRoute(rights) {
    let patch;
    const imports = {
        "@spacebar/util/util/IdentityModeration": { assertIdentityNameAllowed() {} },
        express: { Router: () => ({ get() {}, put() {}, delete() {}, patch: (_, ...steps) => (patch = steps.at(-1)) }) },
        "@spacebar/api/util/utility/memberRoleAuthorization": { authorizeMemberRoleChanges: async () => [] },
        "@spacebar/api/middlewares": { route: () => () => {} },
        "@spacebar/database": stubs({
            Member: {
                findOneOrFail: async () => ({
                    id: "target",
                    guild_id: "guild",
                    roles: [],
                    nick: null,
                    mute: false,
                    deaf: false,
                    communication_disabled_until: null,
                    assign() {},
                    save: async () => {
                        throw SAVED;
                    },
                }),
            },
        }),
        typeorm: { IsNull: () => null, MoreThan: () => ({}), Not: (value) => value },
        "@spacebar/util": stubs({
            Collectibles: { item: async (sku_id) => ({ sku_id, asset: "asset" }) },
            CollectibleItemType: {},
            DiscordApiErrors: {},
            getPermission: async () => ({ has: () => false, hasThrow: () => true }),
            getRights: async () => ({
                hasThrow(right) {
                    if (!rights.includes(right)) throw MISSING_RIGHTS;
                    return true;
                },
            }),
            noteRightsBypass: async () => {},
            Permissions: {},
        }),
        "@spacebar/api/util": stubs({}),
        "@spacebar/schemas": { AuditLogEvents: {}, PublicMemberProjection: [], PublicUserProjection: [] },
    };
    const loaded = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/routes/guilds/#guild_id/members/#member_id/index.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module: loaded,
            exports: loaded.exports,
            require: (name) => {
                assert.ok(name in imports, `missing mock for ${name}`);
                return imports[name];
            },
        },
    );
    return (member_id, body) => patch({ params: { guild_id: "guild", member_id }, user_id: "actor", body }, { json() {} });
}

const styles = [
    { display_name_colors: [16711680] },
    { display_name_font_id: 3 },
    { display_name_effect_id: 2 },
    { avatar_decoration_sku_id: "sku" },
    { collectibles: { nameplate: { sku_id: "sku" } } },
    { collectibles: null },
];

test("a member without MANAGE_USERS cannot change another member's server profile style", async () => {
    const patch = memberRoute([]);
    for (const body of styles) await assert.rejects(patch("target", body), (err) => err === MISSING_RIGHTS, JSON.stringify(body));
});

test("a member can change their own server profile style", async () => {
    const patch = memberRoute([]);
    for (const body of styles) await assert.rejects(patch("@me", body), (err) => err === SAVED, JSON.stringify(body));
});

test("staff with MANAGE_USERS can still change another member's server profile", async () => {
    const patch = memberRoute(["MANAGE_USERS"]);
    await assert.rejects(patch("target", { display_name_colors: [1] }), (err) => err === SAVED);
});
