export interface WebhookUpdateSchema {
    /**
     * @minLength 1
     * @maxLength 80
     */
    name?: string;
    avatar?: string | null;
    /**
     * @maxLength 20
     */
    channel_id?: string;
    /**
     * @maxLength 20
     */
    id?: string;
    type?: number;
    /**
     * @maxLength 20
     */
    guild_id?: string | null;
    /**
     * @maxLength 20
     */
    application_id?: string | null;
    user?: object | null;
    /**
     * @maxLength 128
     */
    token?: string;
    /**
     * @maxLength 512
     */
    url?: string;
    source_guild?: object | null;
    source_channel?: object | null;
}
