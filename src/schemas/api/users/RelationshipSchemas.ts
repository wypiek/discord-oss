import { PartialUser, Snowflake } from "@spacebar/schemas";
import { Relation } from "typeorm";

export interface PartialRelationshipSchema {
    id: Snowflake;
    type: RelationshipType;
    nickname: string | null;
    since?: Date;
    stranger_request?: boolean;
    user_ignored: boolean;
}

export type RelationshipListSchema = RelationshipSchema[];
export interface RelationshipSchema {
    id: Snowflake;
    type: RelationshipType;
    user: PartialUser;
    nickname: string | null;
    is_spam_request?: boolean;
    stranger_request?: boolean;
    user_ignored: boolean;
    origin_application_id?: Snowflake | null;
    since?: Date;
    has_played_game?: boolean;
    note?: string;
}

export interface SendRelationshipRequestSchema {
    /**
     * @maxLength 32
     */
    username: string;
    /**
     * @maxLength 4
     */
    discriminator: string | null; // null if pomelo
    /**
     * @maxLength 120
     */
    note?: string | null;
}

export interface RelationshipCreateSchema {
    type?: RelationshipType;
    from_friend_suggestion?: boolean;
    confirm_stranger_request?: boolean;
    /**
     * @maxLength 120
     */
    note?: string | null;
}

export interface RelationshipModifySchema {
    /**
     * @maxLength 32
     */
    nickname?: string;
}

export enum RelationshipType {
    CREATE_OR_ACCEPT_REQUEST = -1,
    NONE = 0,
    FRIEND = 1,
    BLOCKED = 2,
    INCOMING_REQUEST = 3,
    OUTGOING_REQUEST = 4,
    IMPLICIT = 5,
    // @deprecated
    SUGGESTION = 6,
}

export interface UserMutualRelationResponse {
    id: string;
    username: string;
    discriminator: string;
    avatar?: string;
    public_flags: number;
}

export type UserMutualRelationsResponse = UserMutualRelationResponse[];
