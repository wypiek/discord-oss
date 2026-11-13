export interface ApplicationExternalAssetsSchema {
    /**
     * @minItems 1
     * @maxItems 10
     * @items.type string
     * @items.maxLength 900
     */
    urls: string[];
}

export interface ApplicationExternalAsset {
    url: string;
    external_asset_path: string;
}

export type ApplicationExternalAssetsResponse = ApplicationExternalAsset[];
