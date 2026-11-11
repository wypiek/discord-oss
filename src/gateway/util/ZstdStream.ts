import zlib from "node:zlib";

type SyncZlib = zlib.ZstdCompress & {
    _processChunk(chunk: Buffer, flushFlag: number): Buffer;
    _handle: { close(): void } | null;
};

class SyncStream {
    private stream: SyncZlib | null;
    private readonly errorKey: symbol | undefined;
    private readonly close: () => void;
    private readonly handle: { close(): void };
    private readonly handleClose: () => void;

    constructor(
        stream: zlib.ZstdCompress | zlib.ZstdDecompress,
        private readonly flag: number,
    ) {
        this.stream = stream as SyncZlib;
        this.errorKey = Object.getOwnPropertySymbols(stream).find((symbol) => symbol.toString().includes("kError"));
        this.close = this.stream.close;
        this.handle = this.stream._handle!;
        this.handleClose = this.handle.close;
    }

    process(data: Buffer | string): Buffer {
        const stream = this.stream;
        if (!stream) throw new Error("zstd stream is closed");
        const input = typeof data === "string" ? Buffer.from(data) : data;
        stream.close = () => undefined;
        this.handle.close = () => undefined;
        try {
            return Buffer.from(stream._processChunk(input, this.flag));
        } finally {
            stream.close = this.close;
            stream._handle = this.handle;
            this.handle.close = this.handleClose;
            stream.removeAllListeners("error");
            if (this.errorKey) (stream as unknown as Record<symbol, unknown>)[this.errorKey] = null;
        }
    }

    destroy() {
        const stream = this.stream;
        if (!stream) return;
        this.stream = null;
        stream.close();
    }
}

export class ZstdStreamEncoder extends SyncStream {
    constructor(level = 6) {
        super(zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_compressionLevel]: level } }), zlib.constants.ZSTD_e_flush);
    }
}

export class ZstdStreamDecoder extends SyncStream {
    constructor() {
        super(zlib.createZstdDecompress(), zlib.constants.ZSTD_e_continue);
    }
}
