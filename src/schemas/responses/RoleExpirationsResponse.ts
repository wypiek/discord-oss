export interface RoleExpirationResponse {
    guild_id: string;
    user_id: string;
    role_id: string;
    expires_at: string;
    assigned_by: string | null;
    created_at: string;
}

export type RoleExpirationsResponse = RoleExpirationResponse[];
