export interface ApplicationAssetCreateSchema {
    /**
     * @minLength 1
     * @maxLength 32
     */
    name: string;
    type?: number;
    image: string;
}

export interface ApplicationTesterAddSchema {
    /**
     * @minLength 1
     * @maxLength 32
     */
    username: string;
    /**
     * @maxLength 4
     */
    discriminator?: string | null;
}

export interface ApplicationProxyMapping {
    /**
     * @minLength 1
     * @maxLength 256
     */
    prefix: string;
    /**
     * @minLength 1
     * @maxLength 256
     */
    target: string;
}

export interface ApplicationProxyConfigSchema {
    /**
     * @maxItems 50
     */
    url_map: ApplicationProxyMapping[];
}

export interface EmbeddedActivityConfigModifySchema {
    /**
     * @maxLength 20
     */
    activity_preview_video_asset_id?: string | null;
    /**
     * @TJS-type ["array", "null"]
     * @maxItems 10
     * @items.type string
     * @items.maxLength 16
     */
    supported_platforms?: string[] | null;
    default_orientation_lock_state?: number;
    tablet_default_orientation_lock_state?: number;
    requires_age_gate?: boolean;
    shelf_rank?: number;
}
