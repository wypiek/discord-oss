export interface WebhookCreateSchema {
    /**
     * @minLength 1
     * @maxLength 80
     */
    name: string;
    avatar?: string;
}
