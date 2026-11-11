import { Guild, Member, Role } from "@spacebar/database";
import { DiscordApiErrors } from "@spacebar/util";

export async function authorizeMemberRoleChanges(actorId: string, guildId: string, previousIds: string[], requestedIds: string[]): Promise<Role[]> {
    const requested = new Set(requestedIds.filter((id) => id !== guildId));
    const previous = new Set(previousIds.filter((id) => id !== guildId));
    const relevant = new Set([...requested, ...previous, guildId]);
    const roles = await Role.find({ where: [...relevant].map((id) => ({ id, guild_id: guildId })) });
    const byId = new Map(roles.map((role) => [role.id, role]));
    if ([...relevant].some((id) => !byId.has(id))) throw DiscordApiErrors.UNKNOWN_ROLE;
    const changed = roles.filter((role) => role.id !== guildId && requested.has(role.id) !== previous.has(role.id));
    if (changed.some((role) => role.managed)) throw DiscordApiErrors.MISSING_PERMISSIONS;
    if (changed.length) {
        const guild = await Guild.findOneOrFail({
            where: { id: guildId },
            select: { id: true, owner_id: true },
        });
        if (guild.owner_id !== actorId) {
            const actor = await Member.findOneOrFail({
                where: { id: actorId, guild_id: guildId },
                relations: { roles: true },
            });
            const highest = Math.max(0, ...actor.roles.filter((role) => role.id !== guildId && role.guild_id === guildId).map((role) => role.position));
            if (changed.some((role) => role.position >= highest)) throw DiscordApiErrors.MISSING_PERMISSIONS;
        }
    }
    return [...requested, guildId].map((id) => byId.get(id)!);
}
