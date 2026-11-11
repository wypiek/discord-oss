export interface UploadAttachmentRequestSchema {
    /**
     * @maxItems 100
     */
    files: UploadAttachmentRequest[];
}

export interface UploadAttachmentRequest {
    /**
     * @maxLength 64
     */
    id?: string;
    /**
     * @minLength 1
     * @maxLength 1024
     */
    filename: string;
    file_size: number;
    is_clip?: boolean;
    /**
     * @maxLength 255
     */
    original_content_type?: string;
}
