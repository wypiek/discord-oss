export interface ConnectionCallbackSchema {
    /**
     * @maxLength 2048
     */
    code?: string;
    /**
     * @maxLength 512
     */
    state: string;
    /**
     * @maxLength 512
     */
    iss?: string;
    insecure?: boolean;
    friend_sync?: boolean;
    openid_params?: { [key: string]: string };
}
