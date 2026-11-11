const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const RAINBOW = "8000000000000000001";
const TRANSGENDER = "8000000000000000006";
const NONBINARY = "8000000000000000017";
const BUG_HUNTER = "42";

const settingsModule = { exports: {} };
vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/api/util/utility/badgeSettings.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
        exports: settingsModule.exports,
        module: settingsModule,
        require(name) {
            if (name === "@spacebar/util") return { FieldErrors: (fields) => Object.assign(Error("invalid"), { fields }) };
            if (name === "./staffBadge") return { STAFF_BADGE_ID: "1" };
            if (name === "./prideBadges") return { PRIDE_BADGES: [RAINBOW, TRANSGENDER, NONBINARY].map((id) => ({ id })) };
            throw Error(name);
        },
    },
);
const { arrangeBadges, badgeSettings, mergeBadgeSettings, MAX_BADGE_SETTING_IDS } = settingsModule.exports;

const badges = [{ id: "1" }, { id: "staff-role-55" }, { id: RAINBOW }, { id: TRANSGENDER }, { id: NONBINARY }, { id: BUG_HUNTER }];
const ids = (list) => Array.from(list, (badge) => badge.id);

test("badges keep their original order without settings", () => {
    const { visible, hidden } = arrangeBadges(badges, badgeSettings({ account_preferences: {} }));
    assert.deepEqual(ids(visible), ids(badges));
    assert.equal(hidden.length, 0);
});

test("display order moves listed badges first and keeps the rest in their order", () => {
    const { visible } = arrangeBadges(badges, { display_order: [NONBINARY], hidden_badges: [] });
    assert.deepEqual(ids(visible), ["1", "staff-role-55", NONBINARY, RAINBOW, TRANSGENDER, BUG_HUNTER]);
});

test("staff badges stay first and neither staff nor pride badges can be hidden", () => {
    const { visible, hidden } = arrangeBadges(badges, { display_order: [TRANSGENDER, "1"], hidden_badges: ["1", "staff-role-55", RAINBOW, BUG_HUNTER] });
    assert.deepEqual(ids(visible), ["1", "staff-role-55", TRANSGENDER, RAINBOW, NONBINARY]);
    assert.deepEqual(ids(hidden), [BUG_HUNTER]);
});

test("saved settings keep only the user's own arrangeable badges", () => {
    const merged = mergeBadgeSettings({ display_order: [], hidden_badges: [] }, badges, {
        display_order: [TRANSGENDER, "1", "staff-role-55", "9999", RAINBOW, TRANSGENDER],
        hidden_badges: [17, NONBINARY, 42],
    });
    assert.deepEqual(JSON.parse(JSON.stringify(merged)), { display_order: [TRANSGENDER, RAINBOW], hidden_badges: [BUG_HUNTER] });
});

test("a partial update keeps the other saved list", () => {
    const current = { display_order: [TRANSGENDER], hidden_badges: [BUG_HUNTER] };
    assert.deepEqual(JSON.parse(JSON.stringify(mergeBadgeSettings(current, badges, { hidden_badges: [] }))), { display_order: [TRANSGENDER], hidden_badges: [] });
    assert.deepEqual(JSON.parse(JSON.stringify(mergeBadgeSettings(current, badges, {}))), current);
});

test("malformed settings are rejected with a field error", () => {
    const current = { display_order: [], hidden_badges: [] };
    for (const body of [
        { display_order: "x" },
        { hidden_badges: [{}] },
        { hidden_badges: ["has space"] },
        { display_order: ["x".repeat(65)] },
        { display_order: Array.from({ length: MAX_BADGE_SETTING_IDS + 1 }, (_, index) => `${index}`) },
    ]) {
        assert.throws(
            () => mergeBadgeSettings(current, badges, body),
            (error) => Object.keys(error.fields).length === 1,
        );
    }
});

test("hiding a pride badge is a per-user setting with no instance switch", () => {
    const sources = [
        "src/api/util/utility/badgeSettings.ts",
        "src/api/util/utility/profileBadges.ts",
        "src/api/routes/users/@me/badges/settings.ts",
        "client/plugins/fosscordProfileBadges/index.ts",
    ].map((path) => fs.readFileSync(path, "utf8"));
    for (const source of sources) {
        assert.doesNotMatch(source, /Config\.get\(\)\.(?:pride|badge)|process\.env|options:\s*\{|settings\.store/i);
    }
    assert.match(sources[2], /loadBadgeOwner\(req\.user_id, req\.user_id\)/);
});

test("the client maps unknown profile badge ids to themselves and staff to the staff directory id", () => {
    const source = fs.readFileSync("client/plugins/fosscordProfileBadges/index.ts", "utf8");
    const match = source.match(/match: \/(.+)\/,\n/)[1];
    const regex = new RegExp(match.replaceAll("\\i", "[A-Za-z_$][\\w$]*"));
    const replace = source.match(/replace: "(.+)",\n/)[1];
    const original = 'function o(e){let t=l[e];if(null!=t)return t;let n=i.$[e.toUpperCase()];return"number"==typeof n?n:void 0}';
    const patched = original.replace(regex, replace.replace("$self", "self"));
    assert.notEqual(patched, original);
    const directoryBadgeId = (id) => (id === "1" || id.startsWith("staff-role-") ? 22 : id);
    const lookup = new Function("l", "i", "self", `${patched};return o;`)({ premium_tenure_1_month_v2: 1 }, { $: { HYPESQUAD: 3 } }, { directoryBadgeId });
    assert.equal(lookup("premium_tenure_1_month_v2"), 1);
    assert.equal(lookup("hypesquad"), 3);
    assert.equal(lookup(RAINBOW), RAINBOW);
    assert.equal(lookup("1"), 22);
    assert.equal(lookup("staff-role-55"), 22);
});
