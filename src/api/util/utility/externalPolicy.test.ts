import assert from "node:assert/strict";
import { afterEach, test, mock } from "node:test";
import fs from "node:fs/promises";
import { Config, ConfigValue } from "@spacebar/util";
import { CustomGame, Template } from "@spacebar/database";
import { DetectableGames } from "./games";
import { getDetectableGames, getDetectableGamesById } from "./detectableGames";
import { ensureStandardStickerPacks } from "./StickerPacks";
import { resolveGuildTemplate } from "./guildTemplates";
import { storage } from "../../../cdn/util/Storage";
import { fetchUpstreamAsset } from "../../../cdn/util/upstream";

import { EmbedHandlers } from "./EmbedHandlers";

afterEach(() => mock.restoreAll());

test("offline policy returns stale local games and rejects optional upstream without fetching", async () => {
    const config = new ConfigValue();
    for (const key of Object.keys(config.externalRequests)) config.externalRequests[key as keyof typeof config.externalRequests] = false;
    config.templates.enabled = true;
    config.templates.allowDiscordTemplates = true;
    mock.method(Config, "get", () => config);
    const network = mock.method(globalThis, "fetch", async () => {
        throw new Error("unexpected outbound request");
    });
    mock.method(fs, "stat", async () => ({ mtimeMs: 0 }));
    mock.method(fs, "readFile", async () => JSON.stringify([{ id: "local-game", name: "Offline game" }]));
    const customReads = mock.method(CustomGame, "find", async () => []);
    mock.method(Template, "findOne", async () => null);
    const cachedArt = Buffer.from("previously cached art");
    mock.method(storage, "get", async (path: string) => (path === "cached-decoration" ? cachedArt : null));
    const games = await Promise.all(Array.from({ length: 20 }, () => getDetectableGames()));
    assert.deepEqual(
        games[0].map((game) => game.id),
        ["local-game"],
    );
    assert.ok(
        games.every((list) => list === games[0]),
        "concurrent lookups share an index",
    );
    assert.equal(customReads.mock.callCount(), 1, "coalesce custom game database queries");
    assert.deepEqual(
        (await getDetectableGamesById(["missing", "local-game"])).map((game) => game.id),
        ["local-game"],
    );
    assert.equal((await DetectableGames.search("Offline"))[0].id, "local-game");
    await ensureStandardStickerPacks();
    await assert.rejects(resolveGuildTemplate("discord:missing"));
    assert.equal(await fetchUpstreamAsset("stickers/123", "https://cdn.discordapp.com/stickers/123.png"), null);
    assert.equal(await fetchUpstreamAsset("untrusted", "https://example.com/avatar-decoration-presets/image.png"), null);
    config.externalRequests.discordDecorations = false;
    assert.equal(await fetchUpstreamAsset("cached-decoration", "https://cdn.discordapp.com/avatar-decoration-presets/image.png"), cachedArt);
    assert.equal(network.mock.callCount(), 0);
});

test("decoration cache misses share one request and missing art is briefly cached", async () => {
    mock.method(Config, "get", () => new ConfigValue());
    const bodies = new Map<string, Buffer>();
    mock.method(storage, "get", async (path: string) => bodies.get(path) ?? null);
    mock.method(storage, "set", async (path: string, body: Buffer) => {
        bodies.set(path, body);
    });
    const network = mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
        assert.equal(options?.redirect, "error", "decoration requests cannot redirect off the allowed host");
        return new Response(String(url).includes("missing") ? null : "art", {
            status: String(url).includes("missing") ? 404 : 200,
        });
    });
    const url = "https://cdn.discordapp.com/avatar-decoration-presets/existing.png";
    const art = await Promise.all(Array.from({ length: 20 }, () => fetchUpstreamAsset("test-art", url)));
    assert.ok(art.every((body) => body?.toString() === "art"));
    assert.equal(network.mock.callCount(), 1);
    assert.equal((await fetchUpstreamAsset("test-art", url))?.toString(), "art");
    assert.equal(network.mock.callCount(), 1, "the next request uses persisted bytes");
    const missingUrl = "https://cdn.discordapp.com/avatar-decoration-presets/missing.png";
    assert.equal(await fetchUpstreamAsset("test-missing-art", missingUrl), null);
    assert.equal(await fetchUpstreamAsset("test-missing-art", missingUrl), null);
    assert.equal(network.mock.callCount(), 2, "a missing asset is not fetched on every request");
});

test("a configured Twitter key does not bypass the external provider policy", async () => {
    const config = new ConfigValue();
    config.external.twitter = "inert-test-key";
    mock.method(Config, "get", () => config);
    const network = mock.method(globalThis, "fetch", async () => {
        throw new Error("unexpected outbound request");
    });
    assert.equal(await EmbedHandlers["www.twitter.com"](new URL("https://www.twitter.com/test/status/123")), null);
    assert.equal(network.mock.callCount(), 0);
});
