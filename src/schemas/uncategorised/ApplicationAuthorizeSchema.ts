export interface ApplicationAuthorizeSchema {
    authorize: boolean;
    /**
     * @maxLength 20
     */
    guild_id?: string;
    /**
     * @maxLength 20
     */
    channel_id?: string;
    /**
     * @maxLength 20
     */
    webhook_channel_id?: string;
    /**
     * @maxLength 20
     */
    permissions?: string;
    integration_type?: number;
    /**
     * @maxProperties 32
     */
    location_context?: object;
    /**
     * @maxProperties 32
     */
    dm_settings?: object;
    /**
     * @maxLength 16384
     */
    captcha_key?: string;
    /**
     * @maxLength 64
     */
    connected_account_provider?: string | null;
    /**
     * @minLength 6
     * @maxLength 6
     */
    code?: string; // 2fa code
}
