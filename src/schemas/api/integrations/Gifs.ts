export enum GifMediaTypes {
    gif,
    mediumgif,
    tinygif,
    nanogif,
    mp4,
    loopedmp4,
    tinymp4,
    nanomp4,
    webm,
    tinywebm,
    nanowebm,
}

export interface GifResponse {
    id: string;
    title: string;
    url: string;
    src: string;
    gif_src: string;
    width: number;
    height: number;
    preview: string;
}

export interface GifTrendingCategory {
    name: string;
    src: string;
}

export interface TrendingGifsResponse {
    categories: GifTrendingCategory[];
    gifs: GifResponse[];
}

export type GifsResponse = GifResponse[];
