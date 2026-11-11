import fs from "node:fs/promises";
import { Config } from "@spacebar/util";
import type { GifsResponse, GifTrendingCategory } from "@spacebar/schemas";
import type { IGifProvider } from "../IGifProvider";
import { requestGifJson, gifText, gifUrl, gifDimension, gifLimit } from "../GifRequest";
import { GifCache } from "../GifCache";

type Media = { url: string; dims: [number, number]; preview?: string };
type Result = {
    id: string;
    title?: string;
    h1_title?: string;
    itemurl: string;
    media: Record<string, Media>[];
};
export default class TenorGifProvider implements IGifProvider {
    id = "tenor";
    available = false;
    private key = "";
    private trendingGifs = new Map<string, GifCache<GifsResponse>>();
    private trendingCategories = new Map<string, GifCache<GifTrendingCategory[]>>();
    private cached<T>(cache: Map<string, GifCache<T>>, key: string, duration: number, factory: () => Promise<T>) {
        if (!cache.has(key)) {
            if (cache.size >= 16) cache.clear();
            cache.set(key, new GifCache(duration));
        }
        return cache.get(key)!.getOrUpdate(factory);
    }
    async init() {
        const config = Config.get().integrations.gifs.tenor;
        this.key = config.apiKey || (config.apiKeyPath ? await fs.readFile(config.apiKeyPath, "utf8").catch(() => "") : "");
        this.key = this.key.trim();
        this.available = config.enabled && !!this.key;
    }
    private async request(endpoint: string, params: Record<string, string>) {
        const data = await requestGifJson<{
            results?: unknown[];
            tags?: { searchterm: string; image: string }[];
        }>(`https://api.tenor.com/v1/${endpoint}?${new URLSearchParams({ key: this.key, ...params })}`, "Tenor");
        if (!data || typeof data !== "object") throw new Error("Invalid Tenor response");
        if (endpoint === "categories") {
            if (!Array.isArray(data.tags)) throw new Error("Invalid Tenor response");
        } else if (!Array.isArray(data.results)) throw new Error("Invalid Tenor response");
        return data;
    }

    private convert(item: Result, format: string) {
        if (!item || !gifText(item.id) || !item.id || !gifText(item.title || item.h1_title || "", 512) || !gifUrl(item.itemurl)) throw new Error("Invalid Tenor media");
        const media = item.media?.[0];
        const gif = media?.gif;
        const selected = media?.[format === "gif" ? "gif" : format === "tinywebp" ? "webp" : "tinywebm"] || media?.mp4 || gif;
        if (!gif || !selected) return [];
        if (!gifUrl(gif.url) || !gifUrl(selected.url) || !gifDimension(selected.dims?.[0]) || !gifDimension(selected.dims?.[1]) || (selected.preview && !gifUrl(selected.preview)))
            throw new Error("Invalid Tenor media");
        return [
            {
                id: item.id,
                title: item.title || item.h1_title || "",
                url: item.itemurl,
                src: selected.url,
                gif_src: gif.url,
                width: selected.dims[0],
                height: selected.dims[1],
                preview: selected.preview || gif.url,
            },
        ];
    }
    async search(query: { q: string; limit?: number; media_format: string; locale: string }): Promise<GifsResponse> {
        const limit = gifLimit(query.limit, 50);
        const data = await this.request("search", {
            q: query.q,
            limit: String(limit),
            locale: query.locale || "en_US",
        });
        return (data.results as Result[]).slice(0, limit).flatMap((item) => this.convert(item, query.media_format));
    }
    async getTrendingGifs(query: { media_format: string; locale: string }): Promise<GifsResponse> {
        const locale = query.locale || "en_US";
        const format = query.media_format || "gif";
        return this.cached(this.trendingGifs, `${locale}:${format}`, 60 * 60 * 1000, async () => {
            const data = await this.request("trending", { limit: "50", locale });
            return (data.results as Result[]).slice(0, 50).flatMap((item) => this.convert(item, format));
        });
    }
    async getTrendingCategories(query: { locale: string }): Promise<GifTrendingCategory[]> {
        const locale = query.locale || "en_US";
        return this.cached(this.trendingCategories, locale, 24 * 60 * 60 * 1000, async () => {
            const data = await this.request("categories", { type: "featured", locale });
            return data.tags!.slice(0, 100).map((tag) => {
                if (!tag || !gifText(tag.searchterm) || !gifUrl(tag.image)) throw new Error("Invalid Tenor category");
                return { name: tag.searchterm, src: tag.image };
            });
        });
    }
    async suggest(query: { q: string; limit: number; locale: string }): Promise<string[]> {
        const limit = gifLimit(query.limit, 10);
        const data = await this.request("search_suggestions", {
            q: query.q,
            limit: String(limit),
            locale: query.locale || "en_US",
        });
        const suggestions = data.results!.slice(0, limit);
        if (!suggestions.every((value) => gifText(value))) throw new Error("Invalid Tenor suggestions");
        return suggestions as string[];
    }
}
