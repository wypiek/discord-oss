export interface EmailDomainLookupVerifyCodeSchema {
    /**
     * @maxLength 254
     */
    email: string;
    /**
     * @maxLength 20
     */
    guild_id: string;
    /**
     * @maxLength 16
     */
    code: string;
}
