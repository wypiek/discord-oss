export interface MessageActivity {
    type: MessageActivityType;
    /**
     * @maxLength 128
     */
    session_id?: string;
    /**
     * @maxLength 128
     */
    party_id?: string;
    /**
     * @maxLength 128
     */
    name_override?: string;
    /**
     * @maxLength 2048
     */
    icon_override?: string;
}

export enum MessageActivityType {
    JOIN = 1,
    // @deprecated
    SPECTATE = 2,
    LISTEN = 3,
    // @deprecated
    WATCH = 4,
    JOIN_REQUEST = 5,
}
