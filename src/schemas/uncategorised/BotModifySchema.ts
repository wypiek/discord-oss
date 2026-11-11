export interface BotModifySchema {
    avatar?: string;
    /**
     * @minLength 2
     * @maxLength 32
     */
    username?: string;
    banner?: string;
}
