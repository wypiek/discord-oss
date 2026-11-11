import { AllowedMentions, AppliedTagList, ChannelType, EmbedList, MessageComponentList, StickerIdList } from "@spacebar/schemas/api";
import { MessageActivity } from "./MessageActivity";
import { MessageCreateAttachment, MessageCreateCloudAttachment } from "./MessageCreateSchema";

export interface ThreadCreationSchema {
    auto_archive_duration?: number;
    rate_limit_per_user?: number;
    /**
     * @minLength 1
     * @maxLength 100
     */
    name: string;
    type?: ChannelType.GUILD_PUBLIC_THREAD | ChannelType.GUILD_PRIVATE_THREAD | ChannelType.GUILD_NEWS_THREAD;
    invitable?: boolean;
    applied_tags?: AppliedTagList;
    /**
     * @maxLength 64
     */
    location?: string; //Ignore it
    message?: {
        /**
         * @maxLength 4000
         */
        content?: string;
        embeds?: EmbedList;
        allowed_mentions?: AllowedMentions;
        components?: MessageComponentList | null;
        sticker_ids?: StickerIdList;
        activity?: MessageActivity;
        /**
         * @maxLength 64
         */
        application_id?: string;
        flags?: number;
        /**
         * @maxItems 50
         */
        attachments?: (MessageCreateAttachment | MessageCreateCloudAttachment)[];
    };
}
