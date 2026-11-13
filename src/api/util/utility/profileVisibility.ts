export enum ProfileVisibility {
    UNSET = 0,
    FRIENDS_ONLY = 1,
    FRIENDS_AND_SMALL_GUILDS = 2,
    FRIENDS_AND_ALL_GUILDS = 3,
}

export const SMALL_GUILD_MAX_MEMBERS = 200;

export interface ProfileViewer {
    self: boolean;
    friend: boolean;
    staff: boolean;
    sharedGuildMemberCounts: number[];
}

export function restrictsProfile(visibility: number | undefined | null) {
    return visibility === ProfileVisibility.FRIENDS_ONLY || visibility === ProfileVisibility.FRIENDS_AND_SMALL_GUILDS;
}

export function sharesFullProfile(visibility: number | undefined | null, viewer: ProfileViewer) {
    if (viewer.self || viewer.friend || viewer.staff) return true;
    if (visibility === ProfileVisibility.FRIENDS_ONLY) return false;
    if (visibility === ProfileVisibility.FRIENDS_AND_SMALL_GUILDS) return viewer.sharedGuildMemberCounts.some((count) => count <= SMALL_GUILD_MAX_MEMBERS);
    return true;
}

type ProfileSection = { bio?: string; pronouns?: string } & Record<string, unknown>;

export interface RedactableProfile {
    user: { bio?: string } & Record<string, unknown>;
    user_profile: ProfileSection;
    guild_member_profile?: ProfileSection;
    connected_accounts: unknown[];
    badges: unknown[];
    guild_badges: unknown[];
    widgets: unknown[];
    premium_since: unknown;
    premium_guild_since: unknown;
    application_role_connections?: unknown[];
    private?: boolean;
}

export function limitedProfile<T extends RedactableProfile>(profile: T): T {
    const blankText = (section: ProfileSection): ProfileSection => ({ ...section, bio: "", pronouns: "" });
    return {
        ...profile,
        user: { ...profile.user, bio: "" },
        user_profile: blankText(profile.user_profile),
        ...(profile.guild_member_profile ? { guild_member_profile: blankText(profile.guild_member_profile) } : {}),
        connected_accounts: [],
        badges: [],
        guild_badges: [],
        widgets: [],
        premium_since: null,
        premium_guild_since: null,
        ...(profile.application_role_connections ? { application_role_connections: [] } : {}),
        private: true,
    };
}
