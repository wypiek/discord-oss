const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const transpile = (file) =>
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;

function load(file, imports = {}) {
    const module = { exports: {} };
    vm.runInNewContext(transpile(file), {
        module,
        exports: module.exports,
        require(name) {
            if (name in imports) return imports[name];
            throw Error(`unexpected import ${name}`);
        },
    });
    return module.exports;
}

const visibility = load("src/api/util/utility/profileVisibility.ts");
const { ProfileVisibility, sharesFullProfile, limitedProfile, SMALL_GUILD_MAX_MEMBERS } = visibility;
const stranger = { self: false, friend: false, staff: false, sharedGuildMemberCounts: [] };

test("the default and Friends & All Servers settings share the full profile with everyone", () => {
    for (const setting of [undefined, null, ProfileVisibility.UNSET, ProfileVisibility.FRIENDS_AND_ALL_GUILDS]) {
        assert.equal(sharesFullProfile(setting, stranger), true);
        assert.equal(sharesFullProfile(setting, { ...stranger, sharedGuildMemberCounts: [5000] }), true);
    }
});

test("Friends Only hides the full profile from everyone but friends, the user and staff", () => {
    const only = ProfileVisibility.FRIENDS_ONLY;
    assert.equal(sharesFullProfile(only, stranger), false);
    assert.equal(sharesFullProfile(only, { ...stranger, sharedGuildMemberCounts: [3, 10] }), false);
    assert.equal(sharesFullProfile(only, { ...stranger, friend: true }), true);
    assert.equal(sharesFullProfile(only, { ...stranger, self: true }), true);
    assert.equal(sharesFullProfile(only, { ...stranger, staff: true }), true);
});

test("Friends & Small Servers shares the full profile through a server of 200 or fewer members", () => {
    const small = ProfileVisibility.FRIENDS_AND_SMALL_GUILDS;
    assert.equal(SMALL_GUILD_MAX_MEMBERS, 200);
    assert.equal(sharesFullProfile(small, stranger), false);
    assert.equal(sharesFullProfile(small, { ...stranger, sharedGuildMemberCounts: [201, 5000] }), false);
    assert.equal(sharesFullProfile(small, { ...stranger, sharedGuildMemberCounts: [5000, 200] }), true);
    assert.equal(sharesFullProfile(small, { ...stranger, sharedGuildMemberCounts: [2] }), true);
    assert.equal(sharesFullProfile(small, { ...stranger, friend: true, sharedGuildMemberCounts: [5000] }), true);
});

test("the limited profile blanks profile info and keeps the identity, look and mutuals", () => {
    const full = {
        user: { id: "1", username: "tester", bio: "my bio", pride_badges: ["rainbow"], banner: "b" },
        user_profile: { bio: "my bio", pronouns: "they/them", banner: "b", accent_color: 5, theme_colors: [1, 2] },
        guild_member_profile: { guild_id: "9", bio: "guild bio", pronouns: "she/her", banner: null },
        connected_accounts: [{ type: "github", name: "x" }],
        badges: [{ id: "staff" }],
        guild_badges: [{ id: "g" }],
        widgets: [{ id: "w" }],
        premium_since: "2020-01-01",
        premium_guild_since: "2020-01-01",
        premium_type: 2,
        mutual_guilds: [{ id: "9", nick: null }],
        mutual_friends_count: 3,
    };
    const limited = limitedProfile(full);
    assert.equal(limited.private, true);
    assert.equal(limited.user.bio, "");
    assert.deepEqual(limited.user.pride_badges, ["rainbow"]);
    assert.equal(limited.user.username, "tester");
    assert.deepEqual({ bio: limited.user_profile.bio, pronouns: limited.user_profile.pronouns }, { bio: "", pronouns: "" });
    assert.equal(limited.user_profile.banner, "b");
    assert.deepEqual(limited.user_profile.theme_colors, [1, 2]);
    assert.deepEqual({ bio: limited.guild_member_profile.bio, pronouns: limited.guild_member_profile.pronouns }, { bio: "", pronouns: "" });
    assert.equal(limited.guild_member_profile.guild_id, "9");
    for (const key of ["connected_accounts", "badges", "guild_badges", "widgets"]) assert.equal(limited[key].length, 0, key);
    assert.equal(limited.premium_since, null);
    assert.equal(limited.premium_guild_since, null);
    assert.deepEqual(limited.mutual_guilds, full.mutual_guilds);
    assert.equal(limited.mutual_friends_count, 3);
    assert.equal(full.user.bio, "my bio");
    const { guild_member_profile, ...withoutGuild } = full;
    assert.equal(guild_member_profile.bio, "guild bio");
    assert.equal("guild_member_profile" in limitedProfile(withoutGuild), false);
});

function privacyModule({ setting, friends = [], viewerGuilds = [], targetGuilds = [], memberCounts = {} }) {
    const calls = { relationships: 0, members: 0 };
    const In = (values) => ({ in: values });
    const privacy = load("src/api/util/utility/profilePrivacy.ts", {
        typeorm: { In },
        "@spacebar/schemas": { RelationshipType: { FRIEND: 1 } },
        "@spacebar/util": { Rights: class {} },
        "./profileVisibility": visibility,
        "@spacebar/database": {
            UserSettingsProtos: {
                findOne: async () => (setting === undefined ? null : { userSettings: { privacy: { profileVisibility: setting } } }),
            },
            Relationship: {
                exists: async ({ where }) => {
                    calls.relationships++;
                    return where.from_id === "target" && where.type === 1 && friends.includes(where.to_id);
                },
            },
            Member: {
                find: async ({ where }) => {
                    calls.members++;
                    if (where.id === "target") return targetGuilds.filter((id) => where.guild_id.in.includes(id)).map((guild_id) => ({ guild_id }));
                    return viewerGuilds.map((guild_id) => ({ guild_id }));
                },
            },
            Guild: {
                find: async ({ where }) => where.id.in.map((id) => ({ id, member_count: memberCounts[id] })),
            },
        },
    });
    return { privacy, calls };
}

const rights = (granted) => ({ has: (right) => granted.includes(right) });

test("viewers resolve against the stored protobuf setting, friendships, shared servers and staff rights", async () => {
    const { privacy } = privacyModule({
        setting: ProfileVisibility.FRIENDS_AND_SMALL_GUILDS,
        friends: ["friend"],
        viewerGuilds: ["small", "big"],
        targetGuilds: ["small", "big"],
        memberCounts: { small: 12, big: 900 },
    });
    assert.equal(await privacy.viewerSeesFullProfile("target", "target"), true);
    assert.equal(await privacy.viewerSeesFullProfile("target", "friend"), true);
    assert.equal(await privacy.viewerSeesFullProfile("target", "member"), true);

    const large = privacyModule({ setting: ProfileVisibility.FRIENDS_AND_SMALL_GUILDS, viewerGuilds: ["big"], targetGuilds: ["big", "small"], memberCounts: { big: 900 } });
    assert.equal(await large.privacy.viewerSeesFullProfile("target", "member"), false);
    assert.equal(await large.privacy.viewerSeesFullProfile("target", "staff", rights(["VIEW_USERS"])), true);
    assert.equal(await large.privacy.viewerSeesFullProfile("target", "other", rights(["MANAGE_MESSAGES"])), false);
});

test("Friends Only never looks at shared servers and the default never queries relationships", async () => {
    const only = privacyModule({ setting: ProfileVisibility.FRIENDS_ONLY, viewerGuilds: ["small"], targetGuilds: ["small"], memberCounts: { small: 2 } });
    assert.equal(await only.privacy.viewerSeesFullProfile("target", "member"), false);
    assert.equal(only.calls.members, 0);

    for (const setting of [undefined, ProfileVisibility.FRIENDS_AND_ALL_GUILDS]) {
        const open = privacyModule({ setting });
        assert.equal(await open.privacy.viewerSeesFullProfile("target", "stranger"), true);
        assert.equal(open.calls.relationships, 0);
    }
});

test("every route that serves profile info checks the viewer", () => {
    const routes = [
        "src/api/routes/users/#user_id/profile.ts",
        "src/api/routes/users/#user_id/badges/index.ts",
        "src/api/routes/users/#user_id/badges/#badge_id.ts",
        "src/api/routes/users/#user_id/application-identities.ts",
    ];
    for (const route of routes) assert.match(fs.readFileSync(route, "utf8"), /viewerSeesFullProfile\(/, route);
});

test("public user objects never carry the bio or pronouns", () => {
    const schemas = fs.readFileSync("src/schemas/api/users/User.ts", "utf8");
    assert.match(schemas, /ProfileOnlyUserKeys: PublicUserKeys\[\] = \["bio", "pronouns"\]/);
    const entity = fs.readFileSync("src/database/entities/User.ts", "utf8");
    const toPublicUser = entity.slice(entity.indexOf("toPublicUser()"), entity.indexOf("toPartialUser()"));
    assert.match(toPublicUser, /PublicUserOutputKeys\.forEach/);
    assert.doesNotMatch(toPublicUser, /PublicUserProjection/);
});
