import { JsonSerializerOptions } from "./JsonSerializerOptions";
import { JsonWorkerPool } from "./JsonWorkerPool";
import { ReadStream, WriteStream } from "node:fs";
import { Readable } from "node:stream";
import { finished, pipeline } from "node:stream/promises";
import { parseJsonArray } from "./JsonArray";
import { JsonInput } from "./JsonInput";

const workerPool = new JsonWorkerPool();

// noinspection JSUnusedLocalSymbols - TODO: implement options
export class JsonSerializer {
    public static Serialize<T>(value: T, opts?: JsonSerializerOptions): string {
        return JSON.stringify(value);
    }
    public static async SerializeAsync<T>(value: T, opts?: JsonSerializerOptions): Promise<string> {
        return (await workerPool.request("serialize", value)) as string;
    }
    public static Deserialize<T>(json: string, opts?: JsonSerializerOptions): T {
        return JSON.parse(json) as T;
    }
    public static async DeserializeAsync<T>(json: string | ReadableStream | ReadStream, opts?: JsonSerializerOptions): Promise<T> {
        if (json instanceof ReadableStream) return this.DeserializeAsyncReadableStream<T>(json, opts);
        if (json instanceof ReadStream) return this.DeserializeAsyncReadStream<T>(json, opts);

        return (await workerPool.request("deserialize", json)) as T;
    }

    private static async *textChunks(stream: ReadableStream | ReadStream): AsyncGenerator<string> {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        if (stream instanceof ReadableStream) {
            const reader = stream.getReader();
            let completed = false;
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        completed = true;
                        break;
                    }
                    yield typeof value === "string" ? decoder.decode() + value : decoder.decode(value, { stream: true });
                }
                yield decoder.decode();
            } finally {
                if (!completed) await reader.cancel().catch(() => {});
                reader.releaseLock();
            }
        } else {
            let completed = false;
            try {
                for await (const chunk of stream.iterator({ destroyOnReturn: false }))
                    yield typeof chunk === "string" ? decoder.decode() + chunk : decoder.decode(chunk, { stream: true });
                const tail = decoder.decode();
                completed = true;
                yield tail;
            } finally {
                if (!completed) stream.destroy();
                const cleanup = finished(stream, { cleanup: true });
                if (completed) await cleanup;
                else await cleanup.catch(() => {});
            }
        }
    }

    private static async DeserializeAsyncReadableStream<T>(jsonStream: ReadableStream, opts?: JsonSerializerOptions): Promise<T> {
        return this.DeserializeText<T>(jsonStream, opts);
    }

    private static async DeserializeAsyncReadStream<T>(jsonStream: ReadStream, opts?: JsonSerializerOptions): Promise<T> {
        return this.DeserializeText<T>(jsonStream, opts);
    }

    private static async DeserializeText<T>(jsonStream: ReadableStream | ReadStream, opts?: JsonSerializerOptions): Promise<T> {
        let input: JsonInput;
        try {
            input = new JsonInput();
        } catch (error) {
            await this.CancelInput(jsonStream);
            throw error;
        }
        try {
            for await (const chunk of this.textChunks(jsonStream)) input.append(chunk);
            return await this.DeserializeAsync<T>(input.value, opts);
        } finally {
            input.close();
        }
    }

    private static async CancelInput(stream: ReadableStream | ReadStream): Promise<void> {
        if (stream instanceof ReadStream) {
            stream.destroy();
            await finished(stream, { cleanup: true }).catch(() => {});
        } else await stream.cancel().catch(() => {});
    }

    public static async *DeserializeAsyncEnumerable<T>(json: string | ReadStream | ReadableStream, opts?: JsonSerializerOptions): AsyncGenerator<T, void, unknown> {
        if (json instanceof ReadableStream || json instanceof ReadStream) {
            try {
                return yield* parseJsonArray(this.textChunks(json), (value) => this.DeserializeAsync<T>(value, opts));
            } catch (error) {
                await this.CancelInput(json);
                throw error;
            }
        }
        const array = await this.DeserializeAsync<T[]>(json, opts);
        if (!Array.isArray(array)) throw new TypeError("Expected a JSON array");
        yield* array;
    }

    private static async *SerializeItems<T>(items: AsyncIterable<T>, opts?: JsonSerializerOptions): AsyncGenerator<string> {
        yield "[";
        let first = true;
        for await (const item of items) {
            const encoded = typeof item === "function" || typeof item === "symbol" ? "null" : ((await this.SerializeAsync(item, opts)) ?? "null");
            yield (first ? "" : ",") + encoded;
            first = false;
        }
        yield "]";
    }

    public static async SerializeAsyncEnumerableToStringAsync<T>(items: AsyncIterable<T>, opts?: JsonSerializerOptions): Promise<string> {
        let jsonData = "";
        for await (const chunk of this.SerializeItems(items, opts)) jsonData += chunk;
        return jsonData;
    }

    public static async SerializeAsyncEnumerableAsync<T>(items: AsyncIterable<T>, stream: WriteStream | WritableStream, opts?: JsonSerializerOptions): Promise<void> {
        if (stream instanceof WritableStream) return this.SerializeAsyncEnumerableToWritableStreamAsync(items, stream, opts);
        if (stream instanceof WriteStream) return this.SerializeAsyncEnumerableToWriteStreamAsync(items, stream, opts);
        throw new TypeError("Expected a writable JSON stream");
    }

    private static async SerializeAsyncEnumerableToWritableStreamAsync<T>(items: AsyncIterable<T>, stream: WritableStream, opts?: JsonSerializerOptions): Promise<void> {
        const writer = stream.getWriter();
        const encoder = new TextEncoder();
        try {
            for await (const chunk of this.SerializeItems(items, opts)) await writer.write(encoder.encode(chunk));
            await writer.close();
        } catch (error) {
            await writer.abort(error).catch(() => {});
            throw error;
        } finally {
            writer.releaseLock();
        }
    }

    private static async SerializeAsyncEnumerableToWriteStreamAsync<T>(items: AsyncIterable<T>, stream: WriteStream, opts?: JsonSerializerOptions): Promise<void> {
        await pipeline(Readable.from(this.SerializeItems(items, opts), { objectMode: false, highWaterMark: 1 }), stream);
    }
}
