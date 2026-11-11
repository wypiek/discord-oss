export class EmbedConfiguration {
    defaultUserAgent: string | null = null;

    youtube = new YoutubeEmbedConfiguration();
}

export class YoutubeEmbedConfiguration {
    useCurlUserAgent: boolean = false;
    userAgent: string | null = null;
    cookie: string | null = null;
}
