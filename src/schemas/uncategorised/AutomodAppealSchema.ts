export interface AutomodAppealSchema {
    /**
     * @maxLength 320
     */
    login: string;
    /**
     * @minLength 1
     * @maxLength 72
     */
    password: string;
    /**
     * @maxLength 1000
     */
    message?: string;
    /**
     * @maxLength 4096
     */
    ticket?: string;
    method?: "totp" | "backup" | "webauthn";
    /**
     * @maxLength 16
     */
    code?: string;
    /**
     * @maxLength 4096
     */
    appeal_ticket?: string;
}
