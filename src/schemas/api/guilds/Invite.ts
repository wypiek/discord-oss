import { Snowflake } from "../../Identifiers";
import { PartialUser } from "../users";
import { GuildNsfwLevel, GuildPremiumTier, GuildVerificationLevel } from "./GuildSchema";
import { GuildProfileResponse, PublicChannel, RoleColors } from "@spacebar/schemas";

export type InviteListResponse = PublicInvite[];

export interface PublicInvite {
    code: string;
    type: InviteType;
    channel: PublicChannel | null; // TODO: Figure out what fields this is *supposed* to have as it's labeled as "Partial channel object"
    guild_id?: Snowflake;
    guild?: InviteGuild;
    profile?: GuildProfileResponse;
    inviter?: PartialUser;
    flags?: InviteFlags;
    target_type?: number;
    target_user?: PartialUser;
    // target_application?: PartialApplication; // TODO - voice activities
    roles?: InviteRole[]; // TODO: This is labeled as "Partial role object", is this used anywhere else?
    approximate_member_count?: number;
    approximate_presence_count?: number;
    expires_at: string | null;
    // guild_scheduled_event?: GuildScheduledEvent; //TODO - scheduled events
    new_member?: boolean;
    show_verification_form?: boolean;
    is_nickname_changeable?: boolean;
    target_users_job_status?: InviteTargetUsersJob; // TODO
}

export enum InviteType {
    GUILD = 0,
    GROUP_DM = 1,
    FRIEND = 2,
}

export enum InviteFlags {
    IS_GUEST_INVITE = 1 << 0, // temporary voice channel access
    IS_VIEWED = 1 << 1, // TODO
    IS_ENHANCED = 1 << 2, // Unknown
    IS_APPLICATION_BYPASS = 1 << 3, // Bypass guild join requests -> pending=false
}

export interface InviteTargetUsersJob {
    status: InviteTargetUsersJobStatus;
    total_users: number;
    processed_users: number;
    created_at: Date | null;
    completed_at: Date | null;
    error_message: string | null;
}

export enum InviteTargetUsersJobStatus {
    UNSPECIFIED = 0,
    PROCESSING = 1,
    COMPLETED = 2,
    FAILED = 3,
}

export interface InviteGuild {
    id: Snowflake;
    name: string;
    icon: string | null;
    description: string | null;
    banner: string | null;
    splash: string | null;
    verification_level: GuildVerificationLevel;
    features: string[];
    vanity_url_code: string | null;
    premium_subscription_count?: number;
    premium_tier: GuildPremiumTier;
    nsfw: boolean;
    nsfw_level: GuildNsfwLevel;
}

export interface InviteRole {
    id: Snowflake;
    name: string;
    position: number;
    color: number;
    colors: RoleColors;
    icon?: string | null;
    unicode_emoji?: string | null;
}
