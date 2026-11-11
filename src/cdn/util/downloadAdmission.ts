import { Readable } from "node:stream";
import { HTTPError } from "lambert-server/HTTPError";

export const PREVIEW_INPUT_LIMIT = 64 * 1024 * 1024;
const DOWNLOAD_CONCURRENCY = 32;
const PREVIEW_BYTE_BUDGET = 128 * 1024 * 1024;
let downloads = 0;
let previewBytes = 0;

export function admitDownload(): () => void {
    if (downloads >= DOWNLOAD_CONCURRENCY) throw new HTTPError("Download capacity is busy", 503);
    downloads++;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        downloads--;
    };
}

export function admitPreview(size: number): () => void {
    if (!Number.isSafeInteger(size) || size < 0) throw new HTTPError("Invalid storage size", 502);
    if (size > PREVIEW_INPUT_LIMIT) throw new HTTPError("Unable to render a preview frame", 415);
    if (previewBytes + size * 2 > PREVIEW_BYTE_BUDGET) throw new HTTPError("Preview capacity is busy", 503);
    previewBytes += size * 2;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        previewBytes -= size * 2;
    };
}

export async function inspectDownload(stream: Readable, size: number) {
    if (!Number.isSafeInteger(size) || size < 0) throw new HTTPError("Invalid storage size", 502);
    const iterator = stream[Symbol.asyncIterator]();
    const initial: Buffer[] = [];
    let initialBytes = 0;
    while (initialBytes < Math.min(4100, size)) {
        const next = await iterator.next();
        if (next.done) break;
        const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
        initialBytes += chunk.length;
        if (initialBytes > size) throw new HTTPError("Storage size mismatch", 502);
        initial.push(chunk);
    }
    const chunks = async function* () {
        let bytes = initialBytes;
        for (const chunk of initial) yield chunk;
        while (true) {
            const next = await iterator.next();
            if (next.done) break;
            const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
            bytes += chunk.length;
            if (bytes > size) throw new HTTPError("Storage size mismatch", 502);
            yield chunk;
        }
        if (bytes !== size) throw new HTTPError("Storage size mismatch", 502);
    };
    return {
        prefix: Buffer.concat(initial, Math.min(initialBytes, 64 * 1024)),
        stream: Readable.from(chunks()),
    };
}
