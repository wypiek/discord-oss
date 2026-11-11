export interface Embed {
    /**
     * @maxLength 256
     */
    title?: string; //title of embed
    type?: EmbedType; // type of embed (always "rich" for webhook embeds)
    /**
     * @maxLength 4096
     */
    description?: string; // description of embed
    /**
     * @maxLength 2048
     */
    url?: string; // url of embed
    timestamp?: Date; // timestamp of embed content
    color?: number; // color code of the embed
    footer?: {
        /**
         * @maxLength 2048
         */
        text: string;
        /**
         * @maxLength 2048
         */
        icon_url?: string;
        /**
         * @maxLength 2048
         */
        proxy_icon_url?: string;
    }; // footer object	footer information
    image?: EmbedImage; // image object	image information
    thumbnail?: EmbedImage; // thumbnail object	thumbnail information
    video?: EmbedImage; // video object	video information
    provider?: {
        /**
         * @maxLength 256
         */
        name?: string;
        /**
         * @maxLength 2048
         */
        url?: string;
    }; // provider object	provider information
    author?: {
        /**
         * @maxLength 256
         */
        name?: string;
        /**
         * @maxLength 2048
         */
        url?: string;
        /**
         * @maxLength 2048
         */
        icon_url?: string;
        /**
         * @maxLength 2048
         */
        proxy_icon_url?: string;
    }; // author object	author information
    /**
     * @maxItems 25
     */
    fields?: {
        /**
         * @maxLength 256
         */
        name: string;
        /**
         * @maxLength 1024
         */
        value: string;
        inline?: boolean;
    }[];
}

/**
 * @maxItems 10
 */
export type EmbedList = Embed[];

export enum EmbedType {
    rich = "rich",
    image = "image",
    video = "video",
    gifv = "gifv",
    article = "article",
    link = "link",
    poll_result = "poll_result",
    auto_moderation_message = "auto_moderation_message",
    auto_moderation_notification = "auto_moderation_notification",
}

export interface EmbedImage {
    /**
     * @maxLength 2048
     */
    url?: string;
    /**
     * @maxLength 2048
     */
    proxy_url?: string;
    height?: number;
    width?: number;
    /**
     * @maxLength 255
     */
    content_type?: string;
}
