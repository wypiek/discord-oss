export interface InviteCreateSchema {
    /**
     * @maxLength 20
     */
    target_user_id?: string;
    /**
     * @maxLength 32
     */
    target_type?: string;
    /**
     * @maxLength 32
     */
    validate?: string; // ? what is this
    max_age?: number;
    max_uses?: number;
    temporary?: boolean;
    unique?: boolean;
    /**
     * @maxLength 20
     */
    target_user?: string;
    target_user_type?: number;
    flags?: number;
}
