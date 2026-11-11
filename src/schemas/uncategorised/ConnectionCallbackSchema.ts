export interface ConnectionCallbackSchema {
    /**
     * @maxLength 2048
     */
    code?: string;
    /**
     * @maxLength 512
     */
    state: string;
    insecure: boolean;
    friend_sync: boolean;
    openid_params?: unknown; // TODO: types
}
