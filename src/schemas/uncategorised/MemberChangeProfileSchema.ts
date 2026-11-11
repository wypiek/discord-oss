import { ProfileCollectibleSkuList, ProfileThemeColorList } from "@spacebar/schemas";

export interface MemberChangeProfileSchema {
    banner?: string | null;
    /**
     * @maxLength 32
     */
    nick?: string | null;
    /**
     * @maxLength 190
     */
    bio?: string | null;
    /**
     * @maxLength 40
     */
    pronouns?: string | null;
    theme_colors?: ProfileThemeColorList | null;
    accent_color?: number | null;
    /**
     * @maxLength 64
     */
    profile_effect_id?: string | null;
    collectibles_sku_ids?: ProfileCollectibleSkuList | null;
    /**
     * @maxLength 64
     */
    popout_animation_particle_type?: string | null;
    /**
     * @maxLength 64
     */
    emoji_id?: string | null;
}
