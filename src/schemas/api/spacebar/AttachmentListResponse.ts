import { MessageReferenceIds, PublicAttachment } from "@spacebar/schemas";

export interface AttachmentListResponse {
    items: {
        attachment: PublicAttachment;
        message_reference: MessageReferenceIds;
    }[];
    total: number;
}
