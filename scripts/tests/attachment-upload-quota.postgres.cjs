const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { randomBytes } = require("node:crypto");
const { test, before, after, mock } = require("node:test");
const enabled = process.env.UPLOAD_QUOTA_POSTGRES_TEST === "1";
const options = { skip: !enabled };
let e, db, handler, channel, guild, guildChannel, Permissions;
const users = [];
const policy = {
    cdn: { maxAttachmentSize: 1024 * 1024 * 1024, endpointPublic: "http://localhost" },
    limits: { message: { maxAttachments: 15 } },
};
before(async () => {
    if (!enabled) return;
    assert.equal(new URL(process.env.DATABASE).pathname, "/fosscord_codex_admin");
    assert.ok(["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE).hostname));
    e = require("../../dist/database");
    db = await e.initDatabase();
    const { ConfigValue } = require("../../dist/util/config");
    mock.method(require("../../dist/util/util/Config").Config, "get", () => new ConfigValue());
    mock.method(require("../../dist/util/util/ipc/Event"), "emitEvent", async () => undefined);
    for (let i = 0; i < 3; i++)
        users.push(
            await e.User.create({
                username: `Upload quota disposable ${i}`,
                discriminator: "0",
                bot: false,
                premium: false,
                premium_type: 0,
                verified: true,
                flags: 0,
                rights: "0",
                data: {},
                created_at: new Date(),
            }).save(),
        );
    channel = await e.Channel.create({ type: 1, created_at: new Date(), nsfw: false }).save();
    await e.Recipient.create({ channel_id: channel.id, user_id: users[0].id, closed: false }).save();
    await e.Recipient.create({ channel_id: channel.id, user_id: users[1].id, closed: false }).save();
    const permissionModule = require("../../dist/util/util/Permissions");
    Permissions = permissionModule.Permissions;
    guild = await e.Guild.createGuild({
        name: "Disposable upload permission guild",
        owner_id: users[0].id,
        source_guild_id: null,
    });
    guildChannel = await e.Channel.findOneOrFail({ where: { guild_id: guild.id, type: 0 } });
    await e.Role.update(
        { id: guild.id },
        {
            permissions: new Permissions(["VIEW_CHANNEL", "SEND_MESSAGES", "ATTACH_FILES"]).bitfield.toString(),
        },
    );
    await e.Member.create({
        id: users[1].id,
        guild_id: guild.id,
        joined_at: new Date(),
        deaf: false,
        mute: false,
        pending: false,
        flags: 0,
        bio: "",
        settings: {},
        roles: [e.Role.create({ id: guild.id })],
    }).save();
    const module = { exports: {} };
    const imports = {
        express: {
            Router: () => ({
                post: (_path, ...callbacks) => {
                    handler = callbacks.at(-1);
                },
                delete: () => undefined,
            }),
        },
        "@spacebar/database": e,
        "@spacebar/api/middlewares": { route: () => (_req, _res, next) => next() },
        "@spacebar/extensions": { Random: { getString: () => randomBytes(64).toString("hex") } },
        "@spacebar/util": {
            Config: { get: () => policy },
            Permissions,
            getPermission: permissionModule.getPermission,
        },
    };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/routes/channels/#channel_id/attachments.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) => (name in imports ? imports[name] : require(name)),
        },
    );
});
after(async () => {
    if (!enabled) return;
    mock.restoreAll();
    if (guild) {
        await e.AuditLog.delete({ guild_id: guild.id });
        await e.Guild.delete({ id: guild.id });
    }
    if (channel) await e.Channel.delete({ id: channel.id });
    for (const user of users) {
        await e.CloudAttachment.delete({ userId: user.id });
        await e.UserSettingsProtos.delete({ user_id: user.id });
        await e.User.delete({ id: user.id });
    }
    await db?.destroy();
});
async function invoke(files, user = users[1], target = channel) {
    const result = { status: 200 };
    const response = {
        status: (value) => {
            result.status = value;
            return response;
        },
        json: (value) => {
            result.body = value;
            return response;
        },
        send: (value) => {
            result.body = value;
            return response;
        },
    };
    await handler({ user, user_id: user.id, body: { files }, params: { channel_id: target.id } }, response);
    return result;
}
async function seed(count, bytes = 1, completed = false) {
    await e.CloudAttachment.delete({ userId: users[1].id });
    await e.CloudAttachment.save(
        Array.from({ length: count }, (_, index) =>
            e.CloudAttachment.create({
                userId: users[1].id,
                channelId: channel.id,
                uploadFilename: `${channel.id}/synthetic-${index}/0/file.bin`,
                userAttachmentId: "0",
                userFilename: "file.bin",
                userFileSize: bytes,
                ...(completed ? { size: bytes } : {}),
            }),
        ),
    );
}
const file = (bytes = 1, id = "0") => ({ filename: "file.bin", id, file_size: bytes });
test("upload slot API validates size/path declarations before storing any rows", options, async () => {
    await seed(0);
    for (const files of [
        [file(-1)],
        [file(0.5)],
        [file(Number.POSITIVE_INFINITY)],
        [file(policy.cdn.maxAttachmentSize + 1)],
        [],
        Array.from({ length: 16 }, (_, index) => file(1, String(index))),
        [{ ...file(), id: "../escape" }],
        [{ ...file(), filename: ".." }],
        [{ ...file(), filename: "/" }],
    ]) {
        let status;
        try {
            status = (await invoke(files)).status;
        } catch (error) {
            status = error.code;
        }
        assert.equal(status, 400);
    }
    assert.equal(await e.CloudAttachment.countBy({ userId: users[1].id }), 0);
});
test("a nonparticipant cannot reserve uploads into a known private DM", options, async () => {
    await seed(0);
    assert.equal((await invoke([file()], users[2])).status, 403);
    assert.equal(await e.CloudAttachment.countBy({ userId: users[2].id }), 0);
});
test("guild upload authorization honors attachment and view-channel overwrites", options, async () => {
    await seed(0);
    for (const deny of [Permissions.FLAGS.ATTACH_FILES, Permissions.FLAGS.VIEW_CHANNEL]) {
        await e.Channel.update(
            { id: guildChannel.id },
            {
                permission_overwrites: [{ id: users[1].id, type: 1, allow: "0", deny: deny.toString() }],
            },
        );
        assert.equal((await invoke([file()], users[1], guildChannel)).status, 403);
        assert.equal(await e.CloudAttachment.countBy({ userId: users[1].id }), 0);
    }
    await e.Channel.update({ id: guildChannel.id }, { permission_overwrites: [] });
    assert.equal((await invoke([file()], users[1], guildChannel)).status, 200);
});
test("concurrent reservations cannot race past the same user's pending slot limit", options, async () => {
    await seed(31);
    const results = await Promise.allSettled([invoke([file(1, "1")]), invoke([file(1, "2")])]);
    assert.equal(results.filter((result) => result.status === "fulfilled" && result.value.status === 200).length, 1);
    assert.equal(results.filter((result) => result.status === "rejected" && result.reason.code === 429).length, 1);
    assert.equal(await e.CloudAttachment.countBy({ userId: users[1].id }), 32);
});
test("pending declared bytes are reserved atomically before body upload", options, async () => {
    await seed(1, 512 * 1024 * 1024);
    await assert.rejects(invoke([file(512 * 1024 * 1024 + 1)]), (error) => error.code === 429);
    assert.equal(await e.CloudAttachment.countBy({ userId: users[1].id }), 1);
});
test("uploaded-but-unused slots remain subject to finite retained count and bytes", options, async () => {
    await seed(512, 1, true);
    await assert.rejects(invoke([file()]), (error) => error.code === 429);
    assert.equal(await e.CloudAttachment.countBy({ userId: users[1].id }), 512);
    await seed(2, 1024 * 1024 * 1024, true);
    await assert.rejects(invoke([file()]), (error) => error.code === 429);
    assert.equal(await e.CloudAttachment.countBy({ userId: users[1].id }), 2);
    await seed(1, 4, true);
    const normal = await invoke([file(0)]);
    assert.equal(normal.status, 200);
    assert.equal(normal.body.attachments.length, 1);
    assert.equal(await e.CloudAttachment.countBy({ userId: users[1].id }), 2);
});
