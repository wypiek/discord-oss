import { MuteConfig, UserGuildSettings } from "@spacebar/schemas";

// This sucks. I would use a DeepPartial, my own or typeorms, but they both generate inncorect schema
export interface UserGuildSettingsSchema extends Partial<Omit<UserGuildSettings, "channel_overrides">> {
    channel_overrides?: {
        [channel_id: string]: ChannelOverrideSchema;
    };
}

export interface ChannelOverrideSchema {
    message_notifications?: number;
    mute_config?: MuteConfig | null;
    muted?: boolean;
    /**
     * @maxLength 64
     */
    channel_id?: string | null;
    collapsed?: boolean;
    flags?: number;
}
