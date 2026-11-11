import { ChannelCreateSchema } from "@spacebar/schemas";

export interface GuildCreateSchema {
    /**
     * @minLength 2
     * @maxLength 100
     */
    name?: string;
    /**
     * @maxLength 64
     */
    region?: string;
    icon?: string | null;
    /**
     * @maxItems 500
     */
    channels?: ChannelCreateSchema[];
    /**
     * @maxLength 20
     */
    system_channel_id?: string;
    /**
     * @maxLength 20
     */
    rules_channel_id?: string;
    /**
     * @maxLength 64
     */
    guild_template_code?: string;
    staff_only?: boolean;
}
