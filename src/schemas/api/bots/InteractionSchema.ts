import { AllowedMentions, ApplicationCommandOption, Embed, Snowflake, UploadAttachmentRequestSchema } from "@spacebar/schemas";

export interface InteractionSchema {
    type: InteractionType;
    application_id: Snowflake;
    guild_id?: Snowflake;
    channel_id: Snowflake;
    message_id?: Snowflake;
    message_flags?: number;
    session_id?: string;
    data: InteractionData;
    files?: object[]; // idk the type
    nonce?: string;
    analytics_location?: string;
    section_name?: string;
    source?: string;
}

interface InteractionData {
    application_command: object;
    attachments: UploadAttachmentRequestSchema[];
    id: string;
    name: string;
    options: ApplicationCommandOption[];
    type: number;
    version: string;
}

export interface Interaction {
    id: string;
    type: InteractionType;
    data?: object; // TODO typing
    guild_id: string;
    channel_id: string;
    member_id: string;
    token: string;
    version: number;
}

export enum InteractionType {
    Ping = 1,
    ApplicationCommand = 2,
    MessageComponent = 3,
    ApplicationCommandAutocomplete = 4,
    ModalSubmit = 5,
}

export enum InteractionResponseType {
    SelfCommandResponse = 0,
    Pong = 1,
    Acknowledge = 2,
    ChannelMessage = 3,
    ChannelMessageWithSource = 4,
    AcknowledgeWithSource = 5,
}

export interface InteractionApplicationCommandCallbackData {
    tts?: boolean;
    content: string;
    embeds?: Embed[];
    allowed_mentions?: AllowedMentions;
}
