import { PreloadChannelIdList } from "@spacebar/schemas";

export interface PreloadMessagesRequestSchema {
    channels?: PreloadChannelIdList;
    channel_ids?: PreloadChannelIdList;
}
