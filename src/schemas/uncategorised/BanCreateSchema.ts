export interface BanCreateSchema {
    delete_message_seconds?: number;
    delete_message_days?: number;
    /**
     * @maxLength 512
     */
    reason?: string;
}
