import { GuildCreateResponse, RoleResponse, StickerResponse, EmojiResponse } from "@spacebar/schemas";

export interface MemberJoinGuildResponse {
    guild: GuildCreateResponse;
    emojis: EmojiResponse[];
    roles: RoleResponse[];
    stickers: StickerResponse[];
}
