import { UploadAttachmentRequestSchema } from "@spacebar/schemas";
import { Snowflake } from "../../Identifiers";

export interface SendableModalSubmitDataSchema {
    id: Snowflake;
    custom_id: string;
    // components: ModalSubmitComponentData[]; // TODO: do this
    attachments?: UploadAttachmentRequestSchema[];
}
