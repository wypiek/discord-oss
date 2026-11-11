import { AllowedMentions, AppliedTagList, EmbedList, MessageComponentList, StickerIdList } from "@spacebar/schemas";
import { MessageCreateAttachment, MessageCreateCloudAttachment, PollCreationSchema } from "./MessageCreateSchema";

export interface WebhookExecuteSchema {
    /**
     * @maxLength 4000
     */
    content?: string;
    /**
     * @maxLength 80
     */
    username?: string;
    /**
     * @maxLength 2048
     */
    avatar_url?: string;
    tts?: boolean;
    embeds?: EmbedList;
    allowed_mentions?: AllowedMentions;
    components?: MessageComponentList;
    file?: {
        /**
         * @maxLength 1024
         */
        filename: string;
    };
    /**
     * @maxLength 1048576
     */
    payload_json?: string;
    // TODO: we should create an interface for attachments
    /**
     * @maxItems 50
     */
    attachments?: (MessageCreateAttachment | MessageCreateCloudAttachment)[];
    flags?: number;
    /**
     * @maxLength 100
     */
    thread_name?: string;
    applied_tags?: AppliedTagList;
    message_reference?: {
        /**
         * @maxLength 64
         */
        message_id: string;
        /**
         * @maxLength 64
         */
        channel_id?: string;
        /**
         * @maxLength 64
         */
        guild_id?: string;
        fail_if_not_exists?: boolean;
    };
    sticker_ids?: StickerIdList;
    /**
     * @maxLength 25
     */
    nonce?: string;
    enforce_nonce?: boolean; // For Discord compatibility, it's the default behavior here
    poll?: PollCreationSchema;
}

export type WebhookMessageEditSchema = Omit<WebhookExecuteSchema, "content" | "embeds" | "components"> & {
    /**
     * @maxLength 4000
     */
    content?: string | null;
    embeds?: EmbedList | null;
    components?: MessageComponentList | null;
};
