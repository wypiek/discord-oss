export interface LoginSchema {
    /**
     * @maxLength 320
     */
    login: string;
    /**
     * @minLength 1
     * @maxLength 72
     */
    password: string;
    undelete?: boolean;
    /**
     * @maxLength 16384
     */
    captcha_key?: string;
    /**
     * @maxLength 64
     */
    login_source?: string;
    /**
     * @maxLength 64
     */
    gift_code_sku_id?: string;
}
