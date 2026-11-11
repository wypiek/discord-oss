export interface GuildUpdateWelcomeScreenSchema {
    /**
     * @maxItems 5
     */
    welcome_channels?: {
        /**
         * @maxLength 20
         */
        channel_id: string;
        /**
         * @maxLength 50
         */
        description: string;
        /**
         * @maxLength 20
         */
        emoji_id?: string;
        /**
         * @maxLength 32
         */
        emoji_name?: string;
    }[];
    enabled?: boolean;
    /**
     * @maxLength 140
     */
    description?: string;
}
