import { In } from "typeorm";
import { Guild, Member, Relationship, UserSettingsProtos } from "@spacebar/database";
import { RelationshipType } from "@spacebar/schemas";
import { Rights } from "@spacebar/util";
import { ProfileVisibility, restrictsProfile, sharesFullProfile } from "./profileVisibility";

export const PROFILE_PRIVACY_BYPASS_RIGHT = "VIEW_USERS";

export async function profileVisibilityOf(userId: string): Promise<number | undefined> {
    const protos = await UserSettingsProtos.findOne({ where: { user_id: userId }, select: { user_id: true, _userSettings: true } });
    return protos?.userSettings?.privacy?.profileVisibility;
}

async function sharedGuildMemberCounts(targetId: string, viewerId: string) {
    const viewerGuilds = (await Member.find({ where: { id: viewerId }, select: { guild_id: true } })).map((member) => member.guild_id);
    if (!viewerGuilds.length) return [];
    const shared = (await Member.find({ where: { id: targetId, guild_id: In(viewerGuilds) }, select: { guild_id: true } })).map((member) => member.guild_id);
    if (!shared.length) return [];
    return (await Guild.find({ where: { id: In(shared) }, select: { id: true, member_count: true } })).map((guild) => guild.member_count ?? 0);
}

export async function viewerSeesFullProfile(targetId: string, viewerId: string, rights?: Rights) {
    if (targetId === viewerId) return true;
    const visibility = await profileVisibilityOf(targetId);
    if (!restrictsProfile(visibility)) return true;
    const staff = rights?.has(PROFILE_PRIVACY_BYPASS_RIGHT) ?? false;
    const friend = staff || (await Relationship.exists({ where: { from_id: targetId, to_id: viewerId, type: RelationshipType.FRIEND } }));
    const counts = staff || friend || visibility !== ProfileVisibility.FRIENDS_AND_SMALL_GUILDS ? [] : await sharedGuildMemberCounts(targetId, viewerId);
    return sharesFullProfile(visibility, { self: false, friend, staff, sharedGuildMemberCounts: counts });
}
