import { EmojiResponse } from "@spacebar/schemas/api/guilds/Emoji";

export interface EmojiSourceResponse {
    type: "GUILD" | "APPLICATION";
    guild?: EmojiGuild | null;
    application?: EmojiApplication | null;
}

// keep in sync with
export interface EmojiGuild {
    id: string;
    name: string;
    icon?: string | null;
    description?: string | null;
    features: string[];
    emojis: EmojiResponse[];
    premium_tier: number;
    premium_subscription_count?: number;
    approximate_member_count?: number;
    approximate_presence_count?: number;
}

export interface EmojiApplication {
    id: string;
    name: string;
}
