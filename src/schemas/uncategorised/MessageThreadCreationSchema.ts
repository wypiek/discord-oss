export interface MessageThreadCreationSchema {
    auto_archive_duration?: number;
    rate_limit_per_user?: number;
    /**
     * @minLength 1
     * @maxLength 100
     */
    name: string;
    /**
     * @maxLength 64
     */
    location?: string; //ignore it
    type?: number;
}
