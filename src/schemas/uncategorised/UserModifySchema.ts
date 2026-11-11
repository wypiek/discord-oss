// TODO: dedicated schemas?
import { User_DisplayNameEffect, User_DisplayNameFont } from "discord-protos";
import { DisplayNameColorList } from "@spacebar/schemas";

export interface UserModifySchema {
    /**
     * @minLength 2
     * @maxLength 32
     */
    username?: string;
    /**
     * @maxLength 32
     */
    global_name?: string | null;
    avatar?: string | null;
    /**
     * @maxLength 1024
     */
    avatar_description?: string | null;
    /**
     * @maxLength 190
     */
    bio?: string;
    accent_color?: number;
    banner?: string | null;
    /**
     * @minLength 1
     * @maxLength 72
     */
    password?: string;
    /**
     * @minLength 1
     * @maxLength 72
     */
    new_password?: string;
    /**
     * @minLength 6
     * @maxLength 6
     */
    code?: string;
    /**
     * @TJS-format email
     * @maxLength 254
     */
    email?: string;
    /**
     * @minLength 4
     * @maxLength 4
     */
    discriminator?: string;

    /**
     * @maxLength 64
     */
    avatar_id?: string | null;
    /**
     * @maxLength 256
     */
    email_token?: string;
    /**
     * @maxLength 37
     */
    legacy_username?: string | null;
    /**
     * @maxLength 32
     */
    date_of_birth?: string;
    flags?: number;

    display_name_colors?: DisplayNameColorList | null;
    display_name_effect_id?: User_DisplayNameEffect | null;
    display_name_font_id?: User_DisplayNameFont | null;

    /**
     * @maxLength 64
     */
    avatar_decoration_id?: string | null;
    /**
     * @maxLength 64
     */
    avatar_decoration_sku_id?: string | null;
    /**
     * @maxLength 64
     */
    nameplate_sku_id?: string | null;
    /**
     * @minimum 0
     * @maximum 50
     */
    avatar_corner_radius?: number | null;
    /**
     * @maxLength 64
     */
    primary_guild_id?: string | null;
    vad_colors?: DisplayNameColorList | null;
    typing_indicator_style?: number | null;

    /**
     * @maxLength 32
     */
    push_provider?: string;
    /**
     * @maxLength 4096
     */
    push_token?: string;
    /**
     * @maxLength 32
     */
    push_voip_provider?: string;
    /**
     * @maxLength 4096
     */
    push_voip_token?: string;
}
