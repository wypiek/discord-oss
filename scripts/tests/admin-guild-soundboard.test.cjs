const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test, before, after, mock } = require("node:test");

const database = process.env.ADMIN_GUILD_MODERATION_TEST_DATABASE;
const enabled = Boolean(database);
const routes = ["src/api/routes/admin/guilds/#guild_id/soundboard-sounds/index.ts", "src/api/routes/admin/guilds/#guild_id/soundboard-sounds/#sound_id.ts"];
let e, db, list, edit, remove, Snowflake;
const users = [];
const guilds = [];
const emitted = [];

test("soundboard routes need the server right and refuse mirrored servers", () => {
    for (const file of routes) {
        const source = fs.readFileSync(file, "utf8");
        const declared = source.match(/router\.(get|patch|put|post|delete)\(/g) ?? [];
        assert.ok(declared.length > 0, file);
        assert.equal((source.match(/right: "MANAGE_GUILDS"/g) ?? []).length, declared.length, file);
        if (/router\.(patch|delete)\(/.test(source)) assert.match(source, /assertMirrorGuildEditable\(/, file);
    }
});

const handler = (router, method) => router.stack.find((layer) => layer.route?.stack.some((entry) => entry.method === method)).route.stack.at(-1).handle;

async function invoke(fn, { params, body, actor }) {
    let status = 200,
        result;
    const { Rights } = require("../../dist/util/util/Rights");
    await fn(
        { params, body, query: {}, headers: {}, user_id: actor, rights: new Rights("4") },
        {
            status(value) {
                status = value;
                return this;
            },
            json(value) {
                result = value;
                return this;
            },
            sendStatus(value) {
                status = value;
                return this;
            },
        },
    );
    return { status, body: result };
}

before(async () => {
    if (!enabled) return;
    assert.equal(new URL(process.env.DATABASE).pathname, `/${database}`);
    e = require("../../dist/database");
    db = await e.initDatabase();
    ({ Snowflake } = require("../../dist/util/util/Snowflake"));
    const { ConfigValue } = require("../../dist/util/config");
    const { Config } = require("../../dist/util/util/Config");
    const config = new ConfigValue();
    mock.method(Config, "get", () => config);
    mock.method(require("../../dist/util/util/ipc/Event"), "emitEvent", async (event) => emitted.push(event));
    list = handler(require("../../dist/api/routes/admin/guilds/#guild_id/soundboard-sounds/index").default, "get");
    const one = require("../../dist/api/routes/admin/guilds/#guild_id/soundboard-sounds/#sound_id").default;
    edit = handler(one, "patch");
    remove = handler(one, "delete");
});

after(async () => {
    if (!enabled) return;
    const { In } = require("typeorm");
    if (guilds.length) {
        await e.AuditLog.delete({ guild_id: In(guilds) });
        await e.Guild.delete({ id: In(guilds) });
    }
    if (users.length) await e.User.delete({ id: In(users) });
    mock.restoreAll();
    await db?.destroy();
});

test("staff edit and delete soundboard sounds with server audit entries and gateway events", { skip: !enabled }, async () => {
    const actor = await e.User.create({
        username: `admin soundboard actor ${Date.now()}`,
        discriminator: "0",
        bot: false,
        premium: false,
        premium_type: 0,
        verified: true,
        rights: "4",
        data: { hash: "disposable", valid_tokens_since: new Date() },
        created_at: new Date(),
        settings: await e.UserSettings.create({ locale: "en-US" }).save(),
    }).save();
    users.push(actor.id);
    const guild = await e.Guild.createGuild({ name: "Disposable admin soundboard test", owner_id: actor.id, source_guild_id: null, channels: [] });
    guilds.push(guild.id);
    const sound = await e.SoundboardSound.create({
        id: Snowflake.generate(),
        guild_id: guild.id,
        name: "honk",
        volume: 1,
        emoji_id: null,
        emoji_name: null,
        user_id: actor.id,
        available: true,
    }).save();

    const listed = await invoke(list, { params: { guild_id: guild.id }, actor: actor.id });
    assert.equal(listed.body.sounds.length, 1);
    assert.equal(listed.body.sounds[0].uploader.id, actor.id);
    assert.equal(listed.body.sounds[0].url, `/soundboard-sounds/${sound.id}`);

    const edited = await invoke(edit, { params: { guild_id: guild.id, sound_id: sound.id }, body: { name: "Honk honk", volume: 0.5, emoji_name: "🦆" }, actor: actor.id });
    assert.deepEqual(edited.body, { id: sound.id, name: "Honk honk", volume: 0.5, emoji_id: null, emoji_name: "🦆" });
    await assert.rejects(invoke(edit, { params: { guild_id: guild.id, sound_id: sound.id }, body: { name: " a " }, actor: actor.id }), /two characters/);
    assert.equal(await e.AuditLog.count({ where: { guild_id: guild.id, target_id: sound.id, action_type: 131 } }), 1);
    assert.ok(emitted.some((event) => event.event === "GUILD_SOUNDBOARD_SOUND_UPDATE" && event.guild_id === guild.id));

    assert.equal((await invoke(remove, { params: { guild_id: guild.id, sound_id: sound.id }, actor: actor.id })).status, 204);
    await assert.rejects(invoke(remove, { params: { guild_id: guild.id, sound_id: sound.id }, actor: actor.id }), /no sound/);
    assert.equal(await e.AuditLog.count({ where: { guild_id: guild.id, target_id: sound.id, action_type: 132 } }), 1);
    assert.ok(emitted.some((event) => event.event === "GUILD_SOUNDBOARD_SOUND_DELETE" && event.data.sound_id === sound.id));
});
