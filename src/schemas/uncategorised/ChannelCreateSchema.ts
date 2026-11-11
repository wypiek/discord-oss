import { ChannelModifySchema } from "./ChannelModifySchema";
import { TagCreateSchema } from "./TagCreateSchema";

export type ChannelCreateSchema = Omit<ChannelModifySchema, "available_tags" | "owner">;

export type GuildChannelCreateSchema = ChannelCreateSchema & {
    /**
     * @maxItems 20
     */
    available_tags?: TagCreateSchema[];
};
