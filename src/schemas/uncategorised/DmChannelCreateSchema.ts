import { ShortIdList, TokenList } from "../api/users/CappedLists";
export interface DmChannelCreateSchema {
    /**
     * @maxLength 100
     */
    name?: string;
    /**
     * @maxItems 1000
     */
    recipients?: ShortIdList;
    /**
     * @maxLength 64
     */
    recipient_id?: string;
    /**
     * @maxItems 100
     */
    access_tokens?: TokenList; //Ignored in Spacebar for now, but makes bots happy
}
