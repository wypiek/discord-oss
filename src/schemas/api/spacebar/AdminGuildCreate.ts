import { AdminChannelUpdateSchema, AdminRoleUpdateSchema } from "./Admin";

export interface AdminChannelCreateSchema extends AdminChannelUpdateSchema {
    /** @minLength 1
     * @maxLength 100 */
    name: string;
    type?: 0 | 2 | 4 | 5 | 13 | 15 | 16;
    /** @pattern ^[0-9]{15,20}$ */
    parent_id?: string | null;
    /** @minimum 8000
     * @maximum 384000
     * @TJS-type integer */
    bitrate?: number;
    /** @minimum 0
     * @maximum 99
     * @TJS-type integer */
    user_limit?: number;
}

export interface AdminRoleCreateSchema extends AdminRoleUpdateSchema {
    /** @minLength 1
     * @maxLength 100 */
    name: string;
}
