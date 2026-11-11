import { GuildFeatureNameList } from "./GuildCappedLists";
import { GuildCreateSchema } from "@spacebar/schemas";

export interface GuildUpdateSchema extends Omit<GuildCreateSchema, "channels" | "system_channel_id" | "rules_channel_id"> {
    /**
     * @pattern ^[0-9]{1,20}$
     */
    owner_id?: string;
    banner?: string | null;
    splash?: string | null;
    /**
     * @maxLength 300
     */
    description?: string | null;
    /**
     * @maxLength 20
     */
    system_channel_id?: string | null;
    /**
     * @maxLength 20
     */
    rules_channel_id?: string | null;
    /**
     * @maxItems 100
     */
    features?: GuildFeatureNameList;
    verification_level?: number;
    default_message_notifications?: number;
    system_channel_flags?: number;
    explicit_content_filter?: number;
    /**
     * @maxLength 20
     */
    public_updates_channel_id?: string | null;
    afk_timeout?: number;
    /**
     * @maxLength 20
     */
    afk_channel_id?: string | null;
    /**
     * @maxLength 16
     */
    preferred_locale?: string;
    premium_progress_bar_enabled?: boolean;
    discovery_splash?: string | null;
    /**
     * @maxLength 20
     */
    safety_alerts_channel_id?: string | null;
}
