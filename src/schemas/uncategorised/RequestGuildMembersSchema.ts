export interface RequestGuildMembersSchema {
    guild_id: string | [string];
    query?: string;
    limit?: number;
    presences?: boolean;
    user_ids?: string | string[];
    nonce?: string;
}

export const RequestGuildMembersSchema = {
    guild_id: "" as string | string[],
    $query: String,
    $limit: Number,
    $presences: Boolean,
    $user_ids: [] as string | string[],
    $nonce: String,
};
