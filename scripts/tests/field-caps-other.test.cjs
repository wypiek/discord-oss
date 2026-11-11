const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.join(__dirname, "..", "..");
const { assertMaxLength, assertMaxLengths, GIF_QUERY_LIMITS } = require(path.join(root, "dist/api/util/utility/inputCaps.js"));
const { cleanAttachmentFilename, declaredAttachmentFilename, MAX_ATTACHMENT_FILENAME } = require(path.join(root, "dist/util/util/AttachmentFilename.js"));
const caps = require(path.join(root, "dist/util/util/federation/Caps.js"));
const { describeHostAnswer } = require(path.join(root, "dist/util/util/federation/HostErrors.js"));

const fieldErrors = (thrown) => thrown.errors ?? thrown.body?.errors ?? thrown;

function loadStaffAudit() {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(path.join(root, "src/api/util/utility/staffAudit.ts"), "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            require(name) {
                if (name === "@spacebar/database") return { AuditLog: class {} };
                if (name === "@spacebar/schemas") return { AuditLogEvents: new Proxy({}, { get: () => 0 }) };
                if (name === "./adminTargets") return { assertCanActOnUser() {} };
                if (name === "@spacebar/util") return { SNOWFLAKE: /^\d{1,20}$/ };
                return {};
            },
        },
    );
    return module.exports;
}

test("assertMaxLength accepts values at the limit and rejects longer ones", () => {
    assert.doesNotThrow(() => assertMaxLength("q", "x".repeat(200), 200));
    assert.doesNotThrow(() => assertMaxLength("q", undefined, 200));
    const thrown = (() => {
        try {
            assertMaxLength("q", "x".repeat(201), 200);
        } catch (error) {
            return error;
        }
    })();
    assert.ok(thrown);
    assert.match(JSON.stringify(fieldErrors(thrown)), /BASE_TYPE_BAD_LENGTH/);
});

test("assertMaxLength rejects a repeated query parameter", () => {
    assert.throws(() => assertMaxLength("q", ["a", "b"], 200));
    assert.doesNotThrow(() => assertMaxLength("q", ["a", "b"], 200, 2));
    assert.throws(() => assertMaxLength("q", ["a", "x".repeat(201)], 200, 2));
});

test("assertMaxLengths checks every listed query field", () => {
    assert.doesNotThrow(() => assertMaxLengths({ q: "cats", locale: "en-US" }, GIF_QUERY_LIMITS));
    assert.doesNotThrow(() => assertMaxLengths(undefined, GIF_QUERY_LIMITS));
    assert.throws(() => assertMaxLengths({ q: "x".repeat(GIF_QUERY_LIMITS.q + 1) }, GIF_QUERY_LIMITS));
    assert.throws(() => assertMaxLengths({ locale: "x".repeat(GIF_QUERY_LIMITS.locale + 1) }, GIF_QUERY_LIMITS));
    assert.doesNotThrow(() => assertMaxLengths({ unrelated: "x".repeat(100000) }, GIF_QUERY_LIMITS));
});

test("cleanAttachmentFilename strips unsafe characters and caps the length", () => {
    assert.equal(cleanAttachmentFilename("my file (1).png"), "my_file_1.png");
    assert.equal(cleanAttachmentFilename("../.."), "....");
    assert.equal(cleanAttachmentFilename(".."), "file");
    assert.equal(cleanAttachmentFilename("日本"), "file");
    const long = cleanAttachmentFilename(`${"a".repeat(400)}.tar.gz`);
    assert.equal(long.length, MAX_ATTACHMENT_FILENAME);
    assert.ok(long.endsWith(".gz"));
});

test("declaredAttachmentFilename only keeps safe names up to 255 characters", () => {
    assert.equal(declaredAttachmentFilename("photo.png"), "photo.png");
    assert.equal(declaredAttachmentFilename("x".repeat(255)), "x".repeat(255));
    assert.equal(declaredAttachmentFilename("x".repeat(256)), undefined);
    assert.equal(declaredAttachmentFilename("a/b.png"), undefined);
    assert.equal(declaredAttachmentFilename("a\\b.png"), undefined);
    assert.equal(declaredAttachmentFilename("a?b.png"), undefined);
    assert.equal(declaredAttachmentFilename("a\nb.png"), undefined);
    assert.equal(declaredAttachmentFilename("a\u007fb.png"), undefined);
    assert.equal(declaredAttachmentFilename(".."), undefined);
    assert.equal(declaredAttachmentFilename(""), undefined);
    assert.equal(declaredAttachmentFilename(42), undefined);
});

test("capRemoteUser cuts remote profile fields to local limits", () => {
    const user = caps.capRemoteUser({
        id: "1",
        global_name: "g".repeat(100),
        pronouns: "p".repeat(100),
        bio: "b".repeat(5000),
        avatar: "a".repeat(500),
        primary_guild: { tag: "t".repeat(50) },
    });
    assert.equal(user.global_name.length, 32);
    assert.equal(user.pronouns.length, 40);
    assert.equal(user.bio.length, 190);
    assert.equal(user.avatar.length, 128);
    assert.equal(user.primary_guild.tag.length, 32);
    assert.equal(user.id, "1");
});

test("capRemoteGuild caps names, lists and nested entries", () => {
    const guild = caps.capRemoteGuild({
        name: "n".repeat(500),
        description: "d".repeat(1000),
        features: Array.from({ length: 300 }, () => "f".repeat(100)),
        roles: Array.from({ length: 1500 }, () => ({ name: "r".repeat(200), colors: { primary_color: 1, evil: "x" } })),
        emojis: [{ name: "e".repeat(100) }],
        stickers: [{ name: "s".repeat(100), description: "d".repeat(500) }],
        channels: [{ name: "c".repeat(300), topic: "t".repeat(9000), available_tags: Array.from({ length: 40 }, () => ({ name: "x".repeat(50) })) }],
        welcome_screen: { description: "w".repeat(500), welcome_channels: Array.from({ length: 9 }, () => ({ description: "x".repeat(100) })) },
        profile: { deep: "x".repeat(10000) },
    });
    assert.equal(guild.name.length, 100);
    assert.equal(guild.description.length, 300);
    assert.equal(guild.features.length, caps.REMOTE_LIST_LIMITS.features);
    assert.equal(guild.features[0].length, 64);
    assert.equal(guild.roles.length, caps.REMOTE_LIST_LIMITS.roles);
    assert.equal(guild.roles[0].name.length, 100);
    assert.deepEqual(guild.roles[0].colors, { primary_color: 1 });
    assert.equal(guild.emojis[0].name.length, 32);
    assert.equal(guild.stickers[0].name.length, 30);
    assert.equal(guild.stickers[0].description.length, 100);
    assert.equal(guild.channels[0].name.length, 100);
    assert.equal(guild.channels[0].topic.length, 4096);
    assert.equal(guild.channels[0].available_tags.length, 20);
    assert.equal(guild.channels[0].available_tags[0].name.length, 20);
    assert.equal(guild.welcome_screen.description.length, 140);
    assert.equal(guild.welcome_screen.welcome_channels.length, 5);
    assert.equal(guild.welcome_screen.welcome_channels[0].description.length, 50);
    assert.equal(guild.profile.deep.length, 2048);
});

test("capRemoteDeep bounds depth, keys and array sizes", () => {
    let nested = { leaf: 1 };
    for (let i = 0; i < 20; i++) nested = { child: nested };
    let depth = 0;
    for (let node = caps.capRemoteDeep(nested); node && typeof node === "object"; node = node.child) depth++;
    assert.ok(depth <= 9);
    const wide = caps.capRemoteDeep(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`${i}${"k".repeat(100)}`, i])));
    assert.equal(Object.keys(wide).length, 100);
    assert.ok(Object.keys(wide).every((key) => key.length <= 64));
    assert.equal(caps.capRemoteDeep(Array.from({ length: 500 }, () => 1)).length, 100);
});

test("capRemoteEvent caps messages, presences and members by event", () => {
    const message = caps.capRemoteEvent(
        "MESSAGE_CREATE",
        {
            content: "c".repeat(10000),
            author: { bio: "b".repeat(1000) },
            embeds: Array.from({ length: 30 }, () => ({ title: "t".repeat(500), fields: Array.from({ length: 40 }, () => ({ name: "n".repeat(500), value: "v".repeat(2000) })) })),
            attachments: Array.from({ length: 40 }, () => ({ filename: "f".repeat(1000) })),
            mentions: Array.from({ length: 400 }, () => ({})),
        },
        4000,
    );
    assert.equal(message.content.length, 4000);
    assert.equal(message.author.bio.length, 190);
    assert.equal(message.embeds.length, 10);
    assert.equal(message.embeds[0].title.length, 256);
    assert.equal(message.embeds[0].fields.length, 25);
    assert.equal(message.embeds[0].fields[0].value.length, 1024);
    assert.equal(message.attachments.length, 25);
    assert.equal(message.attachments[0].filename.length, 255);
    assert.equal(message.mentions.length, 250);

    const presence = caps.capRemoteEvent(
        "PRESENCE_UPDATE",
        { activities: Array.from({ length: 20 }, () => ({ name: "n".repeat(500), buttons: ["b".repeat(100), "c", "d"] })) },
        4000,
    );
    assert.equal(presence.activities.length, 10);
    assert.equal(presence.activities[0].name.length, 128);
    assert.equal(presence.activities[0].buttons.length, 2);
    assert.equal(presence.activities[0].buttons[0].length, 32);

    const member = caps.capRemoteEvent("GUILD_MEMBER_ADD", { nick: "n".repeat(100), user: { global_name: "g".repeat(100) } }, 4000);
    assert.equal(member.nick.length, 32);
    assert.equal(member.user.global_name.length, 32);
});

test("capRemoteInvite caps the guild, channel and inviter in an invite preview", () => {
    const invite = caps.capRemoteInvite({ guild: { name: "g".repeat(300) }, channel: { name: "c".repeat(300) }, inviter: { global_name: "i".repeat(100) } });
    assert.equal(invite.guild.name.length, 100);
    assert.equal(invite.channel.name.length, 100);
    assert.equal(invite.inviter.global_name.length, 32);
});

test("describeHostAnswer cuts remote error strings to 500 characters", () => {
    const coded = describeHostAnswer("remote.example", 400, { code: "c".repeat(200), error: "e".repeat(5000) }, "local.example");
    assert.ok(coded.message.length <= 500);
    assert.ok(String(coded.code).length <= 64);
    const plain = describeHostAnswer("remote.example", 400, { message: "m".repeat(5000) }, "local.example");
    assert.ok(plain.message.length <= 500);
});

test("summarizeBody caps keys and array items but still redacts long secret keys", () => {
    const { summarizeBody } = loadStaffAudit();
    const changes = summarizeBody({ [`${"k".repeat(100)}`]: "v", [`${"x".repeat(70)}password`]: "hunter2", list: ["y".repeat(500), 1] });
    assert.equal(changes[0].key.length, 64);
    assert.equal(changes[1].key.length, 64);
    assert.equal(changes[1].new_value, "[redacted]");
    assert.equal(changes[2].new_value[0].length, 201);
    assert.equal(changes[2].new_value[1], 1);
});
