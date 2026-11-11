const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const code = (() => {
    const source = fs.readFileSync("src/gateway/listener/listener.ts", "utf8");
    const parsed = ts.createSourceFile("listener.ts", source, ts.ScriptTarget.ES2022, true);
    const declaration = parsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "consumeEvent");
    return ts.transpileModule(`${declaration.getText(parsed)}; consumeEvent`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
})();

function consumer() {
    const sent = [];
    const consume = vm.runInNewContext(code, {
        Send: async (_, payload) => sent.push(payload.t),
        consume() {},
        eventGuild: () => "guild",
        canSee: (_, guild, channel) => guild === "guild" && channel === "open-stage",
        OPCODES: { Dispatch: 0 },
        MemberListEvents: new Set(),
        console,
    });
    const socket = { user_id: "member", permissions: { guild: { has: () => true } }, recentTransactions: [], sequence: 0, member_lists: {} };
    return { sent, send: (event, data) => consume.call(socket, { event, guild_id: "guild", data: { guild_id: "guild", ...data } }) };
}

const EVENTS = [
    ["GUILD_SCHEDULED_EVENT_CREATE", { name: "layoffs planning" }],
    ["GUILD_SCHEDULED_EVENT_UPDATE", { name: "layoffs planning" }],
    ["GUILD_SCHEDULED_EVENT_DELETE", { name: "layoffs planning" }],
    ["STAGE_INSTANCE_CREATE", { topic: "secret topic" }],
    ["STAGE_INSTANCE_UPDATE", { topic: "secret topic" }],
    ["STAGE_INSTANCE_DELETE", { topic: "secret topic" }],
];

test("scheduled event and stage events in a channel the member can't see aren't dispatched", async () => {
    const { sent, send } = consumer();
    for (const [event, data] of EVENTS) await send(event, { ...data, channel_id: "hidden-stage" });
    assert.deepEqual(sent, []);
});

test("scheduled event and stage events in a visible channel and external events still arrive", async () => {
    const { sent, send } = consumer();
    for (const [event, data] of EVENTS) await send(event, { ...data, channel_id: "open-stage" });
    await send("GUILD_SCHEDULED_EVENT_CREATE", { name: "meetup", channel_id: null });
    assert.deepEqual(sent, [...EVENTS.map(([event]) => event), "GUILD_SCHEDULED_EVENT_CREATE"]);
});

test("READY only lists scheduled events and stage instances in channels the member can view", () => {
    const source = fs.readFileSync("src/gateway/opcodes/Identify.ts", "utf8");
    assert.match(source, /guild_scheduled_events: \(scheduledEventsByGuild\.get\(member\.guild_id\) \?\? \[\]\)\s*\.filter\(\(e\) => canViewChannel\(e\.channel_id\)\)/);
    assert.match(source, /stage_instances: \(stageInstancesByGuild\.get\(member\.guild_id\) \?\? \[\]\)\.filter\(\(i\) => canViewChannel\(i\.channel_id\)\)/);
    assert.match(source, /channel: \{ overwrites: channel\.permission_overwrites \?\? \[\] \},\s*\}\)\.has\("VIEW_CHANNEL"\)/);
});
