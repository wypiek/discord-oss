import { GifsResponse, GifTrendingCategory } from "@spacebar/schemas";

export interface IGifProvider {
    id: string;
    available: boolean;

    init(): Promise<void>;
    search(query: { q: string; limit?: number; media_format: string; locale: string }): Promise<GifsResponse>;
    getTrendingCategories(query: { media_format: string; locale: string }): Promise<GifTrendingCategory[]>;
    getTrendingGifs(query: { q: string; limit?: number; media_format: string; locale: string }): Promise<GifsResponse>;
    suggest?(query: { q: string; limit: number; locale: string }): Promise<string[]>;
}
