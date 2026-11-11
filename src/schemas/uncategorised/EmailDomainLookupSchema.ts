export interface EmailDomainLookupSchema {
    allow_multiple_guilds: boolean;
    /**
     * @maxLength 254
     */
    email: string;
    use_verification_code: boolean;
    /**
     * @maxLength 20
     */
    guild_id?: string;
}
