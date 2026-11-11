const database = process.env.DATABASE;
process.env.DATABASE ??= "postgres://localhost/fosscord_gif_unit_unused";
const assert = require("node:assert/strict");
const test = require("node:test");
const { Config } = require("../../dist/util");
const Klipy = require("../../dist/integrations/gifs/providers/KlipyGifProvider").default;
const Tenor = require("../../dist/integrations/gifs/providers/TenorGifProvider").default;
const { GifProviderManager } = require("../../dist/integrations/gifs");
if (database === undefined) delete process.env.DATABASE;
const originalConfig = Config.get;
const originalFetch = global.fetch;
const config = {
    integrations: {
        gifs: {
            enabled: true,
            defaultProvider: "klipy",
            klipy: { enabled: true, apiKey: "test-key" },
            tenor: { enabled: true, apiKey: "test-key" },
        },
    },
    externalRequests: { thirdParty: false },
};
const media = { url: "https://media.example/gif", width: 320, height: 180, dims: [320, 180] };
const item = {
    id: 42,
    slug: "cat",
    title: "Cat",
    file: {
        hd: { gif: media, mp4: { ...media, url: "https://media.example/mp4" } },
        sm: { gif: media, webp: { ...media, url: "https://media.example/webp" } },
    },
};
test.before(() => {
    Config.get = () => config;
});
test.after(() => {
    Config.get = originalConfig;
    global.fetch = originalFetch;
});
test("klipy converts formats and clamps limits without changing caller query", async () => {
    let url;
    global.fetch = async (input) => {
        url = new URL(input);
        return Response.json({ result: true, data: { data: [item] } });
    };
    const provider = new Klipy();
    await provider.init();
    const result = await provider.search({
        q: "cat",
        limit: -2,
        media_format: "tinywebp",
        locale: "en",
    });
    assert.equal(url.searchParams.get("per_page"), "1");
    assert.equal(result[0].src, "https://media.example/webp");
    assert.equal(result[0].gif_src, media.url);
});
test("klipy trending cache isolates locale and requested format", async () => {
    let requests = 0;
    global.fetch = async () => {
        requests++;
        return Response.json({ result: true, data: { data: [item] } });
    };
    const provider = new Klipy();
    await provider.init();
    await provider.getTrendingGifs({ locale: "en", media_format: "gif" });
    await provider.getTrendingGifs({ locale: "en", media_format: "gif" });
    const webp = await provider.getTrendingGifs({ locale: "en", media_format: "tinywebp" });
    await provider.getTrendingGifs({ locale: "fr", media_format: "gif" });
    assert.equal(requests, 3);
    assert.equal(webp[0].src, "https://media.example/webp");
});
test("klipy error never contains key or upstream response", async () => {
    global.fetch = async () => new Response("secret raw upstream failure", { status: 401 });
    const provider = new Klipy();
    await provider.init();
    await assert.rejects(provider.search({ q: "cat", media_format: "gif", locale: "en" }), (error) => error.message === "Klipy request failed (401)");
});
test("missing key file disables klipy instead of failing startup", async () => {
    const previous = config.integrations.gifs.klipy;
    config.integrations.gifs.klipy = { enabled: true, apiKeyPath: "/does-not-exist/fosscord-key" };
    try {
        const provider = new Klipy();
        await provider.init();
        assert.equal(provider.available, false);
    } finally {
        config.integrations.gifs.klipy = previous;
    }
});
test("tenor genuinely uses upstream v1 and maps Vencord media", async () => {
    let url;
    global.fetch = async (input) => {
        url = new URL(input);
        return Response.json({
            results: [
                {
                    id: "1",
                    title: "Cat",
                    itemurl: "https://tenor.com/view/cat",
                    media: [{ gif: media, tinywebm: { ...media, url: "https://media.example/webm" } }],
                },
            ],
        });
    };
    const provider = new Tenor();
    await provider.init();
    const result = await provider.search({ q: "cat", limit: 2, media_format: "webm", locale: "en" });
    assert.equal(url.host, "api.tenor.com");
    assert.equal(url.pathname, "/v1/search");
    assert.equal(result[0].src, "https://media.example/webm");
});
test("provider selection never silently substitutes another provider", async () => {
    await GifProviderManager.init();
    assert.equal(GifProviderManager.findProvider().id, "klipy");
    assert.equal(GifProviderManager.findProvider("tenor").id, "tenor");
    assert.equal(GifProviderManager.findProvider("unknown"), undefined);
    assert.equal(config.externalRequests.thirdParty, false);
});

test("invalid Klipy categories never enter the shared cache and the next request can recover", async () => {
    let requests = 0;
    global.fetch = async () => {
        requests++;
        return Response.json({
            result: true,
            data: {
                categories: [
                    {
                        query: "Cats",
                        preview_url: requests === 1 ? "javascript:alert(1)" : "https://media.example/category",
                    },
                ],
            },
        });
    };
    const provider = new Klipy();
    await provider.init();
    await assert.rejects(provider.getTrendingCategories({ locale: "en" }), /Invalid Klipy category/);
    const valid = await provider.getTrendingCategories({ locale: "en" });
    assert.equal(valid[0].name, "Cats");
    await provider.getTrendingCategories({ locale: "en" });
    assert.equal(requests, 2);
});
test("provider collections are bounded even when upstream ignores its requested limit", async () => {
    global.fetch = async () => Response.json({ result: true, data: { data: Array(80).fill(item) } });
    const klipy = new Klipy();
    await klipy.init();
    assert.equal((await klipy.search({ q: "cat", media_format: "gif", locale: "en" })).length, 50);
    assert.equal((await klipy.search({ q: "cat", limit: 2, media_format: "gif", locale: "en" })).length, 2);
    global.fetch = async () =>
        Response.json({
            results: Array(80).fill({
                id: "1",
                title: "Cat",
                itemurl: "https://tenor.com/view/cat",
                media: [{ gif: media }],
            }),
        });
    const tenor = new Tenor();
    await tenor.init();
    assert.equal((await tenor.getTrendingGifs({ media_format: "gif", locale: "en" })).length, 50);
    global.fetch = async () => Response.json({ results: Array(80).fill("cat") });
    assert.equal((await tenor.suggest({ q: "cat", limit: 10, locale: "en" })).length, 10);
    assert.equal((await tenor.suggest({ q: "cat", limit: 2, locale: "en" })).length, 2);
});
test("malformed provider media and category schemas are rejected", async () => {
    const klipy = new Klipy();
    await klipy.init();
    for (const body of [null, { result: true, data: { data: [null] } }, { result: true, data: { data: [{ ...item, file: { hd: { gif: { ...media, width: -1 } } } }] } }]) {
        global.fetch = async () => Response.json(body);
        await assert.rejects(klipy.search({ q: "cat", media_format: "gif", locale: "en" }), /Invalid Klipy/);
    }
    const tenor = new Tenor();
    await tenor.init();
    global.fetch = async () => Response.json({ tags: [{ searchterm: "Cats", image: "javascript:alert(1)" }] });
    await assert.rejects(tenor.getTrendingCategories({ locale: "en" }), /Invalid Tenor category/);
    global.fetch = async () => Response.json({ results: [null] });
    await assert.rejects(tenor.search({ q: "cat", media_format: "gif", locale: "en" }), /Invalid Tenor media/);
    await assert.rejects(tenor.suggest({ q: "cat", limit: 10, locale: "en" }), /Invalid Tenor suggestions/);
});

test("Tenor coalesces pending trending requests and separates locale and format caches", async () => {
    let requests = 0,
        release;
    global.fetch = async () => {
        requests++;
        if (requests === 1)
            await new Promise((resolve) => {
                release = resolve;
            });
        return Response.json({
            results: [
                {
                    id: "1",
                    itemurl: "https://tenor.com/view/cat",
                    media: [{ gif: media, tinywebm: { ...media, url: "https://media.example/webm" } }],
                },
            ],
        });
    };
    const provider = new Tenor();
    await provider.init();
    const pending = Array.from({ length: 10 }, () => provider.getTrendingGifs({ locale: "en", media_format: "gif" }));
    assert.equal(requests, 1);
    release();
    await Promise.all(pending);
    await provider.getTrendingGifs({ locale: "en", media_format: "gif" });
    const webm = await provider.getTrendingGifs({ locale: "en", media_format: "webm" });
    await provider.getTrendingGifs({ locale: "fr", media_format: "gif" });
    assert.equal(requests, 3);
    assert.equal(webm[0].src, "https://media.example/webm");
});
test("Tenor category cache retries rejected data and bounds locale entries", async () => {
    let requests = 0;
    global.fetch = async () => {
        requests++;
        return Response.json({
            tags: [
                {
                    searchterm: "Cats",
                    image: requests === 1 ? "javascript:alert(1)" : "https://media.example/category",
                },
            ],
        });
    };
    const provider = new Tenor();
    await provider.init();
    await assert.rejects(provider.getTrendingCategories({ locale: "en" }), /Invalid Tenor category/);
    await provider.getTrendingCategories({ locale: "en" });
    await provider.getTrendingCategories({ locale: "en" });
    assert.equal(requests, 2);
    for (let i = 0; i < 17; i++) await provider.getTrendingCategories({ locale: `fixture-${i}` });
    await provider.getTrendingCategories({ locale: "en" });
    assert.equal(requests, 20);
});
