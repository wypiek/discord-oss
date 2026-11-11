export interface MessageAcknowledgeSchema {
    manual?: boolean;
    mention_count?: number;
    flags?: ReadStateFlags | 0;
    last_viewed?: number;
    /**
     * @maxLength 1024
     */
    token?: string;
}

export interface AckBulkSchema {
    /**
     * @maxItems 100
     */
    read_states: {
        /**
         * @maxLength 64
         */
        channel_id: string;
        /**
         * @maxLength 64
         */
        message_id: string;
        read_state_type: ReadStateType; // WHat is this?
    }[];
}

export interface AcknowledgeDeleteSchema {
    read_state_type?: ReadStateType;
    version?: number;
}

export enum ReadStateType {
    CHANNEL = 0,
    GUILD_EVENT = 1,
    NOTIFICATION_CENTER = 2,
    GUILD_HOME = 3,
    GUILD_ONBOARDING_QUESTION = 4,
    MESSAGE_REQUESTS = 5,
}

export enum ReadStateFlags {
    IS_GUILD_CHANNEL = 1 << 0,
    IS_THREAD = 1 << 1,
    IS_MENTION_LOW_IMPORTANCE = 1 << 2,
}
