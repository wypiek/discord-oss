import { Stats } from "node:fs";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import zlib from "node:zlib";

type Encoder = (body: Buffer, encoding: string) => Promise<Buffer>;
type Entry = { version: string; body: Buffer };
type Pending = { version: string; body: Promise<Buffer | null> };

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const zstd = promisify(zlib.zstdCompress);
const encode: Encoder = (body, encoding) => {
    if (encoding === "br") return brotli(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } });
    if (encoding === "zstd") return zstd(body, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 6 } });
    return gzip(body, { level: 6 });
};

export const clientAssetVersion = (stat: Stats) => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");

export class ClientAssetCompression {
    private entries = new Map<string, Entry>();
    private pending = new Map<string, Pending>();
    private bytes = 0;

    constructor(
        private limits = {
            bytes: 16 * 1024 * 1024,
            entries: 16,
            sourceBytes: 8 * 1024 * 1024,
            inflight: 2,
        },
        private encoder: Encoder = encode,
    ) {}

    async get(source: string, stat: Stats, encoding: string): Promise<Buffer | null> {
        const key = `${source}:${encoding}`;
        const version = clientAssetVersion(stat);
        const cached = this.entries.get(key);
        if (cached) {
            this.entries.delete(key);
            if (cached.version === version) {
                this.entries.set(key, cached);
                return cached.body;
            }
            this.bytes -= cached.body.length;
        }
        const pending = this.pending.get(key);
        if (pending?.version === version) return pending.body;
        if (pending || stat.size > this.limits.sourceBytes || this.pending.size >= this.limits.inflight) return null;
        const body = this.load(source, version, encoding);
        this.pending.set(key, { version, body });
        try {
            const compressed = await body;
            if (!compressed || compressed.length > this.limits.bytes || this.limits.entries < 1) return compressed;
            while (this.entries.size >= this.limits.entries || this.bytes + compressed.length > this.limits.bytes) {
                const oldest = this.entries.keys().next().value;
                if (oldest === undefined) break;
                this.bytes -= this.entries.get(oldest)!.body.length;
                this.entries.delete(oldest);
            }
            this.entries.set(key, { version, body: compressed });
            this.bytes += compressed.length;
            return compressed;
        } finally {
            this.pending.delete(key);
        }
    }

    private async load(source: string, version: string, encoding: string): Promise<Buffer | null> {
        const file = await fs.open(source, "r");
        try {
            const stat = await file.stat();
            if (clientAssetVersion(stat) !== version || stat.size > this.limits.sourceBytes) return null;
            const raw = Buffer.alloc(stat.size);
            let offset = 0;
            while (offset < raw.length) {
                const { bytesRead } = await file.read(raw, offset, raw.length - offset, offset);
                if (!bytesRead) return null;
                offset += bytesRead;
            }
            if (clientAssetVersion(await file.stat()) !== version) return null;
            const body = await this.encoder(raw, encoding);
            if (clientAssetVersion(await fs.stat(source)) !== version) return null;
            return body;
        } finally {
            await file.close();
        }
    }
}
