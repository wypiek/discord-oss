export interface UploadAttachmentResponseSchema {
    attachments: UploadAttachmentResponse[];
}

export interface UploadAttachmentResponse {
    id?: string;
    upload_url: string;
    upload_filename: string;
    original_content_type?: string;
}
