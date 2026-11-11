import { ShortIdList } from "../api/users/CappedLists";

export interface BulkDeleteSchema {
    /**
     * @minItems 2
     * @maxItems 1000
     */
    messages: ShortIdList;
}
