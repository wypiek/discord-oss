import { Readable } from "node:stream";
import path from "node:path";
import fs from "node:fs";
import { red } from "picocolors";
process.cwd();

export interface StorageRead {
    size: number;
    generation?: string;
    stream: Readable;
}

export interface Storage {
    openRead?(path: string, signal?: AbortSignal): Promise<StorageRead | null>;
    set(path: string, data: Buffer, principal?: string, generation?: string): Promise<void>;
    clone(path: string, newPath: string, generation?: string): Promise<void>;
    get(path: string): Promise<Buffer | null>;
    delete(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    isFile(path: string): Promise<boolean>;
    move(path: string, newPath: string): Promise<void>;
}

let storage: Storage;

if (process.env.STORAGE_PROVIDER === "file" || !process.env.STORAGE_PROVIDER) {
    let location = process.env.STORAGE_LOCATION;
    if (location) {
        location = path.resolve(location);
    } else {
        location = path.join(process.cwd(), "files");
    }
    // TODO: move this to some start func, so it doesn't run when server is imported
    //console.log(`[CDN] storage location: ${bgCyan(`${black(location)}`)}`);
    if (!fs.existsSync(location)) fs.mkdirSync(location);
    process.env.STORAGE_LOCATION = location;

    const { FileStorage } = require("./FileStorage");
    storage = new FileStorage();
} else if (process.env.STORAGE_PROVIDER === "s3") {
    try {
        require("@aws-sdk/client-s3");
    } catch {
        console.error(red(`[CDN] AWS S3 SDK not installed. Please run 'bun add @aws-sdk/client-s3' to use the S3 storage provider.`));
        process.exit(1);
    }

    const region = process.env.STORAGE_REGION,
        bucket = process.env.STORAGE_BUCKET;

    if (!region) {
        console.error(`[CDN] You must provide a region when using the S3 storage provider.`);
        process.exit(1);
    }

    let endpoint = process.env.STORAGE_ENDPOINT;

    if (!endpoint) {
        endpoint = `https://s3.${region}.amazonaws.com`;
    }

    if (!bucket) {
        console.error(`[CDN] You must provide a bucket when using the S3 storage provider.`);
        process.exit(1);
    }

    // in the S3 provider, this should be the root path in the bucket
    let location = process.env.STORAGE_LOCATION;

    if (!location) {
        console.warn(`[CDN] STORAGE_LOCATION unconfigured for S3 provider, defaulting to the bucket root...`);
        location = undefined;
    }

    // if false, the bucket name is used as a subdomain
    const forcePathStyle = process.env.STORAGE_FORCE_PATH_STYLE === "true";

    if (process.env.STORAGE_FORCE_PATH_STYLE === undefined) {
        console.warn(
            `[CDN] STORAGE_FORCE_PATH_STYLE is not set for S3 provider; defaulting to virtual-hosted style. Set STORAGE_FORCE_PATH_STYLE=true to enable path-style addressing.`,
        );
    }

    const { S3Storage } = require("./S3Storage");
    storage = new S3Storage(region, bucket, endpoint, forcePathStyle, location);
}

const { QuotaStorage } = require("./RuntimeQuotaStorage");
storage = new QuotaStorage(
    storage!,
    process.env.STORAGE_PROVIDER === "s3"
        ? `s3:${process.env.STORAGE_ENDPOINT}:${process.env.STORAGE_BUCKET}:${process.env.STORAGE_LOCATION ?? ""}`
        : `file:${process.env.STORAGE_LOCATION}`,
);

export const useStorage = (backend: Storage) => {
    storage = backend;
};

export { storage };
