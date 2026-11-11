// TODO: remove entity import
import { Member } from "@spacebar/database";
import { PublicUser } from "@spacebar/schemas";

export interface ChannelOverride {
    message_notifications: number;
    mute_config: MuteConfig | null;
    muted: boolean;
    channel_id: string | null;
    collapsed?: boolean;
    flags?: number;
}

export interface UserGuildSettings {
    // channel_overrides: {
    // 	channel_id: string;
    // 	message_notifications: number;
    // 	mute_config: MuteConfig;
    // 	muted: boolean;
    // }[];

    channel_overrides: {
        [channel_id: string]: ChannelOverride;
    } | null;
    message_notifications: number;
    mobile_push: boolean;
    mute_config: MuteConfig | null;
    muted: boolean;
    suppress_everyone: boolean;
    suppress_roles: boolean;
    version: number;
    /**
     * @maxLength 64
     */
    guild_id: string | null;
    flags: number;
    mute_scheduled_events: boolean;
    hide_muted_channels: boolean;
    notify_highlights: 0;
}

export const DefaultUserGuildSettings: UserGuildSettings = {
    channel_overrides: null,
    message_notifications: 3,
    flags: 0,
    hide_muted_channels: false,
    mobile_push: true,
    mute_config: null,
    mute_scheduled_events: false,
    muted: false,
    notify_highlights: 0,
    suppress_everyone: false,
    suppress_roles: false,
    version: 453, // ?
    guild_id: null,
};

export interface MuteConfig {
    /**
     * @maxLength 64
     */
    end_time: string | null;
    selected_time_window: number;
}

export type PublicMemberKeys =
    | "id"
    | "guild_id"
    | "nick"
    | "roles"
    | "joined_at"
    | "pending"
    | "deaf"
    | "mute"
    | "premium_since"
    | "avatar"
    | "banner"
    | "bio"
    | "theme_colors"
    | "pronouns"
    | "communication_disabled_until"
    | "unusual_dm_activity_until"
    | "flags"
    | "avatar_decoration_data"
    | "collectibles"
    | "display_name_styles";

export const PublicMemberProjection: PublicMemberKeys[] = [
    "id",
    "guild_id",
    "nick",
    "roles",
    "joined_at",
    "pending",
    "deaf",
    "mute",
    "premium_since",
    "avatar",
    "banner",
    "bio",
    "theme_colors",
    "pronouns",
    "communication_disabled_until",
    "unusual_dm_activity_until",
    "flags",
    "avatar_decoration_data",
    "collectibles",
    "display_name_styles",
];

// TODO: make a proper schema rather than inheriting entity
export type PublicMember = Omit<Pick<Member, PublicMemberKeys>, "roles"> & {
    user: PublicUser;
    roles: string[]; // only role ids not objects
};

export type PublicMemberListResponse = PublicMember[];
