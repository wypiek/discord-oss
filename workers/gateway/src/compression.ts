import zlib from "node:zlib";

const zlibHeader = Buffer.from([0x78, 0x9c]);
const zstdChunk = 32 * 1024;

export class StatelessDeflate {
    constructor(public headerSent = false) {}

    process(data: Buffer | string) {
        const body = Buffer.from(zlib.deflateRawSync(typeof data === "string" ? Buffer.from(data) : data, { finishFlush: zlib.constants.Z_SYNC_FLUSH }));
        if (this.headerSent) return body;
        this.headerSent = true;
        return Buffer.concat([zlibHeader, body]);
    }

    close() {}
}

export const zstdAvailable = typeof zlib.zstdCompressSync === "function";

export class FramedZstd {
    process(data: Buffer | string) {
        const input = typeof data === "string" ? Buffer.from(data) : data;
        const frames: Buffer[] = [];
        for (let offset = 0; offset < input.length || offset === 0; offset += zstdChunk)
            frames.push(Buffer.from(zlib.zstdCompressSync(input.subarray(offset, offset + zstdChunk))));
        return frames.length === 1 ? frames[0] : Buffer.concat(frames);
    }

    destroy() {}
}
