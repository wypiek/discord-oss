export interface RegisterSchema {
    /**
     * @minLength 2
     * @maxLength 32
     */
    username?: string;
    /**
     * @minLength 1
     * @maxLength 72
     */
    password?: string;
    consent: boolean;
    /**
     * @TJS-format email
     * @maxLength 254
     */
    email?: string;
    /**
     * @maxLength 128
     */
    fingerprint?: string;
    /**
     * @maxLength 64
     */
    invite?: string;
    /**
     * Instance invite code, needed when the instance is invite-only
     * @maxLength 64
     */
    instance_invite?: string;
    /**
     * @TJS-type string
     * @maxLength 32
     */
    date_of_birth?: Date; // "2000-04-03"
    /**
     * @maxLength 64
     */
    gift_code_sku_id?: string;
    /**
     * @maxLength 16384
     */
    captcha_key?: string;

    promotional_email_opt_in?: boolean;

    // part of pomelo
    unique_username_registration?: boolean;
    /**
     * @maxLength 32
     */
    global_name?: string;
    pride_badges?: string[];
    /**
     * Why the person wants to join, when the instance asks for it
     * @maxLength 4000
     */
    join_reason?: string;
}
