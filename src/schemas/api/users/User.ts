import { base64str, ConnectedAccountSchema, ProfileCollectibleSkuList, ProfileThemeColorList, Snowflake, UserSettingsSchema } from "@spacebar/schemas";
// TODO: maybe move the one thing this depends on to
import { BitField } from "@spacebar/util/util";
// TODO: remove entity import
import { Relationship, Session } from "@spacebar/database/entities";

interface UserEntityPleaseRewriteThankYou {
    id: Snowflake;
    username: string;
    discriminator: string;
    global_name?: string | null;
    avatar?: string;
    accent_color?: number;
    banner?: string;
    theme_colors?: number[];
    pronouns?: string;
    phone?: string;
    desktop: boolean;
    mobile: boolean;
    premium: boolean;
    premium_type: number;
    bot: boolean;
    bio: string;
    system: boolean;
    nsfw_allowed: boolean;
    mfa_enabled: boolean;
    webauthn_enabled: boolean;
    created_at: Date;
    premium_since: Date;
    verified: boolean;
    disabled: boolean;
    deleted: boolean;
    email?: string;
    flags: number;
    public_flags: number;
    purchased_flags: number;
    premium_usage_flags: number;
    rights: string;
    sessions: Session[];
    relationships: Relationship[];
    connected_accounts: ConnectedAccountSchema[];
    fingerprints: string[];
    settings?: UserSettingsSchema;
    badge_ids?: string[];
    avatar_decoration_data?: AvatarDecorationData;
    display_name_styles?: DisplayNameStyle;
    collectibles?: Collectibles;
    primary_guild?: PrimaryGuild;
    profile_collectibles?: ProfileCollectible[] | null;
    avatar_corner_radius?: number | null;
}

export interface PartialUser {
    id: Snowflake;
    username: string;
    discriminator: string;
    global_name?: string | null;
    avatar: string | null;
    avatar_decoration_data?: AvatarDecorationData | null;
    collectibles?: Collectibles | null;
    display_name_styles?: DisplayNameStyle | null;
    primary_guild?: PrimaryGuild | null;
    bot?: boolean;
    system?: boolean;
    banner?: string | null;
    accent_color?: number | null;
    public_flags?: number;
    avatar_corner_radius?: number | null;
}

export interface AvatarDecorationData {
    asset: string;
    sku_id: Snowflake;
    expires_at: string | null;
}

export interface RecentAvatar {
    id: Snowflake;
    storage_hash: string;
    description: string | null;
}

export interface ProfileCollectible {
    sku_id: Snowflake;
    type: number;
    expires_at: string | null;
}

export interface Collectibles {
    nameplate: NameplateData | null;
}

export interface NameplateData {
    asset: string;
    sku_id: Snowflake;
    label: string;
    palette: string;
    expires_at: number | null;
}

export interface DisplayNameStyle {
    font_id: number;
    effect_id: number;
    colors: number[];
}

export interface PrimaryGuild {
    identity_enabled: boolean | null;
    identity_guild_id: Snowflake | null;
    tag: string | null;
    badge: string | null;
}

export enum PublicUserEnum {
    username,
    discriminator,
    global_name,
    id,
    public_flags,
    avatar,
    accent_color,
    banner,
    bio,
    bot,
    system,
    premium_since,
    premium_type,
    theme_colors,
    pronouns,
    badge_ids,
    avatar_decoration_data,
    display_name_styles,
    collectibles,
    primary_guild,
    avatar_corner_radius,
}
export type PublicUserKeys = keyof typeof PublicUserEnum;

export enum PrivateUserEnum {
    flags,
    mfa_enabled,
    email,
    phone,
    verified,
    nsfw_allowed,
    premium,
    premium_type,
    purchased_flags,
    premium_usage_flags,
    disabled,
    settings,
    // locale
}

export type PrivateUserKeys = keyof typeof PrivateUserEnum | PublicUserKeys;

export const PublicUserProjection = Object.values(PublicUserEnum).filter((x) => typeof x === "string") as PublicUserKeys[];
export const PrivateUserProjection = [...PublicUserProjection, ...Object.values(PrivateUserEnum).filter((x) => typeof x === "string")] as PrivateUserKeys[];

// Private user data that should never get sent to the client
export type PublicUser = Pick<UserEntityPleaseRewriteThankYou, PublicUserKeys>;
export type PrivateUser = Pick<UserEntityPleaseRewriteThankYou, PrivateUserKeys>;

export interface UserPrivate extends Pick<UserEntityPleaseRewriteThankYou, PrivateUserKeys> {
    locale: string;
}

// This causes a failure in openapi.js...?
export class UserFlags extends BitField {
    static FLAGS = {
        DISCORD_EMPLOYEE: 1n << 0n,
        PARTNERED_SERVER_OWNER: 1n << 1n,
        HYPESQUAD_EVENTS: 1n << 2n,
        BUGHUNTER_LEVEL_1: 1n << 3n,
        MFA_SMS: 1n << 4n,
        PREMIUM_PROMO_DISMISSED: 1n << 5n,
        HOUSE_BRAVERY: 1n << 6n,
        HOUSE_BRILLIANCE: 1n << 7n,
        HOUSE_BALANCE: 1n << 8n,
        EARLY_SUPPORTER: 1n << 9n,
        TEAM_USER: 1n << 10n,
        TRUST_AND_SAFETY: 1n << 11n,
        SYSTEM: 1n << 12n,
        HAS_UNREAD_URGENT_MESSAGES: 1n << 13n,
        BUGHUNTER_LEVEL_2: 1n << 14n,
        UNDERAGE_DELETED: 1n << 15n,
        VERIFIED_BOT: 1n << 16n,
        EARLY_VERIFIED_BOT_DEVELOPER: 1n << 17n,
        CERTIFIED_MODERATOR: 1n << 18n,
        BOT_HTTP_INTERACTIONS: 1n << 19n,
        SPAMMER: 1n << 20n,
        // @deprecated
        DISABLE_PREMIUM: 1n << 21n,
        ACTIVE_DEVELOPER: 1n << 22n,
        PROVISIONAL_ACCOUNT: 1n << 23n,
        // Where did 24-32 go???
        // spacebar-only: name tags drawn by the patched client, kept under bit 31 so 32-bit flag checks in clients still see them.
        // OFFICIAL_TAG and SYSTEM_TAG show the ✓ OFFICIAL and ✓ SYSTEM tags, AI_ACCOUNT the green AI tag instead of BOT
        OFFICIAL_TAG: 1n << 28n,
        SYSTEM_TAG: 1n << 29n,
        AI_ACCOUNT: 1n << 30n,
        HIGH_GLOBAL_RATE_LIMIT: 1n << 33n,
        DELETED: 1n << 34n,
        DISABLED_SUSPICIOUS_ACCOUNT: 1n << 35n,
        SELF_DELETED: 1n << 36n,
        PREMIUM_DISCIRMINATOR: 1n << 37n,
        USED_DESKTOP_CLIENT: 1n << 38n,
        USED_WEB_CLIENT: 1n << 39n,
        USED_MOBILE_CLIENT: 1n << 40n,
        DISABLED: 1n << 41n,
        // 42 is unknown...
        HAS_SESSION_STARTED: 1n << 43n,
        QUARANTINED: 1n << 44n,
        // 45 and 46 are unknown...
        PREMIUM_ELEGIBLE_FOR_UNIQUE_USERNAME: 1n << 47n,
        // 48 and 49 are unknown...
        COLLABORATOR: 1n << 50n,
        RESTRICTED_COLLABORATOR: 1n << 51n,
    };
}

// OAuth2 only (account.global_name.update) - why can this be null?
export class UserAccountModifySchema {
    /**
     * @maxLength 32
     */
    global_name?: string | null;
}

export class UserProfileModifySchema {
    /**
     * @maxLength 40
     */
    pronouns?: string | null;
    /**
     * @maxLength 190
     */
    bio?: string | null;
    banner?: base64str | null;
    accent_color?: number | null;
    theme_colors?: ProfileThemeColorList | null;
    //@deprecated - what even was this
    /**
     * @maxLength 64
     */
    popout_animation_particle_type?: Snowflake | null;
    //@deprecated - what even was this
    /**
     * @maxLength 64
     */
    emoji_id?: Snowflake | null;
    /**
     * @maxLength 64
     */
    profile_effect_id?: Snowflake | null;
    collectibles_sku_ids?: ProfileCollectibleSkuList | null;
}
