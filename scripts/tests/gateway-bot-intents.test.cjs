const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(relative, imports = {}) {
    const source = fs.readFileSync(path.join(__dirname, "../../", relative), "utf8");
    const module = { exports: {} };
    const code = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(code, {
        module,
        exports: module.exports,
        require: (id) => {
            if (id in imports) return imports[id];
            throw new Error(`Unexpected dependency ${id}`);
        },
        process: { env: {} },
        Buffer,
        console,
    });
    return module.exports;
}

const { BitField } = load("src/util/util/BitField.ts");
const { Intents } = load("src/util/util/Intents.ts", { "./BitField": { BitField } });
let filtering = {};
if (fs.existsSync(path.join(__dirname, "../../src/gateway/util/GatewayIntents.ts"))) {
    filtering = load("src/gateway/util/GatewayIntents.ts", { "@spacebar/util": { Intents } });
}

function harness(bits = 0n, { isBot = true, disconnected = false, pending = false } = {}) {
    const sent = [],
        remembered = [],
        buffered = [];
    const socket = {
        isBot,
        user_id: "bot",
        intents: new Intents(bits),
        encoding: "json",
        readyState: disconnected ? 3 : 1,
        pendingDispatches: pending ? [] : undefined,
        send: (data, done) => {
            sent.push(JSON.parse(data));
            done();
        },
        close() {},
    };
    const { Send } = load("src/gateway/util/Send.ts", {
        "node:fs/promises": {},
        "node:path": {},
        "./Etf": require("../../src/gateway/util/Etf.ts"),
        "@spacebar/util": { JSONReplacer: (_, value) => value, JSONStringify: JSON.stringify },
        "./GatewayIntents": filtering,
        "./SessionResume": {
            boundedDispatchPush: (queue, data) => {
                queue.push(data);
                return true;
            },
            resolveSocket: (value) => value,
            rememberDispatch: (_, data) => remembered.push(data),
            notePayloadSize() {},
            bufferForResume: (_, data) => {
                buffered.push(data);
                return true;
            },
        },
    });
    return {
        send: (event, d = {}, op = 0, guildId) => Send(socket, { op, t: event, d, s: 1 }, guildId),
        Send,
        sent,
        remembered,
        buffered,
        socket,
    };
}

for (const [event, d] of [
    ["MESSAGE_CREATE", { guild_id: "guild", content: "private" }],
    ["PRESENCE_UPDATE", { guild_id: "guild", user: { id: "other" } }],
]) {
    test(`zero-intent bot does not receive authorized ${event}`, async () => {
        const h = harness();
        await h.send(event, d);
        assert.equal(h.sent.length, 0);
        assert.equal(h.remembered.length, 0);
    });
}

test("guild and DM messages require their corresponding intent", async () => {
    for (const [bits, guildExpected, dmExpected] of [
        [0n, 0, 0],
        [1n << 9n, 1, 0],
        [1n << 12n, 0, 1],
    ]) {
        const guild = harness(bits),
            dm = harness(bits);
        await guild.send("MESSAGE_CREATE", { guild_id: "guild" });
        await dm.send("MESSAGE_CREATE", { channel_id: "dm" });
        assert.equal(guild.sent.length, guildExpected);
        assert.equal(dm.sent.length, dmExpected);
    }
});

test("human clients retain their dispatches without bot intents", async () => {
    const h = harness(0n, { isBot: false });
    await h.send("MESSAGE_CREATE", { guild_id: "guild" });
    await h.send("PRESENCE_UPDATE", { user: { id: "other" } });
    assert.equal(h.sent.length, 2);
});

test("control and no-intent dispatch events pass through", async () => {
    const h = harness();
    for (const event of ["READY", "RESUMED", "INTERACTION_CREATE", "USER_UPDATE", "INSTANCE_CUSTOM_EVENT"]) await h.send(event);
    await h.send(undefined, {}, 11);
    assert.equal(h.sent.length, 6);
});

test("filtered events enter neither pending nor disconnected replay buffers", async () => {
    for (const options of [{ pending: true }, { disconnected: true }]) {
        const h = harness(0n, options);
        await h.send("MESSAGE_CREATE", { guild_id: "guild" });
        assert.equal(h.socket.pendingDispatches?.length ?? 0, 0);
        assert.equal(h.buffered.length, 0);
        assert.equal(h.remembered.length, 0);
    }
});

test("own guild member update passes without MEMBERS while other member updates do not", async () => {
    const h = harness();
    await h.send("GUILD_MEMBER_UPDATE", { guild_id: "guild", user: { id: "other" } });
    await h.send("GUILD_MEMBER_UPDATE", { guild_id: "guild", user: { id: "bot" } });
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].d.user.id, "bot");
});

test("thread membership without MEMBERS exposes only the bot's own change", async () => {
    const h = harness(1n);
    const data = {
        id: "thread",
        guild_id: "guild",
        member_count: 2,
        added_members: [{ user_id: "bot" }, { user_id: "other" }],
        removed_member_ids: ["third"],
    };
    await h.send("THREAD_MEMBERS_UPDATE", data);
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.sent[0].d.added_members, [{ user_id: "bot" }]);
    assert.deepEqual(h.sent[0].d.removed_member_ids, []);
    assert.equal(data.added_members.length, 2);
    await h.send("THREAD_MEMBERS_UPDATE", { ...data, added_members: [{ user_id: "other" }] });
    assert.equal(h.sent.length, 1);
});

test("thread membership with MEMBERS retains all changes", async () => {
    const h = harness(1n << 1n);
    const data = {
        id: "thread",
        guild_id: "guild",
        added_members: [{ user_id: "other" }],
        removed_member_ids: ["third"],
    };
    await h.send("THREAD_MEMBERS_UPDATE", data);
    assert.equal(h.sent.length, 1);
    assert.deepEqual(h.sent[0].d, data);
});

test("modern standard intent events and invite aliases use their designated bits", async () => {
    for (const [event, bit] of [
        ["INVITE_CREATE", 6n],
        ["INVITE_DELETE", 6n],
        ["VOICE_CHANNEL_STATUS_UPDATE", 0n],
        ["GUILD_SOUNDBOARD_SOUND_CREATE", 3n],
        ["AUTO_MODERATION_ACTION_EXECUTION", 21n],
        ["MESSAGE_POLL_VOTE_ADD", 24n],
        ["GUILD_SCHEDULED_EVENT_CREATE", 16n],
    ]) {
        const absent = harness(),
            present = harness(1n << bit);
        await absent.send(event, { guild_id: "guild" });
        await present.send(event, { guild_id: "guild" });
        assert.equal(absent.sent.length, 0, event);
        assert.equal(present.sent.length, 1, event);
    }
});

test("guild context from listener cannot be mistaken for a DM when payload omits guild_id", async () => {
    const dm = harness(1n << 12n),
        guild = harness(1n << 9n);
    await dm.send("MESSAGE_DELETE", { channel_id: "channel" }, 0, "guild");
    await guild.send("MESSAGE_DELETE", { channel_id: "channel" }, 0, "guild");
    assert.equal(dm.sent.length, 0);
    assert.equal(guild.sent.length, 1);
});

test("identify preserves explicit zero and defaults omitted bot intents to zero", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../src/gateway/opcodes/Identify.ts"), "utf8");
    const parsed = ts.createSourceFile("Identify.ts", source, ts.ScriptTarget.ES2022, true);
    let branch;
    const visit = (statement) => {
        if (ts.isIfStatement(statement) && statement.thenStatement.getText(parsed).startsWith("identify.intents =")) branch = statement.getText(parsed);
        else ts.forEachChild(statement, visit);
    };
    visit(parsed);
    assert.ok(branch);
    for (const [bot, initial, expected] of [
        [true, 0n, 0n],
        [true, undefined, 0n],
        [false, 0n, 0n],
        [false, undefined, 0b11011111111111111111111111111111111n],
        [true, 512n, 512n],
    ]) {
        const identify = { intents: initial };
        vm.runInNewContext(branch, { identify, user: { bot } });
        assert.equal(identify.intents, expected);
    }
});

test("actual authorized listener consumer sends only requested message and presence events", async () => {
    const source = fs.readFileSync(path.join(__dirname, "../../src/gateway/listener/listener.ts"), "utf8");
    const parsed = ts.createSourceFile("listener.ts", source, ts.ScriptTarget.ES2022, true);
    const declaration = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "consumeEvent");
    assert.ok(declaration);
    const code = ts.transpileModule(`${declaration.getText(parsed)}; consumeEvent`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    for (const [bits, expected] of [
        [0n, 0],
        [(1n << 9n) | (1n << 8n), 2],
    ]) {
        const h = harness(bits);
        Object.assign(h.socket, {
            permissions: { guild: { has: () => true } },
            recentTransactions: [],
            sequence: 0,
            member_lists: {},
        });
        const consume = vm.runInNewContext(code, {
            Send: h.Send,
            consume() {},
            eventGuild: () => "guild",
            canSee: (_, guild, channel) => guild === "guild" && channel === "channel",
            OPCODES: { Dispatch: 0 },
            MemberListEvents: new Set(),
            console,
        });
        await consume.call(h.socket, {
            event: "MESSAGE_CREATE",
            channel_id: "channel",
            data: { channel_id: "channel", content: "private" },
        });
        await consume.call(h.socket, {
            event: "PRESENCE_UPDATE",
            guild_id: "guild",
            data: { guild_id: "guild", user: { id: "other" } },
        });
        assert.equal(h.sent.length, expected);
    }
});

test("all mapped guild and DM events require their exact subscribed bit", async () => {
    for (const [mapping, guild_id] of [
        [Intents.GUILD_INTENT_TO_EVENTS_MAP, "guild"],
        [Intents.DM_INTENT_TO_EVENTS_MAP, undefined],
        [Intents.INTENT_TO_EVENTS_MAP, "guild"],
    ]) {
        for (const [bit, events] of Object.entries(mapping)) {
            for (const name of events) {
                const event = name.trim();
                if (event === "THREAD_MEMBERS_UPDATE") continue;
                const data = { guild_id, user: { id: "other" } };
                const absent = harness(),
                    present = harness(1n << BigInt(bit));
                await absent.send(event, data);
                await present.send(event, data);
                assert.equal(absent.sent.length, 0, `${event} unsubscribed`);
                assert.equal(present.sent.length, 1, `${event} subscribed`);
            }
        }
    }
});

test("privileged bot intents require explicit application approval and limited approval stops at 100 guilds", () => {
    const { botIntentsAllowed } = filtering;
    for (const [intent, full, limited] of [
        [1n << 8n, 1 << 12, 1 << 13],
        [1n << 1n, 1 << 14, 1 << 15],
        [1n << 15n, 1 << 18, 1 << 19],
    ]) {
        assert.equal(botIntentsAllowed(new Intents(intent), 0, 1), false);
        assert.equal(botIntentsAllowed(new Intents(intent), limited, 99), true);
        assert.equal(botIntentsAllowed(new Intents(intent), limited, 100), false);
        assert.equal(botIntentsAllowed(new Intents(intent), full, 1000), true);
    }
});

test("message content projection strips nested content without changing the source", async () => {
    const h = harness(1n << 9n);
    const message = {
        guild_id: "guild",
        author: { id: "other" },
        content: "private",
        attachments: [{ id: "file" }],
        embeds: [{}],
        components: [{}],
        poll: {},
        referenced_message: { author: { id: "other" }, content: "nested" },
        message_snapshots: [{ message: { content: "snapshot" } }],
    };
    await h.send("MESSAGE_CREATE", message);
    assert.equal(h.sent[0].d.content, "");
    assert.deepEqual(h.sent[0].d.attachments, []);
    assert.equal(h.sent[0].d.referenced_message.content, "");
    assert.equal(h.sent[0].d.message_snapshots[0].message.content, "");
    assert.equal(message.content, "private");
    for (const allowed of [
        { ...message, author: { id: "bot" } },
        { ...message, mentions: [{ id: "bot" }] },
    ]) {
        await h.send("MESSAGE_CREATE", allowed);
        assert.equal(h.sent.at(-1).d.content, "private");
    }
});

test("initial guild projection follows presence voice and member intents", async () => {
    const h = harness(1n);
    await h.send("GUILD_CREATE", { presences: [{ user: { id: "other" } }], voice_states: [{ user_id: "other" }], members: [{ user: { id: "other" } }, { user: { id: "bot" } }] });
    assert.deepEqual(h.sent[0].d.presences, []);
    assert.deepEqual(h.sent[0].d.voice_states, []);
    assert.deepEqual(h.sent[0].d.members, [{ user: { id: "bot" } }]);
});

test("user-only supplemental ready never reaches bot queues but human clients retain it", async () => {
    const bot = harness(0n, { pending: true });
    await bot.send("READY_SUPPLEMENTAL", { merged_presences: { guilds: [[{ user_id: "other" }]] } });
    assert.equal(bot.sent.length, 0);
    assert.equal(bot.socket.pendingDispatches.length, 0);
    const human = harness(0n, { isBot: false });
    await human.send("READY_SUPPLEMENTAL", { guilds: [] });
    assert.equal(human.sent.length, 1);
});
