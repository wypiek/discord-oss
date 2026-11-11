export interface RefreshedUrl {
    original: string;
    refreshed: string;
}

export interface RefreshUrlsResponse {
    refreshed_urls: RefreshedUrl[];
}
