import path from "node:path";
import { Config } from "../../../util/util/Config";
import { ASSETS_FOLDER } from "../../../util/util/Constants";
import { PartialEmoji } from "@spacebar/schemas";
import { fetchBrandAsset, readBrandAssetFile, withinBrandImageLimits } from "../../../util/util/BrandAssetRequest";

const CACHE_LIMIT = 1024;
const MAX_COLOR_JOBS = 32;
const cache = new Map<string, Promise<string[]>>();
const activeKeys = new Set<string>();
const imageLimits = { maxBytes: 1024 * 1024, timeoutMs: 1500, maxSide: 1024, maxPixels: 1048576 };

const twemojiCode = (name: string) => [...(name.includes("‍") ? name : name.replace(/️/g, ""))].map((char) => char.codePointAt(0)!.toString(16)).join("-");

const fallbackPalette = (key: string): string[] => {
    let hash = 2166136261;
    for (const char of key) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619);
    const palettes = [
        ["#f9c23c", "#f28c28"],
        ["#ed6a9a", "#9b72cf"],
        ["#5ac8a8", "#50a7e5"],
        ["#a38bea", "#638be6"],
    ];
    return palettes[(hash >>> 0) % palettes.length];
};

const hex = (value: number) => Math.round(value).toString(16).padStart(2, "0");

function palette(data: Buffer | Uint8Array, count = 2) {
    const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
    for (let i = 0; i + 3 < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        bucket.n++;
        buckets.set(key, bucket);
    }
    const colors: [number, number, number][] = [];
    for (const { r, g, b, n } of [...buckets.values()].sort((a, b) => b.n - a.n)) {
        const color: [number, number, number] = [r / n, g / n, b / n];
        if (colors.some((c) => Math.abs(c[0] - color[0]) + Math.abs(c[1] - color[1]) + Math.abs(c[2] - color[2]) < 96)) continue;
        colors.push(color);
        if (colors.length >= count) break;
    }
    return colors.map(([r, g, b]) => `#${hex(r)}${hex(g)}${hex(b)}`);
}

async function loadColors(emoji: PartialEmoji, key: string): Promise<string[]> {
    try {
        let data: Buffer | null | undefined;
        if (emoji.id) {
            const endpoint = Config.get().cdn.endpointPrivate?.replace(/\/+$/, "");
            if (endpoint) {
                data = (await fetchBrandAsset(`${endpoint}/emojis/${emoji.id}.png?size=64`, false, imageLimits))?.data;
            }
        } else {
            const code = twemojiCode(emoji.name ?? "");
            if (/^[0-9a-f]+(?:-[0-9a-f]+)*$/.test(code)) {
                data = await readBrandAssetFile(path.join(ASSETS_FOLDER, "twemoji", "72x72", `${code}.png`), imageLimits);
            }
        }
        if (data && withinBrandImageLimits(data, imageLimits)) {
            const { Jimp } = await import("jimp");
            const image = await Jimp.read(data);
            const colors = palette(image.bitmap.data);
            if (colors.length) return colors;
        }
    } catch {
        return fallbackPalette(key);
    }
    return fallbackPalette(key);
}

export async function getBurstColors(emoji: PartialEmoji): Promise<string[]> {
    const key = emoji.id ? `id:${emoji.id}` : `unicode:${twemojiCode(emoji.name ?? "")}`;
    let pending = cache.get(key);
    if (pending) {
        cache.delete(key);
        cache.set(key, pending);
    } else {
        if (activeKeys.size >= MAX_COLOR_JOBS) return [...fallbackPalette(key)];
        if (cache.size >= CACHE_LIMIT) {
            const oldest = [...cache.keys()].find((cached) => !activeKeys.has(cached));
            if (oldest === undefined) return [...fallbackPalette(key)];
            cache.delete(oldest);
        }
        const source = { ...emoji };
        activeKeys.add(key);
        pending = Promise.resolve()
            .then(() => loadColors(source, key))
            .finally(() => activeKeys.delete(key));
        cache.set(key, pending);
    }
    return [...(await pending)];
}
