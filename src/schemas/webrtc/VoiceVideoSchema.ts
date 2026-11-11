export interface VoiceVideoSchema {
    audio_ssrc: number;
    video_ssrc: number;
    rtx_ssrc?: number;
    /**
     * @maxLength 64
     */
    user_id?: string;
    /**
     * @maxItems 16
     */
    streams?: {
        type: "video" | "audio" | "screen";
        /**
         * @maxLength 16
         */
        rid: string;
        ssrc?: number;
        active?: boolean;
        quality?: number;
        rtx_ssrc?: number;
        max_bitrate?: number;
        max_framerate?: number;
        max_resolution?: {
            /**
             * @maxLength 16
             */
            type: string;
            width: number;
            height: number;
        };
    }[];
}
