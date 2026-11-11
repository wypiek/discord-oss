import fs from "node:fs/promises";
import type { GifsResponse, GifTrendingCategory, GifResponse } from "@spacebar/schemas";
import { Config } from "@spacebar/util";
import { GifCache } from "../GifCache";
import { requestGifJson, gifText, gifUrl, gifDimension, gifLimit } from "../GifRequest";
import type { IGifProvider } from "../IGifProvider";

const TRENDING_CATEGORIES_CACHE_DURATION = 24 * 60 * 60 * 1000;
const TRENDING_GIFS_CACHE_DURATION = 60 * 60 * 1000;

export default class KlipyGifProvider implements IGifProvider {
    id = "klipy";
    available = true;
    #apiKey: string;
    #trendingCategoryCache = new Map<string, GifCache<GifTrendingCategory[]>>();
    #trendingGifsCache = new Map<string, GifCache<GifsResponse>>();

    async init(): Promise<void> {
        if (!Config.get().integrations.gifs.klipy.enabled) {
            this.available = false;
            return;
        }

        let apiKey = Config.get().integrations.gifs.klipy.apiKey;
        if (!apiKey) {
            const path = Config.get().integrations.gifs.klipy.apiKeyPath;
            if (!(path && (await fs.stat(path).catch(() => undefined)))) {
                console.warn("[KlipyGifProvider] Klipy integration is enabled but no API key was provided, disabling...");
                this.available = false;
                return;
            }
            apiKey = (await fs.readFile(path, "utf-8")).trim();
        }

        this.#apiKey = apiKey;
    }

    async search(query: { q: string; limit?: number; media_format: string; locale: string }): Promise<GifsResponse> {
        query.media_format ??= "gif";
        query.locale ??= "en";
        const limit = gifLimit(query.limit, 50);
        const params = new URLSearchParams({
            q: query.q,
            locale: query.locale,
            per_page: String(limit),
        });
        const responseData = await requestGifJson<KlipyGifsResponse>(`https://api.klipy.com/api/v1/${encodeURIComponent(this.#apiKey)}/gifs/search?${params}`, "Klipy");
        if (!responseData?.result || !Array.isArray(responseData.data?.data)) throw new Error("Invalid Klipy response");
        return responseData.data.data.slice(0, limit).map((result) => this.convertGifResult(result, query.media_format));
    }

    async getTrendingCategories(query: { locale: string }): Promise<GifTrendingCategory[]> {
        const key = query.locale || "en";
        if (!this.#trendingCategoryCache.has(key)) {
            if (this.#trendingCategoryCache.size >= 16) this.#trendingCategoryCache.clear();
            this.#trendingCategoryCache.set(key, new GifCache(TRENDING_CATEGORIES_CACHE_DURATION));
        }
        return await this.#trendingCategoryCache.get(key)!.getOrUpdate(async () => {
            query.locale ??= "en";
            const responseData = await requestGifJson<KlipyCategoriesResponse>(
                `https://api.klipy.com/api/v1/${encodeURIComponent(this.#apiKey)}/gifs/categories?locale=${encodeURIComponent(query.locale)}`,
                "Klipy",
            );
            if (!responseData?.result || !Array.isArray(responseData.data?.categories)) throw new Error("Invalid Klipy response");
            return responseData.data.categories.slice(0, 100).map((x) => {
                if (!x || !gifText(x.query) || !gifUrl(x.preview_url)) throw new Error("Invalid Klipy category");
                return { name: x.query, src: x.preview_url };
            }) satisfies GifTrendingCategory[];
        });
    }

    async getTrendingGifs(query: { media_format: string; locale: string }): Promise<GifsResponse> {
        const key = `${query.locale || "en"}:${query.media_format || "gif"}`;
        if (!this.#trendingGifsCache.has(key)) {
            if (this.#trendingGifsCache.size >= 16) this.#trendingGifsCache.clear();
            this.#trendingGifsCache.set(key, new GifCache(TRENDING_GIFS_CACHE_DURATION));
        }
        return await this.#trendingGifsCache.get(key)!.getOrUpdate(async () => {
            query.locale ??= "en";
            const responseData = await requestGifJson<KlipyGifsResponse>(
                `https://api.klipy.com/api/v1/${encodeURIComponent(this.#apiKey)}/gifs/trending?locale=${encodeURIComponent(query.locale)}&per_page=50`,
                "Klipy",
            );
            if (!responseData?.result || !Array.isArray(responseData.data?.data)) throw new Error("Invalid Klipy response");
            return responseData.data.data.slice(0, 50).map((result) => this.convertGifResult(result, query.media_format));
        });
    }

    private convertGifResult(result: KlipyMediaItem, media_format?: string) {
        const format = media_format === "tinywebp" ? "webp" : media_format === "webm" ? "webm" : media_format === "gif" ? "gif" : "mp4";
        if (!result || !Number.isSafeInteger(result.id) || result.id < 0 || !gifText(result.title, 512) || !gifText(result.slug) || !result.file)
            throw new Error("Invalid Klipy media");
        const media = result.file.sm ?? result.file.md ?? result.file.hd;
        const gif = result.file.hd?.gif ?? media?.gif;
        const selected = media?.[format] ?? media?.mp4 ?? gif;
        if (!gif || !selected || !gifUrl(gif.url) || !gifUrl(selected.url) || !gifDimension(selected.width) || !gifDimension(selected.height))
            throw new Error("Invalid Klipy media");
        return {
            id: result.id.toString(),
            title: result.title,
            url: "https://klipy.com/gifs/" + result.slug,
            src: selected.url,
            gif_src: gif.url,
            width: selected.width,
            height: selected.height,
            preview: gif.url,
        } satisfies GifResponse;
    }
}

interface KlipyCategoriesResponse {
    result: boolean;
    data: { locale: string; categories: KlipyCategory[] };
}

interface KlipyCategory {
    category: string;
    query: string;
    preview_url: string;
}

interface KlipyGifsResponse {
    result: boolean;
    data: { current_page: number; per_page: number; has_next: boolean; data: KlipyMediaItem[] };
}

interface KlipyMediaItem {
    id: number;
    slug: string;
    title: string;
    file: KlipyFile;
    tags: string[];
    type: string;
    blur_preview: string;
}

interface KlipyFile {
    hd: KlipyFileSize;
    md: KlipyFileSize;
    sm: KlipyFileSize;
    xs: KlipyFileSize;
}

interface KlipyFileSize {
    gif: KlipyFileInfo;
    webp: KlipyFileInfo;
    jpg: KlipyFileInfo;
    mp4: KlipyFileInfo;
    webm: KlipyFileInfo;
}

interface KlipyFileInfo {
    url: string;
    width: number;
    height: number;
    size: number;
}
