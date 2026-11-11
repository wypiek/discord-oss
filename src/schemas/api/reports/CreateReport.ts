export interface CreateReportSchema {
    /**
     * @maxLength 64
     */
    version: string;
    /**
     * @maxLength 256
     */
    variant: string;
    /**
     * @maxLength 64
     */
    name: string;
    /**
     * @maxLength 16
     */
    language: string;
    /**
     * @maxItems 32
     */
    breadcrumbs: number[];
    /**
     * @TJS-type object
     * @maxProperties 32
     * @additionalProperties.anyOf [{"type": "string", "maxLength": 4000}, {"type": "array", "maxItems": 50, "items": {"type": "string", "maxLength": 200}}]
     */
    elements?: { [key: string]: string[] | string };
    /**
     * @maxLength 20
     */
    channel_id?: string; // snowflake
    /**
     * @maxLength 20
     */
    message_id?: string; // snowflake
    /**
     * @maxLength 20
     */
    guild_id?: string; // snowflake
    /**
     * @maxLength 20
     */
    stage_instance_id?: string; // snowflake
    /**
     * @maxLength 20
     */
    guild_scheduled_event_id?: string; // snowflake
    /**
     * @maxLength 20
     */
    reported_user_id?: string; // snowflake
    /**
     * @maxLength 64
     */
    entrypoint?: string;
    /**
     * @maxLength 20
     */
    application_id?: string; // snowflake
    /**
     * @maxLength 20
     */
    user_id?: string; // snowflake
    /**
     * @maxLength 20
     */
    widget_id?: string; // snowflake
    /**
     * @maxLength 64
     */
    e2ee_content_key?: string;
    /**
     * @TJS-type object
     * @maxProperties 50
     * @additionalProperties.type string
     * @additionalProperties.maxLength 64
     */
    e2ee_context_keys?: { [message_id: string]: string };
}

export interface CreateReportResponse {
    report_id: string;
    id: string;
}
