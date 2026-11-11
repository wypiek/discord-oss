import { GuildIdList } from "./GuildCappedLists";
import { ChannelPermissionOverwriteType, ChannelType, DefaultReaction, TagCreateSchema } from "@spacebar/schemas";

export interface ChannelModifySchema {
    /**
     * @maxLength 100
     */
    name?: string;
    type?: ChannelType;
    /**
     * @maxLength 4096
     */
    topic?: string | null;
    icon?: string | null;
    /**
     * @maxLength 20
     */
    owner?: string;
    bitrate?: number;
    user_limit?: number;
    rate_limit_per_user?: number;
    position?: number;
    invitable?: boolean;
    /**
     * @maxItems 500
     */
    permission_overwrites?: {
        /**
         * @maxLength 20
         */
        id: string;
        type: ChannelPermissionOverwriteType;
        /**
         * @maxLength 32
         */
        allow: string;
        /**
         * @maxLength 32
         */
        deny: string;
    }[];
    /**
     * @maxItems 5
     */
    applied_tags?: GuildIdList;
    /**
     * @maxLength 20
     */
    parent_id?: string | null;
    /**
     * @maxLength 20
     */
    id?: string; // is not used (only for guild create)
    nsfw?: boolean;
    /**
     * @maxLength 64
     */
    rtc_region?: string | null;
    default_auto_archive_duration?: number | null;
    default_reaction_emoji?: DefaultReaction | null;
    default_sort_order?: number | null;
    default_forum_layout?: number | null;
    /**
     * @maxLength 32
     */
    default_tag_setting?: string | null;
    flags?: number;
    default_thread_rate_limit_per_user?: number;
    video_quality_mode?: number;
    auto_archive_duration?: number;
    archived?: boolean;
    locked?: boolean;
    /**
     * @maxItems 20
     */
    available_tags?: (TagCreateSchema & {
        /**
         * @maxLength 20
         */
        id?: string | null;
    })[];
    /**
     * @maxLength 4096
     */
    template?: string | null;
    icon_emoji?: {
        /**
         * @maxLength 20
         */
        id?: string | null;
        /**
         * @maxLength 32
         */
        name?: string | null;
    } | null;
    theme_color?: number | null;
    /**
     * @maxLength 20
     */
    application_id?: string | null;
}
