import { ShortIdList } from "./CappedLists";

export type UserSettingsUpdateSchema = Partial<UserSettingsSchema>;

export interface UserSettingsSchema {
    /**
     * @maxItems 1000
     */
    activity_restricted_guild_ids: ShortIdList;
    /**
     * @maxItems 1000
     */
    activity_joining_restricted_guild_ids: ShortIdList;
    afk_timeout: number;
    allow_accessibility_detection: boolean;
    allow_activity_party_privacy_friends: boolean;
    allow_activity_party_privacy_voice_channel: boolean;
    animate_emoji: boolean;
    animate_stickers: number;
    contact_sync_enabled: boolean;
    convert_emoticons: boolean;
    custom_status: CustomStatus | null;
    default_guilds_restricted: boolean;
    detect_platform_accounts: boolean;
    developer_mode: boolean;
    disable_games_tab: boolean;
    enable_tts_command: boolean;
    explicit_content_filter: number;
    friend_discovery_flags: number;
    friend_source_flags: FriendSourceFlags | null;
    gif_auto_play: boolean;
    /**
     * @maxItems 1000
     */
    guild_folders: GuildFolder[]; // every top guild is displayed as a "folder"
    inline_attachment_media: boolean;
    inline_embed_media: boolean;
    /**
     * @maxLength 16
     */
    locale: string; // en_US
    message_display_compact: boolean;
    native_phone_integration_enabled: boolean;
    passwordless: boolean;
    render_embeds: boolean;
    render_reactions: boolean;
    /**
     * @maxItems 1000
     */
    restricted_guilds: ShortIdList;
    show_current_game: boolean;
    slayer_sdk_receive_dms_in_game: number;
    soundboard_volume: number;
    status: "online" | "offline" | "dnd" | "idle" | "invisible";
    stream_notifications_enabled: boolean;
    theme: "dark" | "light" | "darker" | "midnight"; // dark
    timezone_offset: number; // e.g -60
    view_nsfw_commands: boolean;
    view_nsfw_guilds: boolean;
}

export interface CustomStatus {
    /**
     * @maxLength 64
     */
    emoji_id?: string | null;
    /**
     * @maxLength 32
     */
    emoji_name?: string | null;
    /**
     * @maxLength 64
     */
    expires_at?: string | number | null;
    /**
     * @maxLength 128
     */
    text?: string | null;
}

export interface GuildFolder {
    color?: number | null;
    /**
     * @maxItems 1000
     * @items.type string
     * @items.maxLength 64
     */
    guild_ids: string[];
    id?: number | null;
    /**
     * @maxLength 100
     */
    name?: string | null;
}

export interface FriendSourceFlags {
    all?: boolean;
    mutual_friends?: boolean;
    mutual_guilds?: boolean;
}
