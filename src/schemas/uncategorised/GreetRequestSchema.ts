import { AllowedMentions, StickerIdList } from "@spacebar/schemas";

export interface GreetRequestSchema {
    sticker_ids: StickerIdList;
    allowed_mentions?: AllowedMentions;
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
}
