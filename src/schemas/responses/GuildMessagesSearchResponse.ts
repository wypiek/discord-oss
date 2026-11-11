import { BaseMessageComponents, Embed, MessageType, Poll, PublicUser, RoleResponse, PublicAttachment } from "@spacebar/schemas";

export interface GuildMessagesSearchMessage {
    id: string;
    type: MessageType;
    content?: string;
    channel_id: string;
    author: PublicUser;
    attachments: PublicAttachment[];
    embeds: Embed[];
    mentions: PublicUser[];
    mention_roles: RoleResponse[];
    pinned: boolean;
    mention_everyone?: boolean;
    tts: boolean;
    timestamp: string;
    edited_timestamp: string | null;
    flags: number;
    components: BaseMessageComponents[];
    poll: Poll;
    hit: true;
}

export interface GuildMessagesSearchResponse {
    messages: GuildMessagesSearchMessage[];
    total_results: number;
}
