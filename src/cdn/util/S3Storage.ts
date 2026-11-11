import { Readable } from "node:stream";
import type { Storage, StorageRead } from "./Storage";

const readableToBuffer = (readable: Readable): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        readable.on("data", (chunk) => chunks.push(chunk));
        readable.on("error", reject);
        readable.on("end", () => resolve(Buffer.concat(chunks)));
    });

export class S3Storage implements Storage {
    readonly remoteGenerationConfirmation = true;
    private client: unknown;
    public constructor(
        private region: string,
        private bucket: string,
        private endpoint: string,
        private forcePathStyle: boolean,
        private basePath?: string,
    ) {
        const { S3 } = require("@aws-sdk/client-s3");
        this.client = new S3({ region: region, endpoint: endpoint, forcePathStyle: forcePathStyle });
    }
    isFile(path: string): Promise<boolean> {
        return this.exists(path);
    }

    /**
     * Always return a string, to ensure consistency.
     */
    get bucketBasePath() {
        return this.basePath ?? "";
    }

    async *inventory(): AsyncIterable<{ path: string; size: number; generation?: string }> {
        const client = this.client as {
            headObject(input: { Bucket: string; Key: string }, options: { abortSignal: AbortSignal }): Promise<{ ContentLength?: number; Metadata?: Record<string, string> }>;
            listObjectsV2(
                input: { Bucket: string; Prefix: string; ContinuationToken?: string },
                options?: { abortSignal: AbortSignal },
            ): Promise<{
                Contents?: { Key?: string; Size?: number }[];
                IsTruncated?: boolean;
                NextContinuationToken?: string;
            }>;
        };
        let token: string | undefined;
        do {
            const page = await client.listObjectsV2({ Bucket: this.bucket, Prefix: this.bucketBasePath, ContinuationToken: token }, { abortSignal: AbortSignal.timeout(30000) });
            for (const object of page.Contents ?? []) {
                if (typeof object.Key !== "string" || !object.Key.startsWith(this.bucketBasePath) || !Number.isSafeInteger(object.Size) || object.Size! < 0)
                    throw new Error("Invalid S3 inventory metadata");
                const current = await client.headObject({ Bucket: this.bucket, Key: object.Key }, { abortSignal: AbortSignal.timeout(30000) });
                if (!Number.isSafeInteger(current.ContentLength) || current.ContentLength! < 0) throw new Error("Invalid S3 inventory object size");
                yield { path: object.Key.slice(this.bucketBasePath.length), size: current.ContentLength!, generation: current.Metadata?.generation };
            }
            if (page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken === token)) throw new Error("S3 inventory pagination stalled");
            token = page.IsTruncated ? page.NextContinuationToken : undefined;
        } while (token);
    }

    async set(path: string, data: Buffer, _principal?: string, generation?: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        await this.client.putObject(
            {
                Bucket: this.bucket,
                Key: `${this.bucketBasePath}${path}`,
                Body: data,
                ...(generation ? { Metadata: { generation } } : {}),
            },
            { abortSignal: AbortSignal.timeout(30000) },
        );
    }

    async clone(path: string, newPath: string, generation?: string): Promise<void> {
        // TODO: does this even work?
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        await this.client.copyObject(
            {
                Bucket: this.bucket,
                CopySource: `/${this.bucket}/${encodeURIComponent(`${this.bucketBasePath}${path}`).replaceAll("%2F", "/")}`,
                Key: `${this.bucketBasePath}${newPath}`,
                ...(generation ? { MetadataDirective: "REPLACE", Metadata: { generation } } : {}),
            },
            { abortSignal: AbortSignal.timeout(30000) },
        );
    }

    async openRead(path: string, signal?: AbortSignal): Promise<StorageRead | null> {
        signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
        const client = this.client as {
            getObject(
                input: { Bucket: string; Key: string },
                options: { abortSignal?: AbortSignal },
            ): Promise<{ Body?: Readable; ContentLength?: number; Metadata?: Record<string, string> }>;
        };
        try {
            const object = await client.getObject({ Bucket: this.bucket, Key: `${this.bucketBasePath}${path}` }, { abortSignal: signal });
            if (!object.Body) return null;
            if (!Number.isSafeInteger(object.ContentLength) || (object.ContentLength ?? -1) < 0 || !(object.Body instanceof Readable)) {
                object.Body.destroy();
                throw new Error("Invalid storage stream metadata");
            }
            object.Body.on("error", () => undefined);
            if (signal) {
                const abort = () => object.Body?.destroy(new Error("Storage read aborted"));
                signal.addEventListener("abort", abort, { once: true });
                object.Body.once("close", () => signal.removeEventListener("abort", abort));
                if (signal.aborted) abort();
            }
            return { size: object.ContentLength as number, stream: object.Body, generation: object.Metadata?.generation };
        } catch (error) {
            if (["NoSuchKey", "NotFound"].includes((error as Error).name)) return null;
            throw error;
        }
    }

    async get(path: string): Promise<Buffer | null> {
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            const s3Object = await this.client.getObject({
                Bucket: this.bucket,
                Key: `${this.bucketBasePath ?? ""}${path}`,
            });

            if (!s3Object.Body) return null;

            const body = s3Object.Body;

            return await readableToBuffer(<Readable>body);
        } catch (err) {
            console.error(`[CDN] Unable to get S3 object at path ${path}.`);
            console.error(err);
            return null;
        }
    }

    async delete(path: string): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        await this.client.deleteObject(
            {
                Bucket: this.bucket,
                Key: `${this.bucketBasePath}${path}`,
            },
            { abortSignal: AbortSignal.timeout(30000) },
        );
    }

    async exists(path: string): Promise<boolean> {
        try {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            await this.client.headObject({
                Bucket: this.bucket,
                Key: `${this.bucketBasePath}${path}`,
            });
            return true;
        } catch (err) {
            if (err && typeof err === "object" && "name" in err && (err as { [key: string]: string }).name === "NotFound") {
                return false;
            }
            console.error(`[CDN] Unable to check existence of S3 object at path ${path}.`);
            console.error(err);
            return false;
        }
    }

    async move(path: string, newPath: string): Promise<void> {
        await this.clone(path, newPath);
        await this.delete(path);
    }
}
