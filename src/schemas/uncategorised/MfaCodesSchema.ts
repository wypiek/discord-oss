export interface MfaCodesSchema {
    /**
     * @minLength 1
     * @maxLength 72
     */
    password: string;
    regenerate?: boolean;
}
