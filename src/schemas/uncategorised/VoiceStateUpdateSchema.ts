//TODO need more testing when community guild and voice stage channel are working
export interface VoiceStateUpdateSchema {
    guild_id?: string;
    channel_id?: string;
    self_mute: boolean;
    self_deaf: boolean;
    self_video?: boolean;
    preferred_region?: string;
    preferred_regions?: string[];
    tracks?: { type: string; rid: string; quality: number }[];
    request_to_speak_timestamp?: Date;
    suppress?: boolean;
    flags?: number;
}

export const VoiceStateUpdateSchema = {
    $guild_id: String,
    $channel_id: String,
    self_mute: Boolean,
    self_deaf: Boolean,
    $self_video: Boolean, //required in docs but bots don't always send it
    $preferred_region: String,
    $preferred_regions: [String],
    $tracks: [Object],
    $request_to_speak_timestamp: Date,
    $suppress: Boolean,
    $flags: Number,
};
