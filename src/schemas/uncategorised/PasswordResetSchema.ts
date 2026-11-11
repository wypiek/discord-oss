export interface PasswordResetSchema {
    /**
     * @minLength 1
     * @maxLength 72
     */
    password: string;
    /**
     * @maxLength 2048
     */
    token: string;
}
