import { Deflate } from "fast-zlib";
import { ZstdStreamEncoder } from "./ZstdStream";

export const compressors: {
    deflate: () => Deflate;
    zstd: () => ZstdStreamEncoder | undefined;
} = {
    deflate: () => new Deflate(),
    zstd: () => new ZstdStreamEncoder(6),
};
