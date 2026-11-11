export class ExternalRequestConfiguration {
    discordDecorations: boolean = true;
    discordAssetFallback: boolean = true;
    discordClientAssets: boolean = true;
    discordGames: boolean = true;
    discordTemplates: boolean = true;
    discordStickerPacks: boolean = true;
    discordBadDomains: boolean = true;
    thirdParty: boolean = false;
}

export function isDiscordDecorationAsset(pathname: string): boolean {
    return ["/avatar-decoration-presets/", "/assets/collectibles/", "/assets/profile_effects/", "/media/v1/collectibles-shop/"].some(
        (prefix) => pathname.startsWith(prefix) && pathname.length > prefix.length,
    );
}

export function allowsCdnUpstream(policy: ExternalRequestConfiguration, raw: string): boolean {
    try {
        const url = new URL(raw);
        if (url.protocol !== "https:" || url.username || url.password || url.port || /%2f|%5c/i.test(url.pathname)) return false;
        if (url.hostname !== "cdn.discordapp.com") return policy.thirdParty;
        if (/^\/stickers\/\d+\.(?:png|json|gif)$/.test(url.pathname)) return policy.discordStickerPacks;
        return isDiscordDecorationAsset(url.pathname) ? policy.discordDecorations : policy.discordAssetFallback;
    } catch {
        return false;
    }
}
