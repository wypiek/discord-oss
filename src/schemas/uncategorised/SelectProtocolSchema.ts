export interface SelectProtocolSchema {
    protocol: "webrtc" | "udp";
    data:
        | string
        | {
              /**
               * @maxLength 64
               */
              address: string;
              port: number;
              /**
               * @maxLength 64
               */
              mode: string;
          };
    /**
     * @maxLength 65536
     */
    sdp?: string;
    /**
     * @maxItems 32
     */
    codecs?: {
        /**
         * @maxLength 32
         */
        name: string;
        type: "audio" | "video";
        priority: number;
        payload_type: number;
        rtx_payload_type?: number;
    }[];
    /**
     * @maxLength 64
     */
    rtc_connection_id?: string; // uuid
    /**
     * @TJS-type array
     * @maxItems 64
     * @items.type string
     * @items.maxLength 128
     */
    experiments?: string[];
}
