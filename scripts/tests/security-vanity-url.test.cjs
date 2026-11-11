const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { Database } = require("bun:sqlite");
const { StubError, loadModule, loadRoutes, response } = require("./helpers/route-harness.cjs");

const json = (value) => JSON.parse(JSON.stringify(value));

function vanityRoute({ invites, features = ["VANITY_URL"], failInsert }) {
    const writes = [];
    const guildRow = { id: "guild", features, rules_channel_id: "rules", system_channel_id: null, vanity_url_code: null };
    const matches = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
    const manager = {
        delete: async (_, where) => {
            writes.push(["delete", json(where)]);
            for (let index = invites.length - 1; index >= 0; index--) if (matches(invites[index], where)) invites.splice(index, 1);
        },
        findOne: async (_, { where }) => invites.find((row) => matches(row, where)) ?? null,
        insert: async (_, row) => {
            if (failInsert) throw Object.assign(new Error("duplicate key"), { driverError: { code: "23505" } });
            writes.push(["insert", row.code]);
            invites.push(row);
        },
        update: async (_, where, values) => writes.push(["guild", values.vanity_url_code]),
    };
    const routes = loadRoutes("src/api/routes/guilds/#guild_id/vanity-url.ts", {
        "lambert-server/HTTPError": { HTTPError: StubError },
        "@spacebar/schemas": { ChannelType: { GUILD_TEXT: 0 } },
        "@spacebar/database": {
            Channel: { findOneOrFail: async () => ({ id: "general" }) },
            Guild: { findOneOrFail: async () => guildRow, emitUpdate: async () => undefined },
            Invite: { findOne: async ({ where }) => invites.find((row) => matches(row, where)) ?? null },
            getDatabase: () => ({
                transaction: async (work) => {
                    const snapshot = invites.map((row) => ({ ...row }));
                    try {
                        return await work(manager);
                    } catch (error) {
                        invites.splice(0, invites.length, ...snapshot);
                        throw error;
                    }
                },
            }),
        },
    });
    return {
        writes,
        patch: async (code) => {
            const res = response();
            await routes["PATCH /"]({ params: { guild_id: "guild" }, body: { code } }, res);
            return res.body;
        },
    };
}

test("a taken vanity code is refused before the guild's current one is deleted", async () => {
    const invites = [
        { code: "meowcord", guild_id: "guild", vanity_url: true },
        { code: "taken", guild_id: "other", vanity_url: true },
    ];
    const { patch, writes } = vanityRoute({ invites });
    await assert.rejects(patch("Taken"), /already taken/);
    assert.deepEqual(writes, []);
    assert.ok(invites.some((row) => row.code === "meowcord" && row.guild_id === "guild"));
});

test("vanity codes are stored lowercase, so different case can't belong to another guild", async () => {
    const invites = [{ code: "meowcord", guild_id: "other", vanity_url: true }];
    const { patch } = vanityRoute({ invites });
    await assert.rejects(patch("MeowCord"), /already taken/);
    const fresh = vanityRoute({ invites: [] });
    assert.equal(JSON.stringify(await fresh.patch("NewName")), JSON.stringify({ code: "newname" }));
    assert.deepEqual(fresh.writes, [
        ["delete", { guild_id: "guild", vanity_url: true }],
        ["insert", "newname"],
        ["guild", "newname"],
    ]);
});

test("the swap is one transaction and a lost race keeps the old vanity", async () => {
    const invites = [{ code: "meowcord", guild_id: "guild", vanity_url: true }];
    const { patch } = vanityRoute({ invites, failInsert: true });
    await assert.rejects(patch("racing"), /already taken/);
    assert.deepEqual(json(invites), [{ code: "meowcord", guild_id: "guild", vanity_url: true }]);
});

test("a guild can set its own vanity code again", async () => {
    const invites = [{ code: "meowcord", guild_id: "guild", vanity_url: true }];
    const { patch } = vanityRoute({ invites });
    assert.equal(JSON.stringify(await patch("Meowcord")), JSON.stringify({ code: "meowcord" }));
    assert.deepEqual(json(invites.map((row) => row.code)), ["meowcord"]);
});

test("invite lookups resolve a vanity code in any case", async () => {
    const rows = [
        { code: "meowcord", vanity_url: true },
        { code: "AbC123", vanity_url: false },
    ];
    const source = fs.readFileSync("src/database/entities/Invite.ts", "utf8");
    const parsed = ts.createSourceFile("Invite.ts", source, ts.ScriptTarget.ES2022, true);
    const method = parsed.statements.find((node) => ts.isClassDeclaration(node)).members.find((member) => member.name?.getText(parsed) === "resolveCode");
    assert.ok(method, "Invite.resolveCode exists");
    const { Invite } = loadModule("src/database/entities/Invite.ts", {
        typeorm: new Proxy({}, { get: () => () => () => undefined }),
        "./BaseClass": {
            BaseClassWithoutId: class {
                static async exists({ where }) {
                    return rows.some((row) => Object.entries(where).every(([key, value]) => row[key] === value));
                }
            },
        },
        "./Member": { Member: class {} },
        "./Guild": { Guild: class {} },
        "./Channel": { Channel: class {} },
        "./User": { User: class {} },
        "./Recipient": { Recipient: class {} },
        "@spacebar/util/util": { DiscordApiErrors: {} },
        "@spacebar/schemas": {},
        "@spacebar/schemas/api/guilds/Invite": { InviteType: {} },
    });
    assert.equal(await Invite.resolveCode("MeowCord"), "meowcord");
    assert.equal(await Invite.resolveCode("meowcord"), "meowcord");
    assert.equal(await Invite.resolveCode("AbC123"), "AbC123");
    assert.equal(await Invite.resolveCode("ABC123"), "ABC123");
});

for (const backend of ["postgres", "sqlite"]) {
    test(`the ${backend} migration lowercases vanity codes and drops case-insensitive duplicates`, async () => {
        const db = new Database(":memory:");
        db.exec(`CREATE TABLE "guilds" ("id" varchar PRIMARY KEY, "vanity_url_code" varchar)`);
        db.exec(`CREATE TABLE "invites" ("code" varchar PRIMARY KEY, "guild_id" varchar, "vanity_url" boolean, "created_at" datetime)`);
        const guilds = [
            ["first", "Meowcord"],
            ["second", "meowCORD"],
            ["third", "Shadowed"],
            ["fourth", "plain"],
        ];
        for (const [id, code] of guilds) db.run(`INSERT INTO "guilds" VALUES (?, ?)`, [id, code]);
        const invites = [
            ["Meowcord", "first", 1, "2026-01-01"],
            ["meowCORD", "second", 1, "2026-02-01"],
            ["Shadowed", "third", 1, "2026-01-01"],
            ["shadowed", "fifth", 0, "2026-03-01"],
            ["plain", "fourth", 1, "2026-01-01"],
        ];
        for (const row of invites) db.run(`INSERT INTO "invites" VALUES (?, ?, ?, ?)`, row);
        const file = fs.readdirSync(`src/database/migration/${backend}`).find((name) => name.endsWith("-LowercaseVanityCodes.ts"));
        assert.ok(file, `${backend} migration exists`);
        const { LowercaseVanityCodes1793318402771: Migration } = loadModule(`src/database/migration/${backend}/${file}`, {});
        const runner = { query: async (sql) => db.exec(sql) };
        await new Migration().up(runner);
        await new Migration().up(runner);
        assert.deepEqual(json(db.query(`SELECT "code", "guild_id" FROM "invites" ORDER BY "code"`).all()), [
            { code: "Shadowed", guild_id: "third" },
            { code: "meowcord", guild_id: "first" },
            { code: "plain", guild_id: "fourth" },
            { code: "shadowed", guild_id: "fifth" },
        ]);
        assert.deepEqual(json(db.query(`SELECT "id", "vanity_url_code" FROM "guilds" ORDER BY "id"`).all()), [
            { id: "first", vanity_url_code: "meowcord" },
            { id: "fourth", vanity_url_code: "plain" },
            { id: "second", vanity_url_code: null },
            { id: "third", vanity_url_code: "Shadowed" },
        ]);
    });
}
