import fs from "node:fs";
import fsp from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import ExifTransformer from "exif-be-gone";
import { HTTPError } from "lambert-server/HTTPError";
import { QuotaStorageAdapter, QuotaWriteResult } from "./quotaStorage";
import { StorageQuotaRequest } from "./storageQuota";

interface Fingerprint {
    dev: string;
    ino: string;
    bytes: string;
    sha256: string;
}
interface Generation {
    deleted?: boolean;
    generation: string;
    fingerprint: Fingerprint;
}
interface Intent {
    namespace: string;
    id: string;
    path: string;
    upperBytes: string;
    kind: "write" | "clone";
    source?: { path: string; generation: string };
    prior: Generation | null;
    result: Fingerprint | null;
    temporary: string;
}
export interface FileQuotaAdapterOptions {
    transform?: () => Transform;
    checkpoint?: (step: "prepared" | "written" | "renamed" | "recorded" | "before-delete" | "deleted") => Promise<void>;
}
const METADATA = ".storage-quota";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const same = (a: Fingerprint, b: Fingerprint) => a.dev === b.dev && a.ino === b.ino && a.bytes === b.bytes && a.sha256 === b.sha256;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export class FileQuotaStorageAdapter implements QuotaStorageAdapter {
    private root: Promise<string>;
    constructor(
        root: string,
        private namespace: string,
        private options: FileQuotaAdapterOptions = {},
    ) {
        this.root = this.initialize(root);
    }
    private async initialize(root: string) {
        const absolute = resolve(root);
        const stat = await fsp.lstat(absolute);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new HTTPError("Unsafe storage root", 503);
        const canonical = await fsp.realpath(absolute);
        for (const part of [METADATA, `${METADATA}/objects`, `${METADATA}/operations`, `${METADATA}/locks`]) await this.safePath(canonical, part, true);
        if (!this.namespace || this.namespace.length > 128) throw new HTTPError("Invalid storage namespace", 400);
        const binding = await this.safePath(canonical, `${METADATA}/namespace.json`);
        let handle;
        try {
            handle = await fsp.open(binding, "wx", 0o600);
            await handle.writeFile(JSON.stringify({ namespace: this.namespace }));
            await handle.sync();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        } finally {
            await handle?.close();
        }
        await this.syncDirectory(dirname(binding));
        const stored = await this.read<{ namespace: string }>(binding);
        if (!stored || stored.namespace !== this.namespace) throw new HTTPError("Storage namespace requires reviewed inventory migration", 503);
        return canonical;
    }
    private validate(path: string) {
        if (
            !path ||
            path.length > 2048 ||
            isAbsolute(path) ||
            /[\\\0]/.test(path) ||
            !path.split("/").every((part) => part && part !== "." && part !== "..") ||
            path.split("/")[0] === METADATA
        )
            throw new HTTPError("Invalid storage path", 400);
    }
    private async safePath(root: string, path: string, directory = false) {
        const pieces = path.split("/");
        let current = root;
        for (let i = 0; i < pieces.length; i++) {
            current = join(current, pieces[i]);
            const wantDirectory = i < pieces.length - 1 || directory;
            try {
                const stat = await fsp.lstat(current);
                if (stat.isSymbolicLink() || (wantDirectory && !stat.isDirectory()) || (!wantDirectory && (!stat.isFile() || stat.nlink !== 1)))
                    throw new HTTPError("Unsafe storage object", 503);
            } catch (error) {
                if (!missing(error)) throw error;
                if (wantDirectory) {
                    await fsp.mkdir(current, { mode: 0o700 }).catch(async (error) => {
                        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
                        const stat = await fsp.lstat(current);
                        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new HTTPError("Unsafe storage directory", 503);
                    });
                }
            }
        }
        return current;
    }
    private async target(path: string) {
        this.validate(path);
        return this.safePath(await this.root, path);
    }
    private async metadata(kind: "objects" | "operations" | "locks", value: string) {
        return this.safePath(await this.root, `${METADATA}/${kind}/${digest(value)}`);
    }
    private async fingerprint(path: string): Promise<Fingerprint | null> {
        let handle;
        try {
            handle = await fsp.open(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            const before = await handle.stat({ bigint: true });
            if (!before.isFile() || before.nlink !== 1n) throw new HTTPError("Unsafe storage object", 503);
            const hash = createHash("sha256");
            for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
            const after = await handle.stat({ bigint: true });
            if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)
                throw new HTTPError("Storage object changed during verification", 409);
            return {
                dev: after.dev.toString(),
                ino: after.ino.toString(),
                bytes: after.size.toString(),
                sha256: hash.digest("hex"),
            };
        } catch (error) {
            if (missing(error)) return null;
            throw error;
        } finally {
            await handle?.close();
        }
    }
    private async read<T>(path: string): Promise<T | null> {
        let handle;
        try {
            handle = await fsp.open(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16384) throw new HTTPError("Invalid storage metadata", 503);
            return JSON.parse(await handle.readFile("utf8")) as T;
        } catch (error) {
            if (missing(error)) return null;
            throw error;
        } finally {
            await handle?.close();
        }
    }
    private async syncDirectory(path: string) {
        const handle = await fsp.open(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
            await handle.sync();
        } finally {
            await handle.close();
        }
    }
    private async record(path: string, value: unknown) {
        const temporary = `${path}.${randomUUID()}.tmp`;
        const handle = await fsp.open(temporary, "wx", 0o600);
        try {
            await handle.writeFile(JSON.stringify(value));
            await handle.sync();
        } finally {
            await handle.close();
        }
        try {
            await fsp.rename(temporary, path);
            await this.syncDirectory(dirname(path));
        } finally {
            await fsp.unlink(temporary).catch((error) => {
                if (!missing(error)) throw error;
            });
        }
    }
    private async generation(path: string): Promise<Generation | null> {
        const target = await this.target(path);
        const record = await this.read<Generation>(await this.metadata("objects", path));
        const actual = await this.fingerprint(target);
        if ((!record || record.deleted) && !actual) return null;
        if (!record || !actual || typeof record.generation !== "string" || !record.fingerprint || !same(record.fingerprint, actual))
            throw new HTTPError("Uninventoried or changed storage object", 503);
        return record;
    }
    private async locked<T>(paths: string[], callback: () => Promise<T>): Promise<T> {
        const locks = [];
        try {
            for (const path of [...new Set(paths)].sort()) {
                this.validate(path);
                const lock = join(await this.root, METADATA, "locks", digest(path));
                await this.safePath(await this.root, `${METADATA}/locks`, true);
                await fsp.mkdir(lock, { mode: 0o700 }).catch((error) => {
                    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new HTTPError("Storage object is busy or requires recovery", 409);
                    throw error;
                });
                locks.push(lock);
            }
            return await callback();
        } finally {
            for (const lock of locks.reverse()) await fsp.rmdir(lock);
        }
    }
    private checkRequest(request: StorageQuotaRequest) {
        if (
            request.namespace !== this.namespace ||
            !request.id ||
            request.id.length > 128 ||
            typeof request.upperBytes !== "bigint" ||
            request.upperBytes < 0n ||
            request.upperBytes > 9223372036854775807n
        )
            throw new HTTPError("Invalid storage operation", 400);
        this.validate(request.path);
    }
    private verifyIntent(intent: Intent, request: StorageQuotaRequest, kind: Intent["kind"], source?: Intent["source"]) {
        if (
            intent.namespace !== request.namespace ||
            intent.id !== request.id ||
            intent.path !== request.path ||
            intent.upperBytes !== request.upperBytes.toString() ||
            intent.kind !== kind ||
            JSON.stringify(intent.source) !== JSON.stringify(source)
        )
            throw new HTTPError("Storage operation identity conflict", 409);
    }
    async write(request: StorageQuotaRequest, data: Buffer): Promise<QuotaWriteResult> {
        if (BigInt(data.length) > request.upperBytes) throw new HTTPError("File exceeds storage reservation", 413);
        return this.perform(request, "write", undefined, () => Readable.from(data), true);
    }
    async clone(request: StorageQuotaRequest, source: { path: string; generation: string }): Promise<QuotaWriteResult> {
        this.validate(source.path);
        if (request.path === source.path) throw new HTTPError("Clone requires a distinct destination", 400);
        return this.perform(
            request,
            "clone",
            source,
            async () => {
                const original = await this.generation(source.path);
                if (!original || original.generation !== source.generation) throw new HTTPError("Clone source generation mismatch", 409);
                if (BigInt(original.fingerprint.bytes) > request.upperBytes) throw new HTTPError("Clone exceeds storage reservation", 413);
                const handle = await fsp.open(await this.target(source.path), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
                return handle.createReadStream();
            },
            false,
        );
    }
    private async perform(
        request: StorageQuotaRequest,
        kind: Intent["kind"],
        source: Intent["source"],
        input: () => Readable | Promise<Readable>,
        transform: boolean,
    ): Promise<QuotaWriteResult> {
        this.checkRequest(request);
        return this.locked([request.path, ...(source ? [source.path] : [])], async () => {
            const target = await this.target(request.path),
                metadata = await this.metadata("objects", request.path),
                operation = await this.metadata("operations", request.id);
            let intent = await this.read<Intent>(operation);
            if (intent) {
                this.verifyIntent(intent, request, kind, source);
                const actual = await this.fingerprint(target);
                if (intent.result && actual && same(intent.result, actual)) {
                    await this.record(metadata, { generation: request.id, fingerprint: actual });
                    return { generation: request.id, bytes: BigInt(actual.bytes) };
                }
                throw new HTTPError("Storage operation requires recovery", 409);
            }
            const prior = await this.generation(request.path);
            const temporary = `${target}.${digest(request.id)}.quota-tmp`;
            intent = {
                namespace: request.namespace,
                id: request.id,
                path: request.path,
                upperBytes: request.upperBytes.toString(),
                kind,
                source,
                prior,
                result: null,
                temporary,
            };
            await this.record(operation, intent);
            await this.options.checkpoint?.("prepared");
            let written = 0n;
            const bound = new Transform({
                transform(chunk: Buffer, _encoding, callback) {
                    written += BigInt(chunk.length);
                    callback(written > request.upperBytes ? new HTTPError("Transformed file exceeds storage reservation", 413) : null, chunk);
                },
            });
            try {
                const stream = await input();
                const output = fs.createWriteStream(temporary, { flags: "wx", mode: 0o600 });
                if (transform) await pipeline(stream, this.options.transform?.() ?? new ExifTransformer(), bound, output);
                else await pipeline(stream, bound, output);
                const handle = await fsp.open(temporary, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
                try {
                    await handle.sync();
                } finally {
                    await handle.close();
                }
                const result = await this.fingerprint(temporary);
                if (!result || BigInt(result.bytes) > request.upperBytes) throw new HTTPError("Invalid stored size", 503);
                if (source) {
                    const original = await this.generation(source.path);
                    if (!original || original.generation !== source.generation || original.fingerprint.bytes !== result.bytes || original.fingerprint.sha256 !== result.sha256)
                        throw new HTTPError("Clone source changed", 409);
                }
                intent.result = result;
                await this.record(operation, intent);
                await this.options.checkpoint?.("written");
                const current = await this.generation(request.path);
                if (JSON.stringify(current) !== JSON.stringify(prior)) throw new HTTPError("Storage destination changed", 409);
                await this.target(request.path);
                await fsp.rename(temporary, target);
                await this.syncDirectory(dirname(target));
                await this.options.checkpoint?.("renamed");
                await this.record(metadata, { generation: request.id, fingerprint: result });
                await this.options.checkpoint?.("recorded");
                return { generation: request.id, bytes: BigInt(result.bytes) };
            } finally {
                await fsp.unlink(temporary).catch((error) => {
                    if (!missing(error)) throw error;
                });
            }
        });
    }
    async unchanged(request: StorageQuotaRequest): Promise<boolean> {
        this.checkRequest(request);
        return this.locked([request.path], async () => {
            const intent = await this.read<Intent>(await this.metadata("operations", request.id));
            if (!intent) return false;
            if (intent.namespace !== request.namespace || intent.path !== request.path || intent.id !== request.id || intent.upperBytes !== request.upperBytes.toString())
                return false;
            const actual = await this.fingerprint(await this.target(request.path));
            const expectedTemporary = `${await this.target(request.path)}.${digest(request.id)}.quota-tmp`;
            if (intent.temporary !== expectedTemporary) return false;
            const staging = await this.fingerprint(expectedTemporary);
            if (staging) return false;
            return intent.prior ? !!actual && same(intent.prior.fingerprint, actual) : actual === null;
        });
    }
    async remove(path: string, generation: string): Promise<void> {
        await this.locked([path], async () => {
            const target = await this.target(path),
                metadata = await this.metadata("objects", path);
            const record = await this.read<Generation>(metadata);
            const actual = await this.fingerprint(target);
            if (!record || record.generation !== generation) throw new HTTPError("Storage delete generation mismatch", 409);
            if (actual && !same(record.fingerprint, actual)) throw new HTTPError("Storage object changed", 409);
            await this.options.checkpoint?.("before-delete");
            const confirmed = await this.fingerprint(target);
            if (confirmed && !same(record.fingerprint, confirmed)) throw new HTTPError("Storage object changed before deletion", 409);
            if (confirmed) await fsp.unlink(target);
            await this.syncDirectory(dirname(target));
            await this.options.checkpoint?.("deleted");
            if (await this.fingerprint(target)) throw new HTTPError("Storage deletion not confirmed", 503);
            await this.record(metadata, { ...record, deleted: true });
            await this.syncDirectory(dirname(metadata));
        });
    }
}
