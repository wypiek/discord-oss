const assert = require("node:assert/strict");
const fs = require("node:fs");
const { test, before, after, mock } = require("node:test");

const database = process.env.ADMIN_GUILD_MODERATION_TEST_DATABASE;
const enabled = Boolean(database);
const routes = [
    "src/api/routes/admin/guilds/#guild_id/emojis/index.ts",
    "src/api/routes/admin/guilds/#guild_id/emojis/#emoji_id.ts",
    "src/api/routes/admin/guilds/#guild_id/stickers/index.ts",
    "src/api/routes/admin/guilds/#guild_id/stickers/#sticker_id.ts",
];
let e, db, Snowflake;
const handlers = {};
const users = [];
const guilds = [];
const emitted = [];

test("emoji and sticker routes need the server right and refuse mirrored servers", () => {
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
    const load = (path) => require(`../../dist/api/routes/admin/guilds/#guild_id/${path}`).default;
    handlers.listEmojis = handler(load("emojis/index"), "get");
    handlers.renameEmoji = handler(load("emojis/#emoji_id"), "patch");
    handlers.deleteEmoji = handler(load("emojis/#emoji_id"), "delete");
    handlers.listStickers = handler(load("stickers/index"), "get");
    handlers.editSticker = handler(load("stickers/#sticker_id"), "patch");
    handlers.deleteSticker = handler(load("stickers/#sticker_id"), "delete");
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

test("staff rename and delete emoji and stickers with server audit entries and gateway updates", { skip: !enabled }, async () => {
    const actor = await e.User.create({
        username: `admin expressions actor ${Date.now()}`,
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
    const guild = await e.Guild.createGuild({ name: "Disposable admin expression test", owner_id: actor.id, source_guild_id: null, channels: [] });
    guilds.push(guild.id);
    const emoji = await e.Emoji.create({
        id: Snowflake.generate(),
        guild_id: guild.id,
        user_id: actor.id,
        name: "wave",
        animated: false,
        available: true,
        managed: false,
        require_colons: true,
        roles: [],
    }).save();
    const managed = await e.Emoji.create({
        id: Snowflake.generate(),
        guild_id: guild.id,
        name: "integration",
        animated: false,
        available: true,
        managed: true,
        require_colons: true,
        roles: [],
    }).save();
    const sticker = await e.Sticker.create({
        id: Snowflake.generate(),
        guild_id: guild.id,
        user_id: actor.id,
        name: "Cat",
        tags: "cat",
        type: 2,
        format_type: 1,
        available: true,
    }).save();

    const emojis = await invoke(handlers.listEmojis, { params: { guild_id: guild.id }, actor: actor.id });
    assert.deepEqual(emojis.body.emojis.map((entry) => entry.name).sort(), ["integration", "wave"]);
    assert.equal(emojis.body.emojis.find((entry) => entry.id === emoji.id).uploader.id, actor.id);

    const renamed = await invoke(handlers.renameEmoji, { params: { guild_id: guild.id, emoji_id: emoji.id }, body: { name: "wave_hello" }, actor: actor.id });
    assert.equal(renamed.body.name, "wave_hello");
    await assert.rejects(invoke(handlers.renameEmoji, { params: { guild_id: guild.id, emoji_id: managed.id }, body: { name: "nope" }, actor: actor.id }), /integration/);
    assert.equal((await invoke(handlers.deleteEmoji, { params: { guild_id: guild.id, emoji_id: emoji.id }, actor: actor.id })).status, 204);
    assert.equal(await e.Emoji.count({ where: { guild_id: guild.id } }), 1);
    assert.equal(await e.AuditLog.count({ where: { guild_id: guild.id, target_id: emoji.id, action_type: 61 } }), 1);
    assert.equal(await e.AuditLog.count({ where: { guild_id: guild.id, target_id: emoji.id, action_type: 62 } }), 1);
    assert.ok(emitted.some((event) => event.event === "GUILD_EMOJIS_UPDATE" && event.guild_id === guild.id));

    const stickers = await invoke(handlers.listStickers, { params: { guild_id: guild.id }, actor: actor.id });
    assert.equal(stickers.body.stickers[0].url, `/stickers/${sticker.id}.png`);
    const edited = await invoke(handlers.editSticker, {
        params: { guild_id: guild.id, sticker_id: sticker.id },
        body: { name: "Kitten", description: "", tags: "🐱" },
        actor: actor.id,
    });
    assert.deepEqual(edited.body, { id: sticker.id, name: "Kitten", description: null, tags: "🐱" });
    await assert.rejects(invoke(handlers.editSticker, { params: { guild_id: guild.id, sticker_id: sticker.id }, body: { tags: "  " }, actor: actor.id }), /at least one tag/);
    assert.equal((await invoke(handlers.deleteSticker, { params: { guild_id: guild.id, sticker_id: sticker.id }, actor: actor.id })).status, 204);
    await assert.rejects(invoke(handlers.deleteSticker, { params: { guild_id: guild.id, sticker_id: sticker.id }, actor: actor.id }), /no sticker/);
    assert.equal(await e.AuditLog.count({ where: { guild_id: guild.id, target_id: sticker.id, action_type: 91 } }), 1);
    assert.equal(await e.AuditLog.count({ where: { guild_id: guild.id, target_id: sticker.id, action_type: 92 } }), 1);
    assert.ok(emitted.some((event) => event.event === "GUILD_STICKERS_UPDATE" && event.guild_id === guild.id));
});
