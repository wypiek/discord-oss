import { IntegrationGuild, PartialUser, PublicUser, Snowflake } from "@spacebar/schemas";

export enum WebhookType {
    Incoming = 1,
    ChannelFollower = 2,
    Application = 3,
}

export interface WebhookCreateResponse {
    user: PublicUser;
    hook: WebhookResponse;
}

export type WebhookListResponse = WebhookResponse[];
export interface WebhookResponse {
    id: Snowflake;
    type: WebhookType;
    guild_id?: Snowflake | null;
    channel_id: Snowflake | null;
    user?: PartialUser | null;
    name: string | null;
    avatar: string | null;
    token?: string;
    application_id: Snowflake | null;
    source_guild?: IntegrationGuild;
    source_channel?: WebhookChannel;
    url?: string;
}

export interface WebhookChannel {
    id: Snowflake;
    name: string;
}
