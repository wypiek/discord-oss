import { GuildIdList } from "./GuildCappedLists";

export interface BulkBanSchema {
    /**
     * @maxItems 1000
     */
    user_ids: GuildIdList;
    delete_message_seconds?: number;
}
