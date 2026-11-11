import { MessageCreateSchema } from "./MessageCreateSchema";

export type MessageEditSchema = Omit<MessageCreateSchema, "type" | "content"> & {
    /**
     * @maxLength 4000
     */
    content?: string | null;
};
