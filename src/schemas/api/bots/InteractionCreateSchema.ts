import { PublicMember, PublicUser, Snowflake, InteractionType, PublicMessage, PublicChannel } from "@spacebar/schemas";

export interface InteractionCreateSchema {
    version: number; // TODO: types?
    id: Snowflake;
    application_id: Snowflake;
    type: InteractionType;
    token: string;
    data?: object; // TODO: types?
    guild?: InteractionGuild;
    guild_id?: Snowflake;
    guild_locale?: string;
    channel?: PublicChannel;
    channel_id?: Snowflake;
    member?: PublicMember;
    user?: PublicUser;
    locale?: string;
    message?: PublicMessage;
    app_permissions: string;
    entitlements?: object[]; // TODO: types?
    entitlement_sku_ids?: Snowflake[]; // DEPRECATED
    authorizing_integration_owners?: Record<number, Snowflake>; // TODO: types?
    context?: number;
    attachment_size_limit: number;
}

interface InteractionGuild {
    id: Snowflake;
    features: string[];
    locale: string;
}
