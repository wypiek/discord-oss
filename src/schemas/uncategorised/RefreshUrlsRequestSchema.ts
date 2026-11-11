export interface RefreshUrlsRequestSchema {
    /**
     * @maxItems 50
     * @items.type string
     * @items.maxLength 2048
     */
    attachment_urls: string[];
}
