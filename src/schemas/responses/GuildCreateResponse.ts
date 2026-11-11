import { GuildUpdateSchema, GuildWelcomeScreen } from "@spacebar/schemas";

export interface GuildCreateResponse extends Omit<GuildUpdateSchema, "name"> {
    id: string;
    name: string;
    large?: boolean;
    max_members?: number;
    max_presences?: number;
    max_video_channel_users?: number;
    member_count?: number;
    presence_count?: number;
    mfa_level?: number;
    owner_id?: string;
    premium_subscription_count?: number;
    premium_tier?: number;
    welcome_screen: GuildWelcomeScreen;
    widget_channel_id?: string | null;
    widget_enabled: boolean;
    nsfw_level?: number;
    nsfw: boolean;
    parent?: string;
}
