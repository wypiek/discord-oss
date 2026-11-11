export interface VerifyEmailSchema {
    /**
     * @maxLength 16384
     */
    captcha_key?: string | null;
    /**
     * @maxLength 2048
     */
    token: string;
}
