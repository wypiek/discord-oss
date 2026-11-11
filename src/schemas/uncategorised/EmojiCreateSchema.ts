import { GuildIdList } from "./GuildCappedLists";

export interface EmojiCreateSchema {
    /**
     * @maxLength 32
     */
    name?: string;
    image: string;
    require_colons?: boolean | null;
    /**
     * @maxItems 1000
     */
    roles?: GuildIdList;
}
