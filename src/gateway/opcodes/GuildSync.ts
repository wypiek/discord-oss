import { In } from "typeorm";
import { Member } from "@spacebar/database";
import { Stopwatch, timePromise } from "@spacebar/extensions";
import { WebSocket, Payload, OPCODES, Send, handleOffloadedGatewayRequest } from "@spacebar/gateway";
import { PublicMember } from "@spacebar/schemas";
import { Presence, Config, getPermission, getUserPresences, Intents } from "@spacebar/util";
import { FullMemberRequestWindow } from "./RequestGuildMembers";

// TODO: only show roles/members that have access to this channel
// TODO: config: to list all members (even those who are offline) sorted by role, or just those who are online
// TODO: rewrite typeorm

export async function onGuildSync(this: WebSocket, { d }: Payload) {
    const sw = Stopwatch.startNew();
    if (!Array.isArray(d)) throw new Error("Invalid payload for GUILD_SYNC");

    if (Config.get().offload.gateway.guildSyncUrl !== null) {
        if (await handleOffloadedGatewayRequest(this, Config.get().offload.gateway.guildSyncUrl!, d)) return;
    }

    const guild_ids = (d as unknown[]).filter((id): id is string => typeof id === "string").slice(0, 200);

    const joinedGuildIds = await Member.find({
        where: { id: this.user_id, guild_id: In(guild_ids) },
        select: { guild_id: true },
    }).then((members) => members.map((m) => m.guild_id));

    const tasks = joinedGuildIds.map((guildId) => timePromise(async () => handleGuildSync(this, guildId)));
    // not awaiting lol
    Promise.all(tasks)
        .then((res) => {
            console.log(`[Gateway/${this.user_id}] GUILD_SYNC processed ${guild_ids.length} guilds in ${sw.elapsed().totalMilliseconds}ms:`, {
                ...Object.fromEntries(
                    res.map((r) => [r.result.id, `${r.result.id}: ${r.result.members.length}U/${r.result.presences.length}P in ${r.elapsed.totalMilliseconds}ms`]),
                ),
            });
        })
        .catch((err) => {
            console.error(`[Gateway/${this.user_id}] Error processing GUILD_SYNC:`, err);
        });
}

interface GuildSyncResult {
    id: string;
    presences: Presence[];
    members: PublicMember[];
}

async function handleGuildSync(ws: WebSocket, guild_id: string) {
    const res: GuildSyncResult = { id: guild_id, presences: [], members: [] };
    if (ws.isBot && !ws.intents?.has(Intents.FLAGS.GUILD_MEMBERS)) return res;

    const permissions = await getPermission(ws.user_id, guild_id);
    if (!permissions.has("VIEW_CHANNEL")) return res;
    const moderator = permissions.has("MANAGE_ROLES") || permissions.has("KICK_MEMBERS") || permissions.has("BAN_MEMBERS");
    if (!ws.isBot && moderator) {
        const now = Date.now();
        ws.fullMemberRequests ??= {};
        if (now - (ws.fullMemberRequests[guild_id] ?? 0) < FullMemberRequestWindow) return res;
        ws.fullMemberRequests[guild_id] = now;
    }

    const members = await Member.find({
        where: { guild_id },
        relations: { user: true, roles: true, guild: true },
        order: { id: "ASC" },
        take: ws.isBot || moderator ? undefined : 100,
    });
    res.members = members.map((m) => m.toPublicMember());

    if (!ws.isBot || ws.intents?.has(Intents.FLAGS.GUILD_PRESENCES)) {
        const presences = await getUserPresences(members.map((m) => m.id));
        res.presences = members.filter((m) => presences.has(m.id)).map((m) => ({ user: m.user.toPublicUser(), guild_id, ...presences.get(m.id)! }));
    }

    await Send(ws, {
        op: OPCODES.Dispatch,
        t: "GUILD_SYNC",
        s: ws.sequence++,
        d: res,
    });

    return res;
}
