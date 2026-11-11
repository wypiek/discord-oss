const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
    canonicalizeDecorations,
    collectibleSkus,
    DECORATION_ART_MAX_BYTES,
    decorationKey,
    localEffectArt,
    localizeDecorations,
    readDecoration,
    readNameplate,
    readRemoteDecoration,
    readRemoteDecorationItem,
    readRemoteNameplate,
    readRemoteProfileEffectItem,
    remoteDecorationSku,
    remoteSkuOrigin,
} = require("../../dist/util/util/federation/Decorations.js");
const { rewriteIncoming, rewriteOutgoing } = require("../../dist/util/util/federation/Ids.js");
const { federatedMediaKind, federatedMediaMaxBytes, federatedMediaType } = require("../../dist/util/util/federation/Media.js");

const SENDER = "cat.example";
const ASSET = "a_0123456789abcdef0123456789abcdef";
const SKU = "1300000000000000777";
const NOW = Date.parse("2026-10-15T12:00:00Z");

const resolverOf =
    (table, calls = []) =>
    async (wanted) => {
        calls.push(wanted);
        return new Map(
            wanted.flatMap((ref) => {
                const local = table[ref.instance === SENDER ? ref.sku : `${ref.instance}/${ref.sku}`];
                return local ? [[decorationKey(ref), local]] : [];
            }),
        );
    };

test("a decoration keeps only its asset, SKU and expiry", () => {
    assert.deepEqual(readDecoration({ asset: ASSET, sku_id: SKU, expires_at: null, url: "https://evil.example/x.png", label: "x" }, NOW), {
        asset: ASSET,
        sku_id: SKU,
        expires_at: null,
    });
    assert.deepEqual(readDecoration({ asset: "0123456789abcdef0123456789abcdef", sku_id: SKU }, NOW)?.expires_at, null);
});

test("assets that aren't a 32 character hex hash are refused", () => {
    for (const asset of [
        "../../etc/passwd",
        "a_0123456789ABCDEF0123456789ABCDEF",
        "a_0123456789abcdef0123456789abcde",
        "a_0123456789abcdef0123456789abcdef0",
        "https://evil.example/a.png",
        "a_0123456789abcdef0123456789abcdef.png",
        "nameplates/custom/1/",
        "",
        42,
        null,
    ])
        assert.equal(readDecoration({ asset, sku_id: SKU, expires_at: null }, NOW), null, String(asset));
});

test("SKUs that aren't snowflakes are refused", () => {
    for (const sku_id of ["", "abc", "123456789012345678901", "-1", "1e5", 1300000000, null, "@1@cat.example"])
        assert.equal(readDecoration({ asset: ASSET, sku_id, expires_at: null }, NOW), null, String(sku_id));
    for (const value of [null, undefined, "decoration", [ASSET, SKU], 5]) assert.equal(readDecoration(value, NOW), null);
});

test("expired decorations are dropped and live ones keep their expiry", () => {
    const seconds = Math.floor(NOW / 1000);
    assert.equal(readDecoration({ asset: ASSET, sku_id: SKU, expires_at: seconds - 1 }, NOW), null);
    assert.equal(readDecoration({ asset: ASSET, sku_id: SKU, expires_at: NOW - 1 }, NOW), null);
    assert.equal(readDecoration({ asset: ASSET, sku_id: SKU, expires_at: "2020-01-01T00:00:00Z" }, NOW), null);
    assert.equal(readDecoration({ asset: ASSET, sku_id: SKU, expires_at: "soon" }, NOW), null);
    assert.equal(readDecoration({ asset: ASSET, sku_id: SKU, expires_at: seconds + 60 }, NOW)?.expires_at, seconds + 60);
    assert.equal(readDecoration({ asset: ASSET, sku_id: SKU, expires_at: "2030-01-01T00:00:00Z" }, NOW)?.expires_at, "2030-01-01T00:00:00Z");
});

test("a remote SKU is a plain snowflake or a canonical id of the sender only", () => {
    assert.equal(remoteDecorationSku(SKU, SENDER), SKU);
    assert.equal(remoteDecorationSku(`@${SKU}@${SENDER}`, SENDER), SKU);
    assert.equal(remoteDecorationSku(`@${SKU}@dog.example`, SENDER), null);
    assert.equal(remoteDecorationSku(`@${SKU}@`, SENDER), null);
    assert.equal(remoteDecorationSku(undefined, SENDER), null);
    assert.deepEqual(readRemoteDecoration({ asset: ASSET, sku_id: `@${SKU}@${SENDER}`, expires_at: null }, SENDER, NOW), { asset: ASSET, sku_id: SKU, expires_at: null });
    assert.equal(readRemoteDecoration({ asset: ASSET, sku_id: `@${SKU}@dog.example`, expires_at: null }, SENDER, NOW), null);
});

test("decorations on users and members get this instance's SKU, with one lookup per SKU", async () => {
    const calls = [];
    const body = {
        author: { id: "1", username: "cat", avatar_decoration_data: { asset: ASSET, sku_id: SKU, expires_at: null } },
        member: { nick: "kit", avatar_decoration_data: { asset: ASSET, sku_id: `@${SKU}@${SENDER}`, expires_at: null } },
        mentions: [{ id: "2", username: "dog", avatar_decoration_data: { asset: ASSET, sku_id: "1144058522808614923", expires_at: null } }],
    };
    await localizeDecorations(body, SENDER, resolverOf({ [SKU]: "1560000000000000001", "1144058522808614923": "1144058522808614923" }, calls), NOW);
    assert.deepEqual(body.author.avatar_decoration_data, { asset: ASSET, sku_id: "1560000000000000001", expires_at: null });
    assert.deepEqual(body.member.avatar_decoration_data, { asset: ASSET, sku_id: "1560000000000000001", expires_at: null });
    assert.deepEqual(body.mentions[0].avatar_decoration_data, { asset: ASSET, sku_id: "1144058522808614923", expires_at: null });
    assert.equal(calls.length, 1);
    assert.deepEqual(
        calls[0].map((ref) => ref.sku),
        [SKU, "1144058522808614923"],
    );
});

test("junk, unmapped and expired decorations become null, and only valid ones are looked up", async () => {
    const calls = [];
    const body = {
        a: { avatar_decoration_data: { asset: "../x", sku_id: SKU } },
        b: { avatar_decoration_data: { asset: ASSET, sku_id: `@${SKU}@dog.example` } },
        c: { avatar_decoration_data: { asset: ASSET, sku_id: "1300000000000000999" } },
        d: { avatar_decoration_data: { asset: ASSET, sku_id: SKU, expires_at: 1 } },
        e: { avatar_decoration_data: "a_0123456789abcdef0123456789abcdef" },
        f: { avatar_decoration_data: null },
    };
    await localizeDecorations(body, SENDER, resolverOf({ [SKU]: "1560000000000000001" }, calls), NOW);
    for (const key of Object.keys(body)) assert.equal(body[key].avatar_decoration_data, null, key);
    assert.deepEqual(
        calls.flat().map((ref) => `${ref.instance}/${ref.sku}`),
        [`dog.example/${SKU}`, `${SENDER}/1300000000000000999`],
    );
});

test("a resolver that fails or answers with junk leaves no decoration", async () => {
    const failing = { avatar_decoration_data: { asset: ASSET, sku_id: SKU } };
    await localizeDecorations(failing, SENDER, async () => Promise.reject(new Error("quota")), NOW);
    assert.equal(failing.avatar_decoration_data, null);
    const junk = { avatar_decoration_data: { asset: ASSET, sku_id: SKU } };
    await localizeDecorations(junk, SENDER, async (wanted) => new Map(wanted.map((ref) => [decorationKey(ref), "../../x"])), NOW);
    assert.equal(junk.avatar_decoration_data, null);
});

test("payloads without decorations are left alone and never call the resolver", async () => {
    const body = { id: "1", content: "avatar_decoration_data", nested: [{ avatar: null }] };
    await localizeDecorations(body, SENDER, () => assert.fail("no lookup expected"), NOW);
    assert.deepEqual(body, { id: "1", content: "avatar_decoration_data", nested: [{ avatar: null }] });
});

test("the id rewriter leaves decoration SKUs alone in both directions", () => {
    const decoration = { asset: ASSET, sku_id: "1144058522808614923", expires_at: null };
    const outgoing = rewriteOutgoing({ user: { id: "1144058522808614000", username: "cat", avatar: null, avatar_decoration_data: decoration } }, new Map(), "home.example");
    assert.equal(outgoing.user.id, "@1144058522808614000@home.example");
    assert.deepEqual(outgoing.user.avatar_decoration_data, decoration);
    const incoming = rewriteIncoming(outgoing, new Map([["@1144058522808614000@home.example", "555"]]), "away.example");
    assert.equal(incoming.user.id, "555");
    assert.deepEqual(incoming.user.avatar_decoration_data, decoration);
});

test("shop art by SKU is federated media, other shop art isn't", () => {
    for (const slot of ["animated", "static", "video", "effect", "thumbnail", "reduced"])
        assert.equal(federatedMediaKind(`/media/v1/collectibles-shop/1300000000000000777/${slot}`), "collectible", slot);
    for (const path of [
        "/media/v1/collectibles-shop/1300000000000000777/banner",
        "/media/v1/collectibles-shop/1300000000000000777/1300000000000000778/static",
        "/media/v1/collectibles-shop/nameplates/custom/1/static.png",
        "/media/v1/collectibles-shop/abc/animated",
        "/media/v1/collectibles-shop/1/../../../api/v9/users/@me",
        "/media/v1/collectibles-shop/1%2fanimated",
        "/media/v1/collectibles-shop/1/animated/",
    ])
        assert.equal(federatedMediaKind(path), null, path);
});

test("decoration art has its own size cap under the media proxy limit", () => {
    assert.equal(federatedMediaMaxBytes("/media/v1/collectibles-shop/1/animated", 50 * 1024 * 1024), DECORATION_ART_MAX_BYTES);
    assert.equal(federatedMediaMaxBytes(`/avatar-decoration-presets/${ASSET}.png`, 50 * 1024 * 1024), DECORATION_ART_MAX_BYTES);
    assert.equal(federatedMediaMaxBytes("/media/v1/collectibles-shop/1/animated", 4096), 4096);
    assert.equal(federatedMediaMaxBytes("/avatars/1/abc", 50 * 1024 * 1024), 50 * 1024 * 1024);
});

test("shop art from another instance can be an image or a video and nothing else", () => {
    assert.equal(federatedMediaType("collectible", "video/webm"), "video/webm");
    assert.equal(federatedMediaType("collectible", "image/png"), "image/png");
    for (const type of ["audio/mpeg", "text/html", "application/json", "image/svg", null]) assert.equal(federatedMediaType("collectible", type), null, String(type));
});

const LOCAL = "1560000000000000001";
const NAMEPLATE_OF = (sku) => ({ asset: `nameplates/custom/${sku}/`, sku_id: sku, label: "cats", palette: "violet", expires_at: null });
const NAMEPLATE = { asset: `nameplates/custom/${SKU}/`, sku_id: SKU, label: "cats", palette: "violet", expires_at: null };

test("a nameplate keeps only its asset, SKU, label, palette and expiry", () => {
    assert.deepEqual(readNameplate({ ...NAMEPLATE, url: "https://evil.example/x.webm", extra: 1 }, NOW), NAMEPLATE);
    assert.equal(readNameplate({ ...NAMEPLATE, label: "x".repeat(400) }, NOW).label.length, 256);
    assert.deepEqual(readNameplate({ ...NAMEPLATE, asset: "nameplates/nameplates/twilight/", label: undefined }, NOW).label, "");
    for (const asset of ["https://evil.example/a/", "nameplates/", "nameplates/../../x/", "nameplates/a b/", "decorations/x/", "nameplates/x", 5])
        assert.equal(readNameplate({ ...NAMEPLATE, asset }, NOW), null, String(asset));
    for (const palette of ["", "Violet", "red;", 1]) assert.equal(readNameplate({ ...NAMEPLATE, palette }, NOW), null, String(palette));
    assert.equal(readNameplate({ ...NAMEPLATE, expires_at: Math.floor(NOW / 1000) - 1 }, NOW), null);
    assert.equal(readRemoteNameplate({ ...NAMEPLATE, sku_id: `@${SKU}@${SENDER}` }, SENDER, NOW).sku_id, SKU);
    assert.equal(readRemoteNameplate({ ...NAMEPLATE, sku_id: `@${SKU}@dog.example` }, SENDER, NOW), null);
});

test("nameplates on users and members get this instance's SKU and a matching asset", async () => {
    const calls = [];
    const known = { ...NAMEPLATE, asset: "nameplates/nameplates/twilight/", sku_id: "1349849614198505602" };
    const body = {
        author: { id: "1", username: "cat", collectibles: { nameplate: NAMEPLATE, junk: { sku_id: "1" } } },
        member: { nick: "kit", collectibles: { nameplate: { ...NAMEPLATE, sku_id: `@${SKU}@${SENDER}` } } },
        mentions: [{ id: "2", username: "dog", collectibles: { nameplate: known } }],
    };
    await localizeDecorations(body, SENDER, resolverOf({ [SKU]: LOCAL, [known.sku_id]: known.sku_id }, calls), NOW);
    assert.deepEqual(body.author.collectibles, { nameplate: { ...NAMEPLATE, sku_id: LOCAL, asset: `nameplates/custom/${LOCAL}/` } });
    assert.deepEqual(body.member.collectibles, body.author.collectibles);
    assert.deepEqual(body.mentions[0].collectibles, { nameplate: known });
    assert.equal(calls.length, 1);
    assert.deepEqual(
        calls[0].map((ref) => [ref.type, ref.sku]),
        [
            [2, SKU],
            [2, known.sku_id],
        ],
    );
});

test("junk, foreign and unmapped nameplates become null", async () => {
    const body = {
        a: { collectibles: { nameplate: { ...NAMEPLATE, asset: "../x/" } } },
        b: { collectibles: { nameplate: { ...NAMEPLATE, sku_id: `@${SKU}@dog.example` } } },
        c: { collectibles: { nameplate: { ...NAMEPLATE, sku_id: "1300000000000000999" } } },
        d: { collectibles: "nameplate" },
        e: { collectibles: null },
    };
    await localizeDecorations(body, SENDER, resolverOf({ [SKU]: LOCAL }), NOW);
    for (const key of ["a", "b", "c"]) assert.deepEqual(body[key].collectibles, { nameplate: null }, key);
    assert.equal(body.d.collectibles, null);
    assert.equal(body.e.collectibles, null);
});

test("profile effects and profile collectibles get this instance's SKU, unmapped ones are dropped", async () => {
    const calls = [];
    const profile = {
        user_profile: {
            bio: "",
            profile_effect: { id: `@${SKU}@${SENDER}`, expires_at: null },
            collectibles: [
                { sku_id: SKU, type: 1, expires_at: null },
                { sku_id: "1300000000000000555", type: 3, expires_at: null },
                { sku_id: "1300000000000000556", type: 3, expires_at: null },
                { sku_id: "1300000000000000557", type: 0, expires_at: null },
                "junk",
            ],
        },
        guild_member_profile: { profile_effect: { id: "1300000000000000999", expires_at: null }, collectibles: [] },
    };
    await localizeDecorations(profile, SENDER, resolverOf({ [SKU]: LOCAL, "1300000000000000555": "1300000000000000555" }, calls), NOW);
    assert.deepEqual(profile.user_profile.profile_effect, { id: LOCAL, expires_at: null });
    assert.deepEqual(profile.user_profile.collectibles, [
        { sku_id: LOCAL, type: 1, expires_at: null },
        { sku_id: "1300000000000000555", type: 3, expires_at: null },
    ]);
    assert.equal(profile.guild_member_profile.profile_effect, null);
    assert.deepEqual(profile.guild_member_profile.collectibles, []);
    assert.deepEqual(
        calls[0].map((ref) => [ref.type, ref.sku]).sort(),
        [
            [1, "1300000000000000999"],
            [1, SKU],
            [3, "1300000000000000555"],
            [3, "1300000000000000556"],
        ].sort(),
    );
});

test("the id rewriter leaves nameplate and profile effect SKUs to the localizer", () => {
    const user = { id: "1144058522808614000", username: "cat", avatar: null, collectibles: { nameplate: NAMEPLATE } };
    const outgoing = rewriteOutgoing(
        { user, user_profile: { profile_effect: { id: SKU, expires_at: null }, collectibles: [{ sku_id: SKU, type: 1 }] } },
        new Map(),
        "home.example",
    );
    assert.deepEqual(outgoing.user.collectibles, { nameplate: NAMEPLATE });
    assert.deepEqual(outgoing.user_profile.profile_effect, { id: SKU, expires_at: null });
    assert.deepEqual(outgoing.user_profile.collectibles, [{ sku_id: SKU, type: 1 }]);
    const incoming = rewriteIncoming(outgoing, new Map([["@1144058522808614000@home.example", "555"]]), "away.example");
    assert.deepEqual(incoming.user.collectibles, { nameplate: NAMEPLATE });
    assert.deepEqual(incoming.user_profile.profile_effect, { id: SKU, expires_at: null });
});

const CDN = "https://away.example/";
const REMOTE_CDN = "https://cdn.cat.example";

test("a remote profile effect's art points at this instance's CDN under the local SKU", () => {
    assert.equal(
        localEffectArt(`${REMOTE_CDN}/media/v1/collectibles-shop/${SKU}/effect?v=abc_1`, SKU, LOCAL, CDN),
        `https://away.example/media/v1/collectibles-shop/${LOCAL}/effect?v=abc_1`,
    );
    assert.equal(
        localEffectArt(`${REMOTE_CDN}/media/v1/collectibles-shop/${SKU}/thumbnail?v=../x`, SKU, LOCAL, CDN),
        `https://away.example/media/v1/collectibles-shop/${LOCAL}/thumbnail`,
    );
    const hash = "8bd2234206e32420299b813c5a7d174970226c600f71334021463cf56cfac278";
    assert.equal(localEffectArt(`${REMOTE_CDN}/content-assets/${hash}`, SKU, LOCAL, CDN), `https://away.example/content-assets/${hash}`);
    assert.equal(localEffectArt(`https://cdn.discordapp.com/assets/content/${hash}`, SKU, LOCAL, CDN), `https://away.example/content-assets/${hash}`);
    for (const src of [
        `${REMOTE_CDN}/media/v1/collectibles-shop/1300000000000000999/effect`,
        `${REMOTE_CDN}/media/v1/collectibles-shop/${SKU}/banner`,
        `${REMOTE_CDN}/avatars/1/abc.png`,
        `javascript:alert(1)`,
        `data:image/png;base64,AAAA`,
        "not a url",
        42,
    ])
        assert.equal(localEffectArt(src, SKU, LOCAL, CDN), null, String(src));
});

test("a remote profile effect item is rebuilt from bounded fields only", () => {
    const remote = {
        name: "Sparkles",
        item: {
            type: 1,
            id: SKU,
            sku_id: SKU,
            title: "Sparkles",
            description: "Shiny.",
            accessibilityLabel: "Sparkles falling",
            animationType: 2,
            thumbnailPreviewSrc: `${REMOTE_CDN}/media/v1/collectibles-shop/${SKU}/thumbnail?v=1`,
            reducedMotionSrc: "https://evil.example/track.png",
            onClick: "steal()",
            effects: [
                {
                    src: `${REMOTE_CDN}/media/v1/collectibles-shop/${SKU}/effect?v=2`,
                    loop: true,
                    height: 880,
                    width: 450,
                    duration: 3000,
                    start: 0,
                    loopDelay: 0,
                    position: { x: 0, y: 0 },
                    zIndex: 100,
                    randomizedSources: [{ src: "https://evil.example/x" }],
                },
                { src: "https://evil.example/x.png", loop: true },
                { src: `${REMOTE_CDN}/media/v1/collectibles-shop/${SKU}/effect`, height: 1e9, duration: -1, zIndex: "top" },
            ],
        },
    };
    const item = readRemoteProfileEffectItem(remote, SKU, LOCAL, CDN);
    assert.equal(item.id, LOCAL);
    assert.equal(item.sku_id, LOCAL);
    assert.equal(item.type, 1);
    assert.equal(item.onClick, undefined);
    assert.equal(item.thumbnailPreviewSrc, `https://away.example/media/v1/collectibles-shop/${LOCAL}/thumbnail?v=1`);
    assert.equal(item.reducedMotionSrc, item.thumbnailPreviewSrc);
    assert.equal(item.effects.length, 2);
    assert.equal(item.effects[0].src, `https://away.example/media/v1/collectibles-shop/${LOCAL}/effect?v=2`);
    assert.deepEqual(item.effects[0].randomizedSources, []);
    assert.deepEqual([item.effects[1].height, item.effects[1].duration, item.effects[1].zIndex, item.effects[1].loop], [880, 3000, 100, false]);
    assert.equal(readRemoteProfileEffectItem({ item: { ...remote.item, type: 2 } }, SKU, LOCAL, CDN), null);
    assert.equal(readRemoteProfileEffectItem({ item: { ...remote.item, effects: [{ src: "https://evil.example/x.png" }] } }, SKU, LOCAL, CDN), null);
    assert.equal(readRemoteProfileEffectItem({ item: remote.item }, SKU, "../x", CDN), null);
    assert.equal(readRemoteProfileEffectItem(null, SKU, LOCAL, CDN), null);
});

test("a SKU's origin is the sender for a plain snowflake and the named instance for a canonical id", () => {
    assert.deepEqual(remoteSkuOrigin(SKU, SENDER), { sku: SKU, instance: SENDER });
    assert.deepEqual(remoteSkuOrigin(`@${SKU}@dog.example`, SENDER), { sku: SKU, instance: "dog.example" });
    for (const value of [`@${SKU}@`, "@abc@dog.example", "abc", 5, null]) assert.equal(remoteSkuOrigin(value, SENDER), null, String(value));
});

test("shop items another instance made go to the resolver under that instance", async () => {
    const calls = [];
    const body = {
        member: { avatar_decoration_data: { asset: ASSET, sku_id: `@${SKU}@dog.example`, expires_at: null } },
        user: { collectibles: { nameplate: { ...NAMEPLATE_OF(SKU), sku_id: `@${SKU}@away.example` } } },
        profile: { profile_effect: { id: `@${SKU}@dog.example`, expires_at: null } },
    };
    await localizeDecorations(body, SENDER, resolverOf({ [`dog.example/${SKU}`]: "1560000000000000002", [`away.example/${SKU}`]: SKU }, calls), NOW);
    assert.deepEqual(body.member.avatar_decoration_data, { asset: ASSET, sku_id: "1560000000000000002", expires_at: null });
    assert.deepEqual(body.user.collectibles.nameplate, NAMEPLATE_OF(SKU));
    assert.deepEqual(body.profile.profile_effect, { id: "1560000000000000002", expires_at: null });
    assert.deepEqual(calls[0].map((ref) => `${ref.type}:${ref.instance}`).sort(), ["0:dog.example", "1:dog.example", "2:away.example"]);
});

test("outgoing SKUs mapped from another instance go back to their canonical id, with the nameplate's own asset", () => {
    const own = "away.example";
    const local = "1560000000000000001";
    const body = {
        user: { id: "1", username: "cat", avatar_decoration_data: { asset: ASSET, sku_id: local, expires_at: null }, collectibles: { nameplate: NAMEPLATE_OF(local) } },
        member: { avatar_decoration_data: { asset: ASSET, sku_id: "1144058522808614923", expires_at: null } },
        user_profile: { profile_effect: { id: local, expires_at: null }, collectibles: [{ sku_id: local, type: 1, expires_at: null }, "junk"] },
        junk: { avatar_decoration_data: { asset: ASSET, sku_id: "../x" } },
    };
    assert.deepEqual([...collectibleSkus(body)].sort(), ["1144058522808614923", local]);
    const canonical = new Map([
        [local, `@${SKU}@${SENDER}`],
        ["1144058522808614923", `@1144058522808614923@${own}`],
    ]);
    canonicalizeDecorations(body, canonical, own);
    assert.deepEqual(body.user.avatar_decoration_data, { asset: ASSET, sku_id: `@${SKU}@${SENDER}`, expires_at: null });
    assert.deepEqual(body.user.collectibles.nameplate, { ...NAMEPLATE_OF(SKU), sku_id: `@${SKU}@${SENDER}` });
    assert.equal(body.member.avatar_decoration_data.sku_id, "1144058522808614923");
    assert.deepEqual(body.user_profile.profile_effect, { id: `@${SKU}@${SENDER}`, expires_at: null });
    assert.equal(body.user_profile.collectibles[0].sku_id, `@${SKU}@${SENDER}`);
    assert.equal(body.junk.avatar_decoration_data.sku_id, "../x");
});

test("an item's home gets its own SKU back from a canonicalized payload", async () => {
    const body = canonicalizeDecorations(
        { member: { avatar_decoration_data: { asset: ASSET, sku_id: "1560000000000000001", expires_at: null } } },
        new Map([["1560000000000000001", `@${SKU}@home.example`]]),
        SENDER,
    );
    await localizeDecorations(body, SENDER, resolverOf({ [`home.example/${SKU}`]: SKU }), NOW);
    assert.deepEqual(body.member.avatar_decoration_data, { asset: ASSET, sku_id: SKU, expires_at: null });
});

test("a remote avatar decoration item keeps a valid asset under the local SKU", () => {
    assert.deepEqual(readRemoteDecorationItem({ name: "Cat ears", item: { type: 0, sku_id: SKU, asset: ASSET, label: "Ears", onClick: "x" } }, "1560000000000000001"), {
        type: 0,
        sku_id: "1560000000000000001",
        asset: ASSET,
        label: "Ears",
    });
    assert.equal(readRemoteDecorationItem({ name: "Cat ears", item: { type: 0, asset: ASSET } }, "1560000000000000001").label, "Cat ears");
    for (const raw of [{ item: { type: 1, asset: ASSET } }, { item: { type: 0, asset: "../x" } }, { item: { type: 0, asset: "https://evil.example/a.png" } }, { item: null }, null])
        assert.equal(readRemoteDecorationItem(raw, "1560000000000000001"), null, JSON.stringify(raw));
    assert.equal(readRemoteDecorationItem({ item: { type: 0, asset: ASSET } }, "../x"), null);
});
