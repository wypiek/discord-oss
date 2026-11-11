import { constants, createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { finished } from "node:stream/promises";
import imageSize from "image-size";
import { Inflate } from "pako";

const maxBrandAssetBytes = 8 * 1024 * 1024;

export interface ImageAssetLimits {
    maxBytes?: number;
    timeoutMs?: number;
    maxSide?: number;
    maxPixels?: number;
}

const imageAssetLimits = (limits: ImageAssetLimits) => {
    const selected = {
        maxBytes: limits.maxBytes ?? maxBrandAssetBytes,
        timeoutMs: limits.timeoutMs ?? 5000,
        maxSide: limits.maxSide ?? 8192,
        maxPixels: limits.maxPixels ?? 16777216,
    };
    if (Object.values(selected).some((value) => !Number.isSafeInteger(value) || value <= 0)) return null;
    if (selected.maxBytes > maxBrandAssetBytes || selected.timeoutMs > 5000 || selected.maxSide > 8192 || selected.maxPixels > 16777216) return null;
    return selected;
};

const imageDimensionsFit = (width: number, height: number, maxSide: number, maxPixels: number) =>
    Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= maxSide && height <= maxSide && width * height <= maxPixels;

const gifFramesFit = (data: Buffer, maxSide: number, maxPixels: number) => {
    if (data.length < 13) return false;
    let offset = 13;
    if (data[10] & 128) offset += 3 * (1 << ((data[10] & 7) + 1));
    let frames = 0;
    const skipBlocks = () => {
        while (offset < data.length) {
            const bytes = data[offset++];
            if (!bytes) return true;
            offset += bytes;
            if (offset > data.length) return false;
        }
        return false;
    };
    while (offset < data.length) {
        const block = data[offset++];
        if (block === 59) return frames > 0;
        if (block === 33) {
            if (offset >= data.length) return false;
            offset++;
            if (!skipBlocks()) return false;
            continue;
        }
        if (block !== 44 || offset + 9 > data.length || ++frames > 256) return false;
        if (!imageDimensionsFit(data.readUInt16LE(offset + 4), data.readUInt16LE(offset + 6), maxSide, maxPixels)) return false;
        const colors = data[offset + 8];
        offset += 9;
        if (colors & 128) offset += 3 * (1 << ((colors & 7) + 1));
        if (offset >= data.length) return false;
        const codeSize = data[offset++];
        if (codeSize < 2 || codeSize > 8 || !skipBlocks()) return false;
    }
    return false;
};

const jpegRaster = (data: Buffer, maxSide: number, maxPixels: number) => {
    if (data.length < 4 || data.readUInt16BE(0) !== 65496) return null;
    let offset = 2;
    let pixels = 0;
    while (offset < data.length) {
        if (data[offset++] !== 255) return null;
        while (data[offset] === 255) offset++;
        const marker = data[offset++];
        if (marker === 217 || marker === 216 || marker === undefined) return null;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        if (offset + 2 > data.length) return null;
        const bytes = data.readUInt16BE(offset);
        if (bytes < 2 || offset + bytes > data.length) return null;
        if (marker >= 192 && marker <= 195) {
            if (bytes < 8) return null;
            const precision = data[offset + 2];
            const height = data.readUInt16BE(offset + 3);
            const width = data.readUInt16BE(offset + 5);
            const components = data[offset + 7];
            if (precision < 1 || precision > 16 || components < 1 || components > 4 || bytes < 8 + 3 * components) return null;
            if (!imageDimensionsFit(width, height, maxSide, maxPixels)) return null;
            for (let index = 0; index < components; index++) {
                const sampling = data[offset + 9 + 3 * index];
                if (sampling >> 4 < 1 || sampling >> 4 > 4 || (sampling & 15) < 1 || (sampling & 15) > 4) return null;
            }
            pixels += width * height;
            if (pixels > maxPixels) return null;
        }
        if (marker === 218) return pixels || null;
        offset += bytes;
    }
    return null;
};

const deflateBytes = (data: Buffer, limit: number) => {
    const inflater = new Inflate({ raw: true, chunkSize: Math.min(16384, Math.max(1, limit + 1)) });
    let bytes = 0;
    let completed = false;
    inflater.onData = (chunk: Uint8Array) => {
        if (chunk.byteLength > limit - bytes) throw new RangeError("image expansion exceeds its raster capacity");
        bytes += chunk.byteLength;
    };
    inflater.onEnd = (status: number) => {
        completed = status === 0;
    };
    try {
        return inflater.push(data, true) && completed ? bytes : null;
    } catch {
        return null;
    }
};

const tiffPagesFit = (data: Buffer, maxSide: number, maxPixels: number) => {
    if (data.length < 8) return false;
    const littleEndian = data.toString("ascii", 0, 2) === "II";
    const short = (offset: number) => (littleEndian ? data.readUInt16LE(offset) : data.readUInt16BE(offset));
    const long = (offset: number) => (littleEndian ? data.readUInt32LE(offset) : data.readUInt32BE(offset));
    if (short(2) !== 42) return false;
    const visited = new Set<number>();
    const sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];
    let offset = long(4);
    let entries = 0;
    let values = 0;
    let metadataBytes = 0;
    let pixels = 0;
    let tilePixels = 0;
    let jpegPixels = 0;
    let codecBytes = 0;
    let rasterBytes = 0;
    let tileBytes = 0;
    let inflatedBytes = 0;
    const byteLimit = maxPixels * 8;
    while (offset) {
        if (offset < 8 || offset + 6 > data.length || visited.has(offset) || visited.size >= 256) return false;
        visited.add(offset);
        const count = short(offset);
        entries += count;
        const end = offset + 2 + count * 12;
        if (entries > 4096 || end + 4 > data.length) return false;
        const dimensions = new Map<number, number>();
        const fields = new Map<number, { type: number; count: number; start: number }>();
        for (let index = offset + 2; index < end; index += 12) {
            const tag = short(index);
            const type = short(index + 2);
            const count = long(index + 4);
            const size = sizes[type];
            if (!size) return false;
            if (type !== 1 && type !== 2 && type !== 7) values += count;
            if (values > 65536) return false;
            const bytes = count * size;
            metadataBytes += bytes;
            if (metadataBytes > maxBrandAssetBytes) return false;
            const start = bytes > 4 || type === 11 ? long(index + 8) : index + 8;
            if (start > data.length || bytes > data.length - start) return false;
            if ([258, 259, 262, 273, 277, 278, 279, 324, 325, 347, 513, 50885].includes(tag)) fields.set(tag, { type, count, start });
            if (![256, 257, 322, 323].includes(tag)) continue;
            if (count !== 1 || (type !== 3 && type !== 4)) return false;
            dimensions.set(tag, type === 3 ? short(start) : long(start));
        }
        const width = dimensions.get(256);
        const height = dimensions.get(257);
        if (width !== undefined) {
            if (height === undefined || !imageDimensionsFit(width, height, maxSide, maxPixels)) return false;
            pixels += width * height;
            if (pixels > maxPixels) return false;
        }
        const tileWidth = dimensions.get(322);
        const tileHeight = dimensions.get(323);
        if (tileWidth !== undefined || tileHeight !== undefined) {
            if (tileWidth === undefined || tileHeight === undefined || !imageDimensionsFit(tileWidth, tileHeight, maxSide, maxPixels)) return false;
            tilePixels += tileWidth * tileHeight;
            if (tilePixels > maxPixels) return false;
        }
        const integer = (field: { type: number; count: number; start: number } | undefined, index = 0) => {
            if (!field || index >= field.count) return undefined;
            if (field.type === 1 || field.type === 7) return data[field.start + index];
            if (field.type === 3) return short(field.start + index * 2);
            if (field.type === 4 || field.type === 13) return long(field.start + index * 4);
            return undefined;
        };
        const compressionField = fields.get(259);
        const compression = compressionField ? integer(compressionField) : 1;
        if (compression === undefined || (compressionField && compressionField.count !== 1)) return false;
        let rowBytes = 0;
        let pageBytes = 0;
        let pageTileBytes = 0;
        let rows = 0;
        if (width !== undefined && height !== undefined) {
            const bits = fields.has(258) ? integer(fields.get(258)) : 1;
            const samples = fields.has(277) ? integer(fields.get(277)) : 1;
            const rowCount = fields.has(278) ? integer(fields.get(278)) : height;
            const canon = fields.has(50885) ? integer(fields.get(50885)) : 0;
            if (bits === undefined || bits < 1 || bits > 32 || samples === undefined || samples < 1 || samples > 8) return false;
            if (rowCount === undefined || !rowCount || canon === undefined) return false;
            rows = Math.min(rowCount, height);
            let bitsPerPixel = bits * samples;
            if (compression === 1 && fields.has(279) && fields.has(278) && integer(fields.get(262)) === 32803) {
                const stripBytes = integer(fields.get(279));
                if (stripBytes === undefined) return false;
                bitsPerPixel = Math.round((stripBytes * 8) / (width * rowCount));
            }
            if (canon === 4) bitsPerPixel = bits * 3;
            if (!Number.isSafeInteger(bitsPerPixel) || bitsPerPixel < 1) return false;
            rowBytes = Math.ceil((width * bitsPerPixel) / 8);
            pageBytes = rowBytes * height;
            rasterBytes += pageBytes;
            if (rasterBytes > byteLimit) return false;
            if (tileWidth !== undefined && tileHeight !== undefined) {
                pageTileBytes = Math.ceil((tileWidth * tileHeight * bitsPerPixel) / 8);
                tileBytes += pageTileBytes;
                if (tileBytes > byteLimit) return false;
            }
        }
        if (width !== undefined && [6, 7, 34892].includes(compression)) {
            const strips = tileWidth !== undefined ? fields.get(324) : (fields.get(273) ?? fields.get(324));
            const lengths = tileWidth !== undefined ? fields.get(325) : (fields.get(279) ?? fields.get(325));
            if (!strips || !lengths || !strips.count || strips.count !== lengths.count) return false;
            const tableField = fields.get(347);
            if (compression !== 6 && tableField && tableField.type !== 1 && tableField.type !== 7) return false;
            const tables = tableField ? data.subarray(tableField.start, tableField.start + tableField.count) : undefined;
            for (let index = 0; index < strips.count; index++) {
                let start = integer(strips, index);
                const bytes = integer(lengths, index);
                if (start === undefined || bytes === undefined || !bytes || start > data.length || bytes > data.length - start) return false;
                const end = start + bytes;
                let body = data.subarray(start, end);
                if (compression === 6) {
                    if (body.length < 2 || body.readUInt16BE(0) !== 65496) {
                        const interchange = integer(fields.get(513));
                        if (strips.count !== 1 || interchange === undefined || interchange > end - start) return false;
                        start += interchange;
                        body = data.subarray(start, end);
                    }
                    codecBytes += body.length;
                } else {
                    codecBytes += (tables?.length ?? 0) + body.length;
                    if (codecBytes > maxBrandAssetBytes) return false;
                    if (tables) {
                        let tableEnd = tables.length > 0 ? tables.length - 1 : 0;
                        for (let offset = 0; offset + 1 < tables.length; offset++) {
                            if (tables[offset] === 255 && tables[offset + 1] === 217) {
                                tableEnd = offset;
                                break;
                            }
                        }
                        body = Buffer.concat([tables.subarray(0, tableEnd), body.length >= 2 && body.readUInt16BE(0) === 65496 ? body.subarray(2) : body]);
                    }
                }
                if (codecBytes > maxBrandAssetBytes) return false;
                const raster = jpegRaster(body, maxSide, maxPixels);
                if (raster === null) return false;
                jpegPixels += raster;
                if (jpegPixels > maxPixels) return false;
            }
        }
        if (width !== undefined && [8, 32946].includes(compression)) {
            const strips = tileWidth !== undefined ? fields.get(324) : (fields.get(273) ?? fields.get(324));
            const lengths = tileWidth !== undefined ? fields.get(325) : (fields.get(279) ?? fields.get(325));
            if (!strips || !lengths || !strips.count || strips.count !== lengths.count) return false;
            for (let index = 0; index < strips.count; index++) {
                const start = integer(strips, index);
                const bytes = integer(lengths, index);
                if (start === undefined || bytes === undefined || bytes <= 6 || start > data.length || bytes > data.length - start) return false;
                codecBytes += bytes;
                if (codecBytes > maxBrandAssetBytes) return false;
                const capacity = tileWidth !== undefined ? pageTileBytes : pageBytes - index * rowBytes * rows;
                if (capacity <= 0) return false;
                const expanded = deflateBytes(data.subarray(start + 2, start + bytes - 4), Math.min(capacity, byteLimit - inflatedBytes));
                if (expanded === null) return false;
                inflatedBytes += expanded;
            }
        }
        offset = long(end);
    }
    return visited.size > 0;
};

class BrandAssetInput {
    private data: Buffer;
    private bytes = 0;

    constructor(private readonly limit: number) {
        this.data = Buffer.allocUnsafe(Math.min(65536, limit));
    }

    append(chunk: Uint8Array): boolean {
        if (chunk.byteLength > this.limit - this.bytes) return false;
        const next = this.bytes + chunk.byteLength;
        if (next > this.data.byteLength) {
            const expanded = Buffer.allocUnsafe(Math.min(this.limit, Math.max(next, this.data.byteLength * 2)));
            this.data.copy(expanded, 0, 0, this.bytes);
            this.data = expanded;
        }
        this.data.set(chunk, this.bytes);
        this.bytes = next;
        return true;
    }

    result(): Buffer {
        return Buffer.from(this.data.subarray(0, this.bytes));
    }
}

export async function readBrandAssetFile(file: string, limits: ImageAssetLimits = {}): Promise<Buffer | null> {
    const selected = imageAssetLimits(limits);
    if (!selected) return null;
    const signal = AbortSignal.timeout(selected.timeoutMs);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let stream: ReturnType<typeof createReadStream> | undefined;
    try {
        handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
        if (!(await handle.stat()).isFile() || signal.aborted) return null;
        stream = createReadStream(file, {
            fd: handle.fd,
            autoClose: false,
            highWaterMark: 65536,
            signal,
        });
        const input = new BrandAssetInput(selected.maxBytes);
        for await (const chunk of stream) if (!input.append(chunk)) return null;
        return input.result();
    } catch {
        return null;
    } finally {
        stream?.destroy();
        if (stream) await finished(stream).catch(() => {});
        await handle?.close().catch(() => {});
    }
}

export function withinBrandImageLimits(data: Buffer, limits: ImageAssetLimits = {}): boolean {
    const selected = imageAssetLimits(limits);
    if (!selected) return false;
    try {
        const { width, height, type } = imageSize(data);
        if (!imageDimensionsFit(width, height, selected.maxSide, selected.maxPixels)) return false;
        if (type === "gif") return gifFramesFit(data, selected.maxSide, selected.maxPixels);
        if (type === "tiff" || type === "bigtiff") return tiffPagesFit(data, selected.maxSide, selected.maxPixels);
        return true;
    } catch {
        return false;
    }
}

export async function fetchBrandAsset(url: string, requireImageType = false, limits: ImageAssetLimits = {}): Promise<{ data: Buffer; type: string } | null> {
    const selected = imageAssetLimits(limits);
    if (!selected) return null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let done = false;
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(selected.timeoutMs) });
        const type = response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
        if (!response.ok || Number(response.headers.get("content-length")) > selected.maxBytes || (requireImageType && !type.startsWith("image/"))) {
            await response.body?.cancel();
            return null;
        }
        if (!response.body) return null;
        reader = response.body.getReader();
        const input = new BrandAssetInput(selected.maxBytes);
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
                done = true;
                return { data: input.result(), type };
            }
            if (!input.append(chunk.value)) return null;
        }
    } catch {
        return null;
    } finally {
        if (reader) {
            if (!done) await reader.cancel().catch(() => {});
            reader.releaseLock();
        }
    }
}
