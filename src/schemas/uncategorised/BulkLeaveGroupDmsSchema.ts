import { GuildIdList } from "./GuildCappedLists";

export interface BulkLeaveGroupDmsSchema {
    /**
     * @minItems 1
     * @maxItems 1000
     */
    channel_ids: GuildIdList;
}
