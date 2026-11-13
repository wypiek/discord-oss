import { sqlForUpdate, sqlNow, sqlReturning } from "@spacebar/database/Sql";
import { ProcessLifecycle } from "../../../util/util/ProcessLifecycle";
import { AuditLog, getDatabase, Guild, Member, MemberRoleExpiration, Role } from "@spacebar/database";
import { emitEvent, GuildMemberUpdateEvent, trackBackground } from "@spacebar/util";
import { AuditLogEvents } from "@spacebar/schemas";
import { In } from "typeorm";

export const TEMPORARY_ROLE_SWEEP_MS = 10_000;
export const TEMPORARY_ROLE_EXPIRED_REASON = "Temporary role expired";
const BATCH = 100;

export type ExpiredRoleAssignment = {
    guild_id: string;
    user_id: string;
    role_id: string;
    member_index: number;
    assigned_by: string | null;
    removed: boolean;
};

let stopping = false;
let workerTimer: NodeJS.Timeout | undefined;
let running: Promise<number> | null = null;

export async function claimExpiredRoleAssignments(limit = BATCH): Promise<ExpiredRoleAssignment[]> {
    const database = getDatabase()!;
    return database.transaction(async (manager) => {
        const claimed = (await manager.query(
            sqlReturning(
                `DELETE FROM "member_role_expirations" WHERE ("guild_id", "user_id", "role_id") IN (SELECT "guild_id", "user_id", "role_id" FROM "member_role_expirations" WHERE "expires_at" <= ${sqlNow()} ORDER BY "expires_at" LIMIT ${Math.max(1, Math.floor(limit))} ${sqlForUpdate(true)}) RETURNING "guild_id", "user_id", "role_id", "member_index", "assigned_by"`,
            ),
        )) as Omit<ExpiredRoleAssignment, "removed">[];
        const assignments: ExpiredRoleAssignment[] = [];
        for (const row of claimed) {
            const removed = (await manager.query(sqlReturning(`DELETE FROM "member_roles" WHERE "index" = $1 AND "role_id" = $2 RETURNING "role_id"`), [
                row.member_index,
                row.role_id,
            ])) as unknown[];
            assignments.push({
                guild_id: String(row.guild_id),
                user_id: String(row.user_id),
                role_id: String(row.role_id),
                member_index: Number(row.member_index),
                assigned_by: row.assigned_by == null ? null : String(row.assigned_by),
                removed: removed.length > 0,
            });
        }
        return assignments;
    });
}

export async function announceExpiredRoleAssignments(assignments: ExpiredRoleAssignment[]) {
    const removed = assignments.filter((assignment) => assignment.removed);
    const byMember = new Map<string, ExpiredRoleAssignment[]>();
    for (const assignment of removed) {
        const key = `${assignment.guild_id}:${assignment.user_id}`;
        byMember.set(key, [...(byMember.get(key) ?? []), assignment]);
    }
    for (const group of byMember.values()) {
        const { guild_id, user_id } = group[0];
        try {
            const member = await Member.findOne({
                where: { id: user_id, guild_id },
                relations: { user: true, roles: true },
            });
            if (member)
                await emitEvent({
                    event: "GUILD_MEMBER_UPDATE",
                    guild_id,
                    data: {
                        ...member.toPublicMember(),
                        guild_id,
                        user: member.user.toPublicUser(),
                        roles: member.roles.map((role) => role.id).filter((id) => id !== guild_id),
                        role_expirations: await MemberRoleExpiration.forMember(guild_id, user_id),
                    },
                } satisfies GuildMemberUpdateEvent);
            const [roles, guild] = await Promise.all([
                Role.find({ where: { id: In(group.map((assignment) => assignment.role_id)), guild_id }, select: { id: true, name: true } }),
                Guild.findOne({ where: { id: guild_id }, select: { id: true, owner_id: true } }),
            ]);
            const names = new Map(roles.map((role) => [role.id, role.name]));
            const byActor = new Map<string, string[]>();
            for (const assignment of group) {
                const actor = assignment.assigned_by ?? guild?.owner_id;
                if (!actor) continue;
                byActor.set(actor, [...(byActor.get(actor) ?? []), assignment.role_id]);
            }
            await AuditLog.logMany(
                [...byActor].map(([actor, role_ids]) => ({
                    guild_id,
                    user_id: actor,
                    action_type: AuditLogEvents.MEMBER_ROLE_UPDATE,
                    target_id: user_id,
                    changes: [{ key: "$remove", new_value: role_ids.map((id) => ({ id, name: names.get(id) })) }] as unknown as AuditLog["changes"],
                    reason: TEMPORARY_ROLE_EXPIRED_REASON,
                })),
            );
        } catch (error) {
            console.error(`[TemporaryRoles] failed to announce expired roles of ${user_id} in ${guild_id}`, error);
        }
    }
    return removed.length;
}

export function expireTemporaryRoles(until = Infinity): Promise<number> {
    if (stopping) return running ?? Promise.resolve(0);
    if (running) return running;
    running = (async () => {
        let total = 0;
        while (!stopping && Date.now() < until) {
            const claimed = await claimExpiredRoleAssignments();
            if (!claimed.length) break;
            total += await announceExpiredRoleAssignments(claimed);
            if (claimed.length < BATCH) break;
        }
        return total;
    })()
        .catch((error) => {
            console.error("[TemporaryRoles] failed to remove expired roles", error);
            return 0;
        })
        .finally(() => {
            running = null;
        });
    return trackBackground(running);
}

export function startTemporaryRoleExpirer() {
    if (workerTimer || stopping) return workerTimer;
    const run = () => void expireTemporaryRoles();
    const initial = setTimeout(run, 0);
    workerTimer = setInterval(run, TEMPORARY_ROLE_SWEEP_MS);
    ProcessLifecycle.eventEmitter.once("stopping", async () => {
        stopping = true;
        clearTimeout(initial);
        clearInterval(workerTimer);
        await Promise.allSettled(running ? [running] : []);
    });
    return workerTimer;
}
