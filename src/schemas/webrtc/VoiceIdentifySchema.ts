export interface VoiceIdentifySchema {
    /**
     * @maxLength 64
     */
    server_id: string;
    /**
     * @maxLength 64
     */
    user_id: string;
    /**
     * @maxLength 64
     */
    session_id: string;
    /**
     * @maxLength 64
     */
    channel_id?: string;
    /**
     * @maxLength 256
     */
    token: string;
    video?: boolean;
    /**
     * @maxItems 16
     */
    streams?: {
        type: "video" | "audio" | "screen";
        /**
         * @maxLength 16
         */
        rid: string;
        quality: number;
    }[];
    max_secure_frames_version?: number; // pre-release Dave max version field
    max_dave_protocol_version?: number; // final Dave max version field
}
