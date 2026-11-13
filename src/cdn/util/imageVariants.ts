import crypto from "node:crypto";
import { Request, Response } from "express";
import { fileTypeFromBuffer } from "file-type";
import type { Sharp, SharpOptions } from "sharp";
import { safeMediaType } from "./responseSafety";

export type ImageFormat = "gif" | "webp" | "png" | "jpeg" | "avif";
export type ImageVariant = { format?: ImageFormat; size?: number; animated: boolean; lossless: boolean };
export type RenderedImage = { body: Buffer; mime: string };

export const IMAGE_SIZE_MIN = 16;
export const IMAGE_SIZE_MAX = 4096;
const RENDER_TIMEOUT_SECONDS = 20;
const RENDER_CONCURRENCY = 2;
const RENDER_QUEUE_MAX = 64;
const CACHE_BYTES = 64 * 1024 * 1024;
const CACHE_ENTRY_BYTES = 16 * 1024 * 1024;

const EXTENSION_FORMATS: Record<string, ImageFormat> = { gif: "gif", webp: "webp", png: "png", jpg: "jpeg", jpeg: "jpeg", avif: "avif" };
const FORMAT_MIME: Record<ImageFormat, string> = { gif: "image/gif", webp: "image/webp", png: "image/png", jpeg: "image/jpeg", avif: "image/avif" };
const MIME_FORMAT: Record<string, ImageFormat> = { "image/gif": "gif", "image/webp": "webp", "image/png": "png", "image/jpeg": "jpeg", "image/avif": "avif" };
const RENDERABLE_MIME_TYPES = new Set(["image/gif", "image/webp", "image/png", "image/apng", "image/jpeg", "image/avif"]);
const ANIMATABLE_FORMATS = new Set<ImageFormat>(["gif", "webp"]);
const SEQUENCE_DECODABLE_MIME_TYPES = new Set(["image/gif", "image/webp"]);

const queryString = (value: unknown) => (typeof value === "string" ? value : Array.isArray(value) && typeof value[0] === "string" ? value[0] : undefined);

export function imageVariant(filename: string, query: Request["query"]): ImageVariant {
    const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
    const format = extension ? EXTENSION_FORMATS[extension] : undefined;
    const requestedSize = Number(queryString(query.size));
    const size = Number.isInteger(requestedSize) && requestedSize > 0 ? Math.min(IMAGE_SIZE_MAX, Math.max(IMAGE_SIZE_MIN, requestedSize)) : undefined;
    const animatedQuery = queryString(query.animated);
    const animated = format === undefined || (format === "gif" ? animatedQuery !== "false" : format === "webp" && animatedQuery === "true");
    return { format, size, animated, lossless: queryString(query.quality) === "lossless" };
}

function gifFrameCount(buffer: Buffer, stopAfter: number) {
    if (buffer.length < 13 || buffer.toString("latin1", 0, 3) !== "GIF") return 0;
    let offset = 13;
    if (buffer[10] & 0x80) offset += 3 * 2 ** ((buffer[10] & 0x07) + 1);
    const skipSubBlocks = (start: number) => {
        let position = start;
        while (position < buffer.length && buffer[position] !== 0) position += buffer[position] + 1;
        return position + 1;
    };
    let frames = 0;
    while (offset < buffer.length) {
        const block = buffer[offset];
        if (block === 0x3b) break;
        if (block === 0x21) {
            offset = skipSubBlocks(offset + 2);
            continue;
        }
        if (block !== 0x2c || offset + 10 > buffer.length) break;
        frames++;
        if (frames >= stopAfter) break;
        const packed = buffer[offset + 9];
        offset += 10;
        if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1);
        offset = skipSubBlocks(offset + 1);
    }
    return frames;
}

function pngIsAnimated(buffer: Buffer) {
    let offset = 8;
    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString("latin1", offset + 4, offset + 8);
        if (type === "acTL") return true;
        if (type === "IDAT" || type === "IEND") return false;
        offset += length + 12;
    }
    return false;
}

function avifIsAnimated(buffer: Buffer) {
    if (buffer.length < 16 || buffer.toString("latin1", 4, 8) !== "ftyp") return false;
    const end = Math.min(buffer.length, buffer.readUInt32BE(0));
    for (let offset = 8; offset + 4 <= end; offset += 4) if (buffer.toString("latin1", offset, offset + 4) === "avis") return true;
    return false;
}

export function isAnimatedImage(buffer: Buffer, mime: string | undefined) {
    switch (mime) {
        case "image/gif":
        case "image/gifv":
            return gifFrameCount(buffer, 2) > 1;
        case "image/apng":
        case "image/png":
            return pngIsAnimated(buffer);
        case "image/webp":
            return buffer.length >= 21 && buffer.toString("latin1", 12, 16) === "VP8X" && (buffer[20] & 0x02) !== 0;
        case "image/avif":
            return avifIsAnimated(buffer);
        default:
            return false;
    }
}

export const imageHash = (buffer: Buffer, mime: string | undefined) => `${isAnimatedImage(buffer, mime) ? "a_" : ""}${crypto.createHash("md5").update(buffer).digest("hex")}`;

type SharpFactory = (input?: Buffer, options?: SharpOptions) => Sharp;
let sharpFactory: Promise<SharpFactory | null> | undefined;
const loadSharp = () =>
    (sharpFactory ??= import("sharp").then(
        (module) => (module.default ?? module) as unknown as SharpFactory,
        () => null,
    ));

export async function renderImageVariant(source: Buffer, sourceMime: string | undefined, variant: ImageVariant): Promise<RenderedImage> {
    const original = { body: source, mime: safeMediaType(sourceMime) };
    const format = variant.format;
    if (!format || !sourceMime || !RENDERABLE_MIME_TYPES.has(sourceMime)) return original;
    const sourceAnimated = isAnimatedImage(source, sourceMime);
    const animated = variant.animated && sourceAnimated && ANIMATABLE_FORMATS.has(format);
    if (animated && !SEQUENCE_DECODABLE_MIME_TYPES.has(sourceMime)) return original;
    const sharp = await loadSharp();
    if (!sharp) return original;
    const metadata = await sharp(source, { animated }).metadata();
    const width = metadata.width ?? 0;
    const frameHeight = metadata.pageHeight ?? metadata.height ?? 0;
    if (width < 1 || frameHeight < 1) return original;
    const scale = variant.size ? Math.min(1, variant.size / Math.max(width, frameHeight)) : 1;
    if (scale === 1 && MIME_FORMAT[sourceMime] === format && animated === sourceAnimated) return original;
    let image = sharp(source, { animated, pages: animated ? -1 : 1 }).timeout({ seconds: RENDER_TIMEOUT_SECONDS });
    if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(frameHeight * scale)), fit: "fill" });
    const timing = animated ? { loop: metadata.loop ?? 0, ...(metadata.delay?.length ? { delay: metadata.delay } : {}) } : {};
    switch (format) {
        case "gif":
            image = image.gif(timing);
            break;
        case "webp":
            image = image.webp({ ...timing, ...(variant.lossless ? { lossless: true } : { quality: 90 }), effort: 2 });
            break;
        case "png":
            image = image.png();
            break;
        case "jpeg":
            image = image.flatten({ background: "#000000" }).jpeg({ quality: variant.lossless ? 100 : 90 });
            break;
        case "avif":
            image = image.avif({ ...(variant.lossless ? { lossless: true } : { quality: 70 }), effort: 2 });
            break;
    }
    return { body: await image.toBuffer(), mime: FORMAT_MIME[format] };
}

const cache = new Map<string, RenderedImage>();
const pending = new Map<string, Promise<RenderedImage>>();
const waiting: (() => void)[] = [];
let cachedBytes = 0;
let rendering = 0;

function remember(key: string, image: RenderedImage) {
    if (image.body.length > CACHE_ENTRY_BYTES) return;
    cache.delete(key);
    cache.set(key, image);
    cachedBytes += image.body.length;
    for (const [oldest, entry] of cache) {
        if (cachedBytes <= CACHE_BYTES) break;
        cache.delete(oldest);
        cachedBytes -= entry.body.length;
    }
}

async function withRenderSlot<T>(task: () => Promise<T>, fallback: () => T): Promise<T> {
    if (rendering >= RENDER_CONCURRENCY) {
        if (waiting.length >= RENDER_QUEUE_MAX) return fallback();
        await new Promise<void>((resolve) => waiting.push(resolve));
    } else rendering++;
    try {
        return await task();
    } finally {
        const next = waiting.shift();
        if (next) next();
        else rendering--;
    }
}

export async function cachedImageVariant(key: string, source: Buffer, variant: ImageVariant): Promise<RenderedImage> {
    const sourceMime = (await fileTypeFromBuffer(source))?.mime;
    if (!variant.format || !sourceMime || !RENDERABLE_MIME_TYPES.has(sourceMime)) return { body: source, mime: safeMediaType(sourceMime) };
    const fingerprint = `${source.length}:${source.subarray(-32).toString("hex")}`;
    const cacheKey = `${key}:${fingerprint}:${variant.format}:${variant.size ?? 0}:${variant.animated}:${variant.lossless}`;
    const hit = cache.get(cacheKey);
    if (hit) {
        cache.delete(cacheKey);
        cache.set(cacheKey, hit);
        return hit;
    }
    const inFlight = pending.get(cacheKey);
    if (inFlight) return inFlight;
    const original = () => ({ body: source, mime: safeMediaType(sourceMime) });
    const render = withRenderSlot(
        () =>
            renderImageVariant(source, sourceMime, variant).then(
                (image) => {
                    remember(cacheKey, image);
                    return image;
                },
                (error) => {
                    console.error(`[CDN] Could not render ${key}:`, (error as Error).message);
                    return original();
                },
            ),
        original,
    ).finally(() => pending.delete(cacheKey));
    pending.set(cacheKey, render);
    return render;
}

export async function sendImage(req: Request, res: Response, storagePath: string, file: Buffer) {
    const filename = req.path.split("/").pop() ?? "";
    const image = await cachedImageVariant(storagePath, file, imageVariant(filename, req.query));
    res.set("Content-Type", safeMediaType(image.mime));
    return res.send(image.body);
}
