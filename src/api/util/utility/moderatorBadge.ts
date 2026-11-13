import { In } from "typeorm";
import { sqlArrayIncludes } from "@spacebar/database/Sql";
import { Badge, User } from "@spacebar/database";
import { UserFlags } from "@spacebar/schemas";
import { broadcastUserUpdate, emitEvent, LEGACY_BADGES, loadStaffRoles, moderatorBadgeRole, StaffRoleSnapshot, UserUpdateEvent } from "@spacebar/util";

export const MODERATOR_ALUMNI_BADGE = LEGACY_BADGES.find((badge) => badge.key === "certified_moderator")!;
export const CERTIFIED_MODERATOR_FLAG = UserFlags.FLAGS.CERTIFIED_MODERATOR;
export const MODERATOR_ROLE_BADGE_PREFIX = "moderator-role-";

type FlagValue = string | bigint | number | null | undefined;

interface AlumniCandidate {
    id: string;
    badge_ids?: string[] | null;
    public_flags?: FlagValue;
    flags?: FlagValue;
}

export const isModeratorAlumniBadge = (badge: { icon?: string | null }) => badge.icon === MODERATOR_ALUMNI_BADGE.icon;

export const moderatorRoleBadgeRow = (role: { id: string }) => ({
    id: `${MODERATOR_ROLE_BADGE_PREFIX}${role.id}`,
    description: MODERATOR_ALUMNI_BADGE.name,
    icon: MODERATOR_ALUMNI_BADGE.icon,
});

export const holdsModeratorAlumni = (user: AlumniCandidate, alumniBadgeIds: ReadonlySet<string>, snap: StaffRoleSnapshot) =>
    !!moderatorBadgeRole(String(user.id), snap) || (user.badge_ids ?? []).some((id) => alumniBadgeIds.has(String(id)));

export const withModeratorFlag = (value: FlagValue, wanted: boolean) => {
    const current = BigInt(value ?? 0);
    return Number(wanted ? current | CERTIFIED_MODERATOR_FLAG : current & ~CERTIFIED_MODERATOR_FLAG);
};

export async function moderatorAlumniBadgeIds() {
    const badges = await Badge.find({ where: { icon: MODERATOR_ALUMNI_BADGE.icon }, select: { id: true } });
    return new Set(badges.map((badge) => String(badge.id)));
}

export async function notifyUserUpdate(user_id: string) {
    const updated = await User.findOneOrFail({ where: { id: user_id } });
    await emitEvent({ event: "USER_UPDATE", user_id, data: updated.toPrivateUser() as unknown as UserUpdateEvent["data"] } satisfies UserUpdateEvent);
    await broadcastUserUpdate(user_id);
}

export async function syncModeratorAlumni(user_ids: string[], options: { notify?: "changed" | "all" | "none"; snap?: StaffRoleSnapshot } = {}) {
    const ids = [...new Set(user_ids.map(String))];
    if (!ids.length) return [];
    const notify = options.notify ?? "changed";
    const [snap, alumni, users] = await Promise.all([
        options.snap ?? loadStaffRoles(),
        moderatorAlumniBadgeIds(),
        User.find({ where: { id: In(ids) }, select: { id: true, badge_ids: true, public_flags: true, flags: true } }),
    ]);
    const changed: string[] = [];
    for (const user of users) {
        const wanted = holdsModeratorAlumni(user, alumni, snap);
        const public_flags = withModeratorFlag(user.public_flags, wanted);
        const flags = withModeratorFlag(user.flags, wanted);
        if (public_flags === Number(user.public_flags ?? 0) && flags === Number(user.flags ?? 0)) continue;
        await User.update({ id: user.id }, { public_flags, flags });
        changed.push(String(user.id));
    }
    const notified = notify === "all" ? users.map((user) => String(user.id)) : notify === "changed" ? changed : [];
    for (const user_id of notified) await notifyUserUpdate(user_id);
    return changed;
}

export async function syncAllModeratorAlumni() {
    const snap = await loadStaffRoles(true);
    const alumni = await moderatorAlumniBadgeIds();
    const flag = Number(CERTIFIED_MODERATOR_FLAG);
    const flagged: { id: string }[] = await User.query(`SELECT "id" FROM "users" WHERE ("public_flags" & ${flag}) <> 0 OR ("flags" & ${flag}) <> 0`);
    const holders: { id: string }[] = [];
    for (const badge_id of alumni) holders.push(...(await User.query(`SELECT "id" FROM "users" WHERE ${sqlArrayIncludes("CAST($1 AS bigint)", '"badge_ids"')}`, [badge_id])));
    const candidates = [...snap.members.keys(), ...flagged.map((row) => String(row.id)), ...holders.map((row) => String(row.id))];
    return syncModeratorAlumni(candidates, { notify: "none", snap });
}
