import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey } from "node:crypto";

const require = createRequire(import.meta.url);
const { Client } = require("pg");
const jwt = require("jsonwebtoken");

const root = new URL("../../", import.meta.url);
const env = Object.fromEntries(
    readFileSync(new URL(".env", root), "utf8")
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const count = (name, fallback) => Number(process.env[name] || fallback);
const sizes = {
    members: count("MEMBERS", 3000),
    roles: count("ROLES", 60),
    channels: count("CHANNELS", 40),
    messages: count("MESSAGES", 30000),
    rolesPerMember: count("ROLES_PER_MEMBER", 3),
    heavyAuthorMessages: count("HEAVY_AUTHOR_MESSAGES", 20000),
    threads: count("THREADS", 5000),
    emojis: count("EMOJIS", 250),
    auditLogs: count("AUDIT_LOGS", 50000),
    guilds: count("GUILDS", 100),
    guildChannels: count("GUILD_CHANNELS", 30),
    guildRoles: count("GUILD_ROLES", 15),
    guildEmojis: count("GUILD_EMOJIS", 50),
    guildAuditLogs: count("GUILD_AUDIT_LOGS", 500),
};
const api = `http://localhost:${process.env.PORT || env.PORT}/api/v9`;
const key = createPrivateKey(readFileSync(new URL("jwt.key", root)));
const sign = (userId) => jwt.sign({ id: userId, iat: Math.floor(Date.now() / 1000), ver: 3 }, key, { algorithm: "ES512" });

const db = new Client({ connectionString: process.env.DATABASE || env.DATABASE });
await db.connect();
await db.query("SET statement_timeout = '120s'");
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const insert = async (table, rows, returning = "") => {
    const out = [];
    if (!rows.length) return out;
    const columns = Object.keys(rows[0])
        .map((c) => `"${c}"`)
        .join(", ");
    for (let i = 0; i < rows.length; i += 2000) {
        const res = await db.query(`INSERT INTO "${table}" (${columns}) SELECT ${columns} FROM json_populate_recordset(null::"${table}", $1) ${returning}`, [
            JSON.stringify(rows.slice(i, i + 2000)),
        ]);
        out.push(...res.rows);
    }
    return out;
};

const tester = await one(`SELECT id FROM users WHERE username = 'tester'`);
const friend = await one(`SELECT * FROM users WHERE username = 'friend'`);
if (!tester || !friend) throw new Error("run scripts/dev/seed.mjs first");
const testerToken = sign(tester.id);
const call = async (method, path, body) => {
    const res = await fetch(`${api}${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: testerToken },
        body: body && JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
};

const started = Date.now();
const guild = await call("POST", "/guilds", { name: "Perf Guild" });
const guildChannels = await call("GET", `/guilds/${guild.id}/channels`);
const general = guildChannels.find((c) => c.type === 0);
const category = guildChannels.find((c) => c.type === 4);

let next = BigInt(guild.id) + 10n ** 14n + BigInt(Math.floor(Math.random() * 1e6)) * 100000n;
const id = () => (next++).toString();
let seed = 42;
const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
};
const pick = (list) => list[Math.floor(random() * list.length)];

await db.query("BEGIN");

const settingsBase = await one(`SELECT * FROM user_settings WHERE index = $1`, [friend.settingsIndex]);
const { index, ...settingsRow } = settingsBase;
const userIds = Array.from({ length: sizes.members }, id);
const settings = await insert(
    "user_settings",
    userIds.map(() => settingsRow),
    "RETURNING index",
);
await insert(
    "users",
    userIds.map((userId, i) => ({
        ...friend,
        id: userId,
        username: `perf${i}`,
        email: `perf${i}@fosscord.test`,
        global_name: i % 3 ? `Perf User ${i}` : null,
        discriminator: String(i % 10000).padStart(4, "0"),
        settingsIndex: settings[i].index,
    })),
);

const roleIds = Array.from({ length: sizes.roles }, id);
const viewChannel = 1n << 10n;
const sendMessages = 1n << 11n;
const manageMessages = 1n << 13n;
await insert(
    "roles",
    roleIds.map((roleId, i) => ({
        id: roleId,
        guild_id: guild.id,
        color: (i * 2654435761) & 0xffffff,
        colors: { primary_color: (i * 2654435761) & 0xffffff, secondary_color: null, tertiary_color: null },
        hoist: i % 6 === 0,
        managed: false,
        mentionable: true,
        name: `perf role ${i + 1}`,
        permissions: String(i % 10 === 0 ? sendMessages | viewChannel | manageMessages : i % 2 ? sendMessages : 0n),
        position: i + 1,
        flags: 0,
    })),
);

const memberUserIds = [friend.id, ...userIds];
const members = await insert(
    "members",
    memberUserIds.map((userId, i) => ({
        id: userId,
        guild_id: guild.id,
        nick: i % 7 === 0 ? `nick ${i}` : null,
        joined_at: new Date(Date.now() - i * 60_000).toISOString(),
        deaf: false,
        mute: false,
        pending: false,
        settings: {},
        bio: "",
        flags: 0,
    })),
    "RETURNING index, id",
);
const memberRoles = [];
for (const { index: memberIndex } of members) {
    memberRoles.push({ index: memberIndex, role_id: guild.id });
    const own = new Set();
    while (own.size < sizes.rolesPerMember) own.add(pick(roleIds));
    for (const role_id of own) memberRoles.push({ index: memberIndex, role_id });
}
const testerMember = await one(`SELECT index FROM members WHERE id = $1 AND guild_id = $2`, [tester.id, guild.id]);
for (const role_id of roleIds.slice(0, 5)) memberRoles.push({ index: testerMember.index, role_id });
await insert("member_roles", memberRoles);
await db.query(`UPDATE guilds SET member_count = member_count + $1 WHERE id = $2`, [memberUserIds.length, guild.id]);

const overwrites = (n) =>
    Array.from({ length: n }, (_, i) =>
        i % 4 === 3
            ? { id: pick(userIds), type: 1, allow: String(sendMessages), deny: "0" }
            : { id: pick(roleIds), type: 0, allow: String(i % 2 ? viewChannel | sendMessages : 0n), deny: String(i % 2 ? 0n : manageMessages) },
    );
const channelIds = Array.from({ length: sizes.channels }, id);
const templateChannel = await one(`SELECT * FROM channels WHERE id = $1`, [general.id]);
await insert(
    "channels",
    channelIds.map((channelId, i) => ({
        ...templateChannel,
        id: channelId,
        name: `perf-${i + 1}`,
        topic: `perf channel ${i + 1}`,
        parent_id: category?.id ?? null,
        last_message_id: null,
        permission_overwrites: overwrites(4 + (i % 8)),
    })),
);
await db.query(`UPDATE channels SET permission_overwrites = $2 WHERE id = $1`, [general.id, JSON.stringify(overwrites(12))]);
await db.query(`UPDATE channels SET permission_overwrites = $2 WHERE id = $1`, [category.id, JSON.stringify(overwrites(6))]);
await db.query(`UPDATE guilds SET channel_ordering = channel_ordering || $2::bigint[] WHERE id = $1`, [guild.id, channelIds]);

const stickerIds = [id(), id()];
await insert(
    "stickers",
    stickerIds.map((stickerId, i) => ({
        id: stickerId,
        name: `perf sticker ${i + 1}`,
        description: "",
        available: true,
        tags: "smile",
        guild_id: guild.id,
        type: 2,
        format_type: 1,
    })),
);

const authors = [tester.id, friend.id, ...userIds.slice(0, 200)];
const emojis = ["👍", "❤️", "😂", "🎉", "🔥", "👀"].map((name) => ({ name, id: null }));
const start = Date.now() - sizes.messages * 60_000;
const messageIds = [];
for (let i = 0; i < sizes.messages; i += 2000) {
    const rows = [];
    const attachments = [];
    const userMentions = [];
    const roleMentions = [];
    const channelMentions = [];
    const stickers = [];
    for (let j = 0; j < Math.min(2000, sizes.messages - i); j++) {
        const n = i + j;
        const ts = start + n * 60_000;
        const messageId = (((BigInt(ts) - 1420070400000n) << 22n) + BigInt(j)).toString();
        const author = authors[n % authors.length];
        const reply = n > 10 && n % 10 === 0 ? messageIds[n - 1 - Math.floor(random() * 10)] : null;
        const mentioned = n % 20 === 0 ? [pick(memberUserIds), tester.id] : [];
        const mentionedRole = n % 50 === 0 ? pick(roleIds) : null;
        const mentionedChannel = n % 40 === 7 ? pick(channelIds) : null;
        const reactions =
            n % 8 === 0
                ? emojis.slice(0, 1 + (n % 4)).map((emoji) => {
                      const user_ids = [...new Set(Array.from({ length: 1 + Math.floor(random() * 6) }, () => pick(authors)))];
                      return { emoji, count: user_ids.length, user_ids };
                  })
                : [];
        rows.push({
            id: messageId,
            channel_id: general.id,
            guild_id: guild.id,
            author_id: author,
            member_id: author,
            content: `${mentioned.map((u) => `<@${u}> `).join("")}${mentionedRole ? `<@&${mentionedRole}> ` : ""}${mentionedChannel ? `<#${mentionedChannel}> ` : ""}perf message ${n} ${"lorem ipsum ".repeat(n % 5)}`,
            timestamp: new Date(ts).toISOString(),
            embeds: [],
            reactions,
            type: reply ? 19 : 0,
            flags: 0,
            mention_everyone: false,
            tts: false,
            message_snapshots: [],
            message_reference: reply ? { message_id: reply, channel_id: general.id, guild_id: guild.id } : null,
            message_reference_id: reply,
        });
        messageIds.push(messageId);
        if (n % 10 === 3)
            for (const name of [`file${n}.png`, `second${n}.png`])
                attachments.push({
                    id: id(),
                    filename: name,
                    size: 1000 + n,
                    height: 256,
                    width: 256,
                    content_type: "image/png",
                    message_id: messageId,
                    channel_id: general.id,
                    flags: 0,
                });
        if (n % 60 === 10) stickers.push({ message_id: messageId, sticker_id: stickerIds[n % 2] });
        for (const user_id of new Set(mentioned)) userMentions.push({ message_id: messageId, user_id });
        if (mentionedRole) roleMentions.push({ message_id: messageId, role_id: mentionedRole });
        if (mentionedChannel) channelMentions.push({ message_id: messageId, channel_id: mentionedChannel });
    }
    await insert("messages", rows);
    await insert("attachments", attachments);
    await insert("message_user_mentions", userMentions);
    await insert("message_role_mentions", roleMentions);
    await insert("message_channel_mentions", channelMentions);
    await insert("message_stickers", stickers);
}
await db.query(`UPDATE channels SET last_message_id = $2 WHERE id = $1`, [general.id, messageIds.at(-1)]);
await db.query(
    `INSERT INTO messages (id, channel_id, guild_id, author_id, member_id, content, timestamp, embeds, reactions, type, flags, message_snapshots, nonce)
     SELECT ((($4::bigint - 1420070400000 - n * 1000) << 22) + 1), $1, $2, $3, $3, 'archived message ' || n, to_timestamp(($4::bigint - n * 1000) / 1000.0), '[]', '[]', 0, 0, '[]', 'nonce' || n
     FROM generate_series(1, $5::int) n`,
    [channelIds[0], guild.id, friend.id, start, sizes.heavyAuthorMessages],
);
const nowIso = new Date().toISOString();
const threadIds = Array.from({ length: sizes.threads }, id);
await insert(
    "channels",
    threadIds.map((threadId, i) => ({
        ...templateChannel,
        id: threadId,
        type: 11,
        name: `perf thread ${i + 1}`,
        parent_id: general.id,
        owner_id: pick(authors),
        last_message_id: null,
        permission_overwrites: [],
        member_count: 1,
        message_count: 0,
        thread_metadata: { archived: i % 20 !== 0, auto_archive_duration: 1440, archive_timestamp: nowIso, locked: false, create_timestamp: nowIso },
    })),
);
await insert(
    "thread_members",
    threadIds
        .filter((_, i) => i % 10 === 0)
        .map((threadId) => ({ id: threadId, member_idx: testerMember.index, user_id: tester.id, join_timestamp: nowIso, muted: false, flags: 0 })),
);

const emojiRows = (guildId, n) =>
    Array.from({ length: n }, (_, i) => ({
        id: id(),
        animated: i % 5 === 0,
        available: true,
        guild_id: guildId,
        user_id: pick([tester.id, friend.id]),
        managed: false,
        name: `perf_emoji_${i}`,
        require_colons: true,
        roles: [],
        groups: [],
        version: 1,
    }));
await insert("emojis", emojiRows(guild.id, sizes.emojis));

const auditEntry = (guildId) => ({
    id: id(),
    guild_id: guildId,
    user_id: pick([tester.id, friend.id]),
    action_type: pick([10, 11, 22, 25, 30, 31, 40, 72]),
    target_id: pick(userIds),
    changes: [{ key: "name", old_value: "before", new_value: "after" }],
    options: null,
    reason: null,
});
await insert(
    "audit_logs",
    Array.from({ length: sizes.auditLogs }, () => auditEntry(guild.id)),
);

const templateGuild = await one(`SELECT * FROM guilds WHERE id = $1`, [guild.id]);
const extraGuildIds = Array.from({ length: sizes.guilds }, id);
const extraChannels = [];
const extraRoles = [];
await insert(
    "guilds",
    extraGuildIds.map((guildId, i) => ({
        ...templateGuild,
        id: guildId,
        name: `perf extra ${i + 1}`,
        owner_id: friend.id,
        member_count: 2,
        channel_ordering: [],
        system_channel_id: null,
    })),
);
for (const guildId of extraGuildIds) {
    extraRoles.push({
        id: guildId,
        guild_id: guildId,
        color: 0,
        colors: { primary_color: 0, secondary_color: null, tertiary_color: null },
        hoist: false,
        managed: false,
        mentionable: false,
        name: "@everyone",
        permissions: "1071698660929",
        position: 0,
        flags: 0,
    });
    for (let r = 0; r < sizes.guildRoles; r++)
        extraRoles.push({
            id: id(),
            guild_id: guildId,
            color: r * 4000,
            colors: { primary_color: r * 4000, secondary_color: null, tertiary_color: null },
            hoist: r === 0,
            managed: false,
            mentionable: true,
            name: `extra role ${r}`,
            permissions: "0",
            position: r + 1,
            flags: 0,
        });
    for (let c = 0; c < sizes.guildChannels; c++)
        extraChannels.push({
            ...templateChannel,
            id: id(),
            guild_id: guildId,
            parent_id: null,
            name: `extra-${c}`,
            last_message_id: null,
            permission_overwrites: overwrites(c % 4),
        });
}
await insert("roles", extraRoles);
await insert("channels", extraChannels);
const extraMembers = await insert(
    "members",
    extraGuildIds.flatMap((guildId) =>
        [tester.id, friend.id].map((userId) => ({
            id: userId,
            guild_id: guildId,
            nick: null,
            joined_at: nowIso,
            deaf: false,
            mute: false,
            pending: false,
            settings: {},
            bio: "",
            flags: 0,
        })),
    ),
    "RETURNING index, guild_id",
);
await insert(
    "member_roles",
    extraMembers.map((m) => ({ index: m.index, role_id: m.guild_id })),
);
await insert(
    "emojis",
    extraGuildIds.flatMap((guildId) => emojiRows(guildId, sizes.guildEmojis)),
);
await insert(
    "audit_logs",
    extraGuildIds.flatMap((guildId) => Array.from({ length: sizes.guildAuditLogs }, () => auditEntry(guildId))),
);

await db.query("COMMIT");
await db.query("ANALYZE");
await db.end();

writeFileSync(
    new URL("scripts/dev/.perf-fixture.json", root),
    JSON.stringify({
        guild: guild.id,
        general: general.id,
        channels: channelIds,
        roles: roleIds,
        extraGuilds: extraGuildIds,
        threads: threadIds.length,
        tester: { id: tester.id, token: testerToken },
        friend: { id: friend.id, token: sign(friend.id) },
        users: userIds.slice(0, 500).map((userId) => ({ id: userId, token: sign(userId) })),
    }),
);
console.log(JSON.stringify({ guild: guild.id, general: general.id, ...sizes, ms: Date.now() - started }));
