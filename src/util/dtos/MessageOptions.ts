import { Embed, MessageCreateAttachment, MessageCreateCloudAttachment, MessageCreateSchema, MessageInteractionSchema, MessageType, Reaction } from "@spacebar/schemas";

export type MessageOptionAttachment = MessageCreateAttachment | MessageCreateCloudAttachment | InternalCdnAttachment;

export interface MessageOptions extends MessageCreateSchema {
    id?: string;
    type?: MessageType;
    pinned?: boolean;
    author_id?: string;
    webhook_id?: string;
    application_id?: string;
    interaction?: MessageInteractionSchema;
    interaction_metadata?: MessageInteractionSchema;
    embeds?: Embed[] | null;
    reactions?: Reaction[];
    channel_id?: string;
    attachments?: MessageOptionAttachment[];
    edited_timestamp?: Date;
    timestamp?: Date;
    username?: string;
    avatar_url?: string;
}

export interface InternalCdnAttachment {
    id: string;
    channel_id: string;
    message_id: string;
    content_type: string;
    filename: string;
    size: number;
    url: string;
    path: string;
    width?: number;
    height?: number;
}
