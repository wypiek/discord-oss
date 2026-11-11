import { GuildIdList } from "./GuildCappedLists";

export interface ApplicationEmojiModifySchema {
    /**
     * @minLength 2
     * @maxLength 32
     */
    name?: string;
}

export interface EmojiModifySchema {
    /**
     * @maxLength 32
     */
    name?: string;
    /**
     * @maxItems 1000
     */
    roles?: GuildIdList;
}
