import assert from "node:assert/strict";
import { test } from "node:test";
import { ExternalRequestConfiguration, allowsCdnUpstream } from "./ExternalRequestConfiguration";

test("defaults proxy Discord assets and keep unrelated third parties opt-in", () => {
    const policy = new ExternalRequestConfiguration();
    assert.equal(policy.thirdParty, false);
    assert.ok(
        Object.entries(policy)
            .filter(([key]) => key !== "thirdParty")
            .every(([, enabled]) => enabled),
    );
    assert.equal(allowsCdnUpstream(policy, "https://example.com/image.png"), false);
    for (const path of [
        "avatar-decoration-presets/a_0123456789.png",
        "assets/collectibles/nameplates/video.webm",
        "assets/profile_effects/effect.png",
        "media/v1/collectibles-shop/123/static",
        "stickers/123.png",
        "bad-domains/hashes.json",
        "assets/content/image.png",
        "app-icons/123/hash.png",
        "soundboard-sounds/123",
    ])
        assert.equal(allowsCdnUpstream(policy, `https://cdn.discordapp.com/${path}`), true, path);
});

test("turning the fallback off blocks non decoration assets", () => {
    const policy = new ExternalRequestConfiguration();
    policy.discordAssetFallback = false;
    policy.discordStickerPacks = false;
    for (const path of ["stickers/123.png", "bad-domains/hashes.json", "assets/content/image.png", "app-icons/123/hash.png", "soundboard-sounds/123"])
        assert.equal(allowsCdnUpstream(policy, `https://cdn.discordapp.com/${path}`), false, path);
    assert.equal(allowsCdnUpstream(policy, "https://cdn.discordapp.com/avatar-decoration-presets/a_0123456789.png"), true);
});

test("decoration exception cannot bypass origin, transport or path restrictions", () => {
    const policy = Object.assign(new ExternalRequestConfiguration(), {
        discordAssetFallback: false,
        discordClientAssets: false,
        discordGames: false,
        discordTemplates: false,
        discordStickerPacks: false,
        discordBadDomains: false,
        thirdParty: false,
    });
    for (const url of [
        "https://example.com/avatar-decoration-presets/image.png",
        "https://cdn.discordapp.com.example.com/avatar-decoration-presets/image.png",
        "http://cdn.discordapp.com/avatar-decoration-presets/image.png",
        "https://user@cdn.discordapp.com/avatar-decoration-presets/image.png",
        "https://cdn.discordapp.com:8443/avatar-decoration-presets/image.png",
        "https://cdn.discordapp.com/avatar-decoration-presets/../stickers/123.png",
        "https://cdn.discordapp.com/avatar-decoration-presets/image%2fextra.png",
        "https://cdn.discordapp.com/avatar-decoration-presets/",
        "not a URL",
    ])
        assert.equal(allowsCdnUpstream(policy, url), false, url);
    policy.discordDecorations = false;
    policy.discordAssetFallback = true;
    policy.discordStickerPacks = true;
    assert.equal(allowsCdnUpstream(policy, "https://cdn.discordapp.com/avatar-decoration-presets/image.png"), false);
    assert.equal(allowsCdnUpstream(policy, "https://cdn.discordapp.com/stickers/123.png"), true);
    assert.equal(allowsCdnUpstream(policy, "https://example.com/stickers/123.png"), false);
});
