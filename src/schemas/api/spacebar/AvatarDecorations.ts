import { PartialUser, Snowflake } from "@spacebar/schemas";

export type PublicAvatarDecorationListResponse = PublicAvatarDecorationResponse[];
export type PrivateAvatarDecorationListResponse = PrivateAvatarDecorationResponse[];
export interface PublicAvatarDecorationResponse {
    id: Snowflake;
    approved: boolean;
    uploader: PartialUser;
    public: boolean;
    available: boolean;
}

export interface PrivateAvatarDecorationResponse extends PublicAvatarDecorationResponse {
    allowed_user_ids: Snowflake[];
    allowed_guild_ids: Snowflake[];
    allowed_role_ids: Snowflake[];
}

export interface AvatarDecorationIdChanges {
    /**
     * @TJS-type array
     * @maxItems 100
     * @items.type string
     * @items.maxLength 20
     */
    add?: Snowflake[];
    /**
     * @TJS-type array
     * @maxItems 100
     * @items.type string
     * @items.maxLength 20
     */
    remove?: Snowflake[];
}

export interface UpdateAvatarDecorationSchema {
    public?: boolean;
    allowed_user_ids?: AvatarDecorationIdChanges;
    allowed_guild_ids?: AvatarDecorationIdChanges;
    allowed_role_ids?: AvatarDecorationIdChanges;
}
