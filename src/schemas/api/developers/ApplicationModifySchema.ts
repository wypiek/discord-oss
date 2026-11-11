export interface ApplicationModifySchema {
    /**
     * @maxLength 400
     */
    description?: string;
    icon?: string;
    cover_image?: string;
    /**
     * @maxLength 2048
     */
    interactions_endpoint_url?: string | null;
    max_participants?: number | null;
    /**
     * @minLength 2
     * @maxLength 32
     */
    name?: string;
    /**
     * @maxLength 2048
     */
    privacy_policy_url?: string | null;
    /**
     * @maxLength 2048
     */
    role_connections_verification_url?: string;
    /**
     * @TJS-type array
     * @maxItems 5
     * @items.type string
     * @items.maxLength 20
     */
    tags?: string[];
    /**
     * @maxLength 2048
     */
    terms_of_service_url?: string | null;
    bot_public?: boolean;
    bot_require_code_grant?: boolean;
    discoverability_state?: 2 | 3;
    flags?: number;
    /**
     * @maxLength 2048
     */
    custom_install_url?: string | null;
    /**
     * @maxLength 20
     */
    guild_id?: string;
    /**
     * @TJS-type array
     * @maxItems 10
     * @items.type string
     * @items.maxLength 2048
     */
    redirect_uris?: string[];
    integration_types_config?: {
        "0"?: ApplicationIntegrationTypeConfig;
        "1"?: ApplicationIntegrationTypeConfig;
    };
    /*install_params?: { TODO: Validation
		scopes: string[];
		permissions: string;
	};*/
}

export interface ApplicationIntegrationTypeConfig {
    oauth2_install_params?: {
        /**
         * @maxItems 10
         * @items.type string
         * @items.maxLength 64
         */
        scopes: string[];
        /**
         * @maxLength 20
         */
        permissions: string;
    } | null;
}
