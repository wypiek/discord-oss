import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, TestContext } from "node:test";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { ClientAssetCompression } from "./ClientAssetCompression";

const gzip = promisify(zlib.gzip);
const limits = { bytes: 16384, entries: 4, sourceBytes: 8192, inflight: 2 };
const fixture = async (t: TestContext) => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "fosscord-client-compression-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const write = async (name: string, body = "test asset".repeat(400)) => {
        const file = path.join(dir, name);
        await fs.writeFile(file, body);
        return file;
    };
    return { dir, write };
};

test("concurrent and repeated requests reuse one compressed representation", async (t) => {
    const { write } = await fixture(t);
    const file = await write("vencord.js");
    const stat = await fs.stat(file);
    let encodes = 0;
    const cache = new ClientAssetCompression(limits, async (body) => {
        encodes++;
        return gzip(body);
    });
    const bodies = await Promise.all(Array.from({ length: 20 }, () => cache.get(file, stat, "gzip")));
    assert.equal(encodes, 1);
    assert.ok(bodies[0]);
    assert.ok(bodies.every((body) => body === bodies[0]));
    assert.equal(await cache.get(file, await fs.stat(file), "gzip"), bodies[0]);
    assert.equal(zlib.gunzipSync(bodies[0]!).toString(), "test asset".repeat(400));
});

test("encoding variants remain separate and round-trip", async (t) => {
    const { write } = await fixture(t);
    const file = await write("vencord.js");
    const stat = await fs.stat(file);
    const cache = new ClientAssetCompression();
    const gzipBody = await cache.get(file, stat, "gzip");
    const brBody = await cache.get(file, stat, "br");
    const zstdBody = await cache.get(file, stat, "zstd");
    assert.deepEqual(zlib.gunzipSync(gzipBody!), zlib.brotliDecompressSync(brBody!));
    assert.deepEqual(zlib.gunzipSync(gzipBody!), zlib.zstdDecompressSync(zstdBody!));
    assert.equal(await cache.get(file, stat, "br"), brBody);
});

test("same-sized atomic replacement invalidates even with preserved mtime", async (t) => {
    const { write, dir } = await fixture(t);
    const file = await write("vencord.js", "A".repeat(4000));
    const stat = await fs.stat(file);
    const cache = new ClientAssetCompression();
    const first = await cache.get(file, stat, "gzip");
    const replacement = await write("replacement.js", "B".repeat(4000));
    await fs.utimes(replacement, stat.atime, stat.mtime);
    await fs.rename(replacement, path.join(dir, "vencord.js"));
    const second = await cache.get(file, await fs.stat(file), "gzip");
    assert.notEqual(second, first);
    assert.equal(zlib.gunzipSync(second!).toString(), "B".repeat(4000));
});

test("replacements during compression cannot enter the cache", async (t) => {
    const { write } = await fixture(t);
    const file = await write("vencord.js", "A".repeat(4000));
    let replace = true;
    const cache = new ClientAssetCompression(limits, async (body) => {
        if (replace) {
            replace = false;
            const next = await write("next.js", "B".repeat(4000));
            await fs.rename(next, file);
        }
        return gzip(body);
    });
    assert.equal(await cache.get(file, await fs.stat(file), "gzip"), null);
    const current = await cache.get(file, await fs.stat(file), "gzip");
    assert.equal(zlib.gunzipSync(current!).toString(), "B".repeat(4000));
});

test("entry and byte limits evict least recently used compressed bodies", async (t) => {
    const { write } = await fixture(t);
    const files = await Promise.all([write("a.js"), write("b.js"), write("c.js")]);
    const cache = new ClientAssetCompression({ ...limits, entries: 2 });
    const get = async (index: number) => cache.get(files[index], await fs.stat(files[index]), "gzip");
    const first = await get(0);
    const second = await get(1);
    assert.equal(await get(0), first);
    await get(2);
    assert.notEqual(await get(1), second);
    const byteCache = new ClientAssetCompression({ ...limits, bytes: first!.length });
    const byteFirst = await byteCache.get(files[0], await fs.stat(files[0]), "gzip");
    await byteCache.get(files[1], await fs.stat(files[1]), "gzip");
    assert.notEqual(await byteCache.get(files[0], await fs.stat(files[0]), "gzip"), byteFirst);
});

test("oversized input bypasses caching and compression failures release admission", async (t) => {
    const { write } = await fixture(t);
    const file = await write("vencord.js");
    const oversized = new ClientAssetCompression({ ...limits, sourceBytes: 1 });
    assert.equal(await oversized.get(file, await fs.stat(file), "gzip"), null);
    let fail = true;
    const cache = new ClientAssetCompression({ ...limits, inflight: 1 }, async (body) => {
        if (fail) {
            fail = false;
            throw new Error("compression failed");
        }
        return gzip(body);
    });
    await assert.rejects(cache.get(file, await fs.stat(file), "gzip"), /compression failed/);
    assert.ok(await cache.get(file, await fs.stat(file), "gzip"));
});

test("inflight admission is bounded while requests for the same asset coalesce", async (t) => {
    const { write } = await fixture(t);
    const first = await write("a.js");
    const second = await write("b.js");
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
    });
    const encoding = new Promise<void>((resolve) => {
        started = resolve;
    });
    const cache = new ClientAssetCompression({ ...limits, inflight: 1 }, async (body) => {
        started();
        await waiting;
        return gzip(body);
    });
    const stat = await fs.stat(first);
    const pending = cache.get(first, stat, "gzip");
    await encoding;
    assert.equal(await cache.get(second, await fs.stat(second), "gzip"), null);
    const joined = cache.get(first, stat, "gzip");
    release();
    assert.equal(await pending, await joined);
});
