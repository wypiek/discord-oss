import fs from "node:fs";
import fsp from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Storage, StorageRead } from "./Storage";
import ExifTransformer from "exif-be-gone";

export class FileStorage implements Storage {
    getFsPath(path: string): string {
        const root = resolve(process.env.STORAGE_LOCATION || "../");
        const filename = resolve(root, path);
        const child = relative(root, filename);
        if (path.includes("\0") || child === ".." || child.startsWith("../") || isAbsolute(child)) throw new Error("invalid path");
        return filename;
    }

    private async safePath(path: string, create = false): Promise<string> {
        const filename = this.getFsPath(path);
        const root = resolve(process.env.STORAGE_LOCATION || "../");
        const rootStat = await fsp.lstat(root);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("unsafe storage root");
        let current = root;
        const pieces = relative(root, filename).split("/").filter(Boolean);
        for (const [index, piece] of pieces.entries()) {
            current = join(current, piece);
            try {
                const stat = await fsp.lstat(current);
                if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink > 1))) throw new Error("unsafe storage entry");
                if (index < pieces.length - 1 && !stat.isDirectory()) throw new Error("invalid storage directory");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                if (create && index < pieces.length - 1) {
                    await fsp.mkdir(current, { mode: 0o700 }).catch((error) => {
                        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
                    });
                    const stat = await fsp.lstat(current);
                    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe storage directory");
                }
            }
        }
        return filename;
    }

    async *inventory(): AsyncIterable<{ path: string; size: number }> {
        const pending = [""];
        while (pending.length) {
            const directory = pending.pop()!;
            const entries = await fsp.opendir(await this.safePath(directory));
            for await (const entry of entries) {
                const path = directory ? `${directory}/${entry.name}` : entry.name;
                const stat = await fsp.lstat(await this.safePath(path));
                if (stat.isDirectory()) pending.push(path);
                else if (stat.isFile()) yield { path, size: stat.size };
                else throw new Error("unsafe storage inventory entry");
            }
        }
    }

    async isFile(path: string): Promise<boolean> {
        try {
            return (await fsp.lstat(await this.safePath(path))).isFile();
        } catch (error) {
            if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
            throw error;
        }
    }

    async openRead(path: string, signal?: AbortSignal): Promise<StorageRead | null> {
        let filename = await this.safePath(path);
        try {
            if ((await fsp.stat(filename)).isDirectory()) {
                const files = (await fsp.readdir(filename)).sort();
                if (!files.length) return null;
                filename = await this.safePath(`${path}/${files[0]}`);
            }
            const handle = await fsp.open(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            try {
                const stat = await handle.stat();
                if (!stat.isFile() || stat.nlink !== 1 || !Number.isSafeInteger(stat.size)) {
                    await handle.close();
                    return null;
                }
                const stream = handle.createReadStream({
                    autoClose: true,
                    highWaterMark: 64 * 1024,
                    signal,
                });
                stream.on("error", () => undefined);
                return { size: stat.size, stream };
            } catch (error) {
                await handle.close();
                throw error;
            }
        } catch (error) {
            if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
            throw error;
        }
    }

    async get(path: string): Promise<Buffer | null> {
        const read = await this.openRead(path);
        if (!read) return null;
        const chunks: Buffer[] = [];
        for await (const chunk of read.stream) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
    }

    async clone(path: string, newPath: string) {
        path = await this.safePath(path);
        newPath = await this.safePath(newPath, true);

        await fsp.copyFile(path, newPath, fs.constants.COPYFILE_FICLONE);
    }

    async set(path: string, value: Buffer) {
        path = await this.safePath(path, true);
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
            await pipeline(Readable.from(value), new ExifTransformer(), fs.createWriteStream(temporary, { flags: "wx" }));
            await fsp.rename(temporary, path);
        } finally {
            await fsp.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== "ENOENT") throw error;
            });
        }
    }

    async delete(path: string) {
        try {
            await fsp.unlink(await this.safePath(path));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }

    async exists(path: string) {
        try {
            await fsp.access(await this.safePath(path));
            return true;
        } catch (error) {
            if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
            throw error;
        }
    }

    async move(path: string, newPath: string) {
        path = await this.safePath(path);
        newPath = await this.safePath(newPath, true);

        await fsp.rename(path, newPath);
    }
}
