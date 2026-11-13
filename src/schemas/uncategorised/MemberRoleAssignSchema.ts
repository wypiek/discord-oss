export interface MemberRoleAssignSchema {
    /**
     * @maxLength 64
     */
    expires_at?: string | null;
    /**
     * @minimum 60
     * @maximum 31536000
     */
    duration_seconds?: number | null;
}
