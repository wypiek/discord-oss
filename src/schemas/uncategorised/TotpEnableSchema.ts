export interface TotpEnableSchema {
    /**
     * @minLength 1
     * @maxLength 72
     */
    password: string;
    /**
     * @minLength 6
     * @maxLength 6
     */
    code?: string;
    secret?: string;
}
