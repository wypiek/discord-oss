export interface TotpSchema {
    /**
     * @maxLength 16
     */
    code: string;
    /**
     * @maxLength 2048
     */
    ticket: string;
    /**
     * @maxLength 64
     */
    gift_code_sku_id?: string | null;
    /**
     * @maxLength 64
     */
    login_source?: string | null;
}
