import { GuildIdList } from "./GuildCappedLists";

export interface PostDataSchema {
    /**
     * @maxItems 1000
     */
    thread_ids: GuildIdList;
}
