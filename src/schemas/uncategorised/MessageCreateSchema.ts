import { Snowflake } from "../Identifiers";
import {
    InteractionType,
    AllowedMentions,
    MessageReference,
    ApplicationCommandType,
    Embed,
    EmbedList,
    AppliedTagList,
    MentionIdList,
    StickerIdList,
    MessageComponentList,
    PollAnswerCreation,
    PollQuestionMedia,
    PublicUser,
    float,
    base64str,
    E2eeEnvelope,
} from "@spacebar/schemas";

export type BaseMessageCreateAttachment = {
    /**
     * @maxLength 1024
     */
    filename: string;
    /**
     * @maxLength 256
     */
    title?: string; // clips only?
    /**
     * @maxLength 1024
     */
    description?: string; // alt text

    /**
     * @minimum 0
     * @maximum 86400
     */
    duration_secs?: float; //flat
    /**
     * @maxLength 4096
     */
    waveform?: base64str; //base64 byte array

    is_clip?: boolean;
    is_thumbnail?: boolean;
    is_remix?: boolean;
    is_spoiler?: boolean;

    clip_created_at?: Date;
    clip_participant_ids?: MentionIdList;
};

export type MessageCreateAttachment = BaseMessageCreateAttachment & {
    /**
     * @maxLength 64
     */
    id: string;
};

export type MessageCreateCloudAttachment = BaseMessageCreateAttachment & {
    /**
     * @maxLength 64
     */
    id?: string;
    /**
     * @maxLength 1024
     */
    uploaded_filename: string;
    /**
     * @maxLength 255
     */
    original_content_type?: string;
};

export interface MessageCreateSchema {
    type?: number;
    /**
     * @maxLength 4000
     */
    content?: string;
    /**
     * @maxLength 32
     */
    mobile_network_type?: string;
    signal_strength?: number;
    /**
     * @maxLength 25
     */
    nonce?: string;
    /**
     * @maxLength 64
     */
    channel_id?: string;
    tts?: boolean;
    flags?: number;
    embeds?: EmbedList | null;
    embed?: Embed | null;
    // TODO: ^ embed is deprecated in favor of embeds (https://discord.com/developers/docs/resources/channel#message-object)
    allowed_mentions?: AllowedMentions | null;
    message_reference?: MessageReference | null;
    /**
     * @maxLength 1048576
     */
    payload_json?: string;
    file?: {
        /**
         * @maxLength 1024
         */
        filename: string;
    };
    // TODO: we should create an interface for attachments
    /**
     * @maxItems 50
     */
    attachments?: (MessageCreateAttachment | MessageCreateCloudAttachment)[];
    sticker_ids?: StickerIdList | null; // null check: fixes Discord-Go
    components?: MessageComponentList | null; // null check: fixes Discord-Go
    // TODO: Fix TypeScript errors in src\api\util\handlers\Message.ts once this is enabled
    poll?: PollCreationSchema;
    enforce_nonce?: boolean; // For Discord compatibility, it's the default behavior here
    applied_tags?: AppliedTagList; // Not implemented yet, for webhooks in forums
    /**
     * @maxLength 100
     */
    thread_name?: string; // Not implemented yet, for webhooks
    /**
     * @maxLength 2048
     */
    avatar_url?: string; // Not implemented yet, for webhooks
    encrypted?: E2eeEnvelope | null;
}

// TypeScript complains once this is used above
export interface PollCreationSchema {
    question: PollQuestionMedia;
    /**
     * @maxItems 10
     */
    answers: PollAnswerCreation[];
    /**
     * @minimum 1
     * @maximum 768
     */
    duration?: number;
    allow_multiselect?: boolean;
    layout_type?: number;
}

export interface MessageInteractionSchema {
    /**
     * @maxLength 64
     */
    id: string;
    type: InteractionType;
    /**
     * @maxLength 100
     */
    name: string;
    command_type?: ApplicationCommandType;
    ephemerality_reason?: number;
    user?: PublicUser; // It has to be optional cause LSP gives an errors for some reason
    /**
     * @maxLength 64
     */
    user_id?: string;
    authorizing_integration_owners?: object; // It has to be optional cause LSP gives an errors for some reason
    original_response_message_id?: Snowflake;
    interacted_message_id?: Snowflake;
    triggering_interaction_metadata?: MessageInteractionSchema;
    target_user?: PublicUser;
    target_message_id?: Snowflake;
}
