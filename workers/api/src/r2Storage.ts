import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export const r2Storage = (bucket: R2Bucket) => {
    const copy = async (path: string, newPath: string) => {
        const object = await bucket.get(path);
        if (!object) throw new Error(`${path} does not exist`);
        await bucket.put(newPath, await object.arrayBuffer(), { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata });
    };
    return {
        async openRead(path: string) {
            const object = await bucket.get(path);
            if (!object) return null;
            return { size: object.size, generation: object.etag, stream: Readable.fromWeb(object.body as unknown as NodeReadableStream) };
        },
        async set(path: string, data: Buffer, principal?: string) {
            await bucket.put(path, data, { customMetadata: { principal: principal ?? "" } });
        },
        clone: copy,
        async get(path: string) {
            const object = await bucket.get(path);
            return object ? Buffer.from(await object.arrayBuffer()) : null;
        },
        async delete(path: string) {
            await bucket.delete(path);
        },
        async exists(path: string) {
            return !!(await bucket.head(path));
        },
        async isFile(path: string) {
            return !!(await bucket.head(path));
        },
        async move(path: string, newPath: string) {
            await copy(path, newPath);
            await bucket.delete(path);
        },
    };
};
