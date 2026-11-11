export interface VoiceStateModifySchema {
    /**
     * @maxLength 20
     */
    channel_id?: string;
    suppress?: boolean;
    /**
     * @maxLength 64
     */
    request_to_speak_timestamp?: string | null;
    silent?: boolean;
    self_video?: boolean;
    self_stream?: boolean;
}
