export interface ForgotPasswordSchema {
    /**
     * @maxLength 320
     */
    login: string;
    /**
     * @maxLength 16384
     */
    captcha_key?: string;
}
