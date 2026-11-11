const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const vm = require("node:vm");
const zlib = require("node:zlib");
const express = require("express");
const ts = require("typescript");
const loaded = new Map();
function load(file) {
    file = path.resolve(file);
    if (loaded.has(file)) return loaded.get(file);
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
    }).outputText;
    vm.runInNewContext(
        source,
        {
            module,
            exports: module.exports,
            Buffer,
            require: (name) => (name.startsWith(".") ? load(path.resolve(path.dirname(file), name + ".ts")) : require(name)),
        },
        { filename: file },
    );
    loaded.set(file, module.exports);
    return module.exports;
}
const { compressedStatic } = load("src/util/util/CompressedStatic.ts");
async function fixture(t) {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "meowcord-static-"));
    const body = 'const text = "Meowcord public script";\n'.repeat(1000);
    await fsp.writeFile(path.join(root, "app.js"), body);
    const app = express();
    app.use("/public", compressedStatic(root), express.static(root));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    t.after(async () => {
        await new Promise((resolve) => server.close(resolve));
        await fsp.rm(root, { recursive: true, force: true });
    });
    const get = (url = "/public/app.js", headers = {}, method = "GET") =>
        new Promise((resolve, reject) => {
            const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path: url, method, headers }, (res) => {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
            });
            req.on("error", reject);
            req.end();
        });
    return { root, body, get };
}
test("Brotli/gzip round-trip and stable-name validation with encoding-specific ETags", async (t) => {
    const { get, body } = await fixture(t);
    const br = await get(undefined, { "accept-encoding": "br, gzip" });
    const gz = await get(undefined, { "accept-encoding": "gzip" });
    assert.equal(br.status, 200);
    assert.equal(br.headers["content-encoding"], "br");
    assert.equal(br.headers["cache-control"], "no-cache");
    assert.match(br.headers.vary, /Accept-Encoding/i);
    assert.equal(zlib.brotliDecompressSync(br.body).toString(), body);
    assert.equal(zlib.gunzipSync(gz.body).toString(), body);
    assert.notEqual(br.headers.etag, gz.headers.etag);
    assert.ok(br.body.length < Buffer.byteLength(body) / 10);
    const cached = await get(undefined, {
        "accept-encoding": "br",
        "if-none-match": br.headers.etag,
    });
    assert.equal(cached.status, 304);
    assert.equal(cached.body.length, 0);
    assert.equal(cached.headers["content-length"], undefined);
    assert.equal(cached.headers["content-encoding"], undefined);
    const head = await get(undefined, { "accept-encoding": "br" }, "HEAD");
    assert.equal(head.headers["content-length"], String(br.body.length));
    assert.equal(head.body.length, 0);
});
test("quality negotiation, identity, ranges, misses and unsafe paths preserve static behavior", async (t) => {
    const { get, body } = await fixture(t);
    const gz = await get(undefined, { "accept-encoding": "br;q=0.2, gzip;q=0.8, identity;q=0" });
    assert.equal(gz.headers["content-encoding"], "gzip");
    const unacceptable = await get(undefined, {
        "accept-encoding": "br;q=0, gzip;q=0, identity;q=0",
    });
    assert.equal(unacceptable.status, 406);
    assert.equal(unacceptable.body.length, 0);
    for (const headers of [{}, { "accept-encoding": "br;q=0, gzip;q=0" }, { "accept-encoding": "br;q=.1, identity;q=1" }]) {
        const raw = await get(undefined, headers);
        assert.equal(raw.headers["content-encoding"], undefined);
        assert.equal(raw.body.toString(), body);
    }
    const ranged = await get(undefined, { "accept-encoding": "br", range: "bytes=0-9" });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers["content-encoding"], undefined);
    assert.equal(ranged.body.toString(), body.slice(0, 10));
    for (const name of ["/public/missing.js", "/public/%2e%2e/outside.js", "/public/.hidden.js", "/public/%00.js"]) {
        const result = await get(name, { "accept-encoding": "br" });
        assert.ok(result.status >= 400);
        assert.equal(result.headers["content-encoding"], undefined);
    }
});
test("concurrent reads and same-size replacements with preserved mtime return current bytes", async (t) => {
    const { get, root, body } = await fixture(t);
    const first = await get(undefined, { "accept-encoding": "br" });
    const results = await Promise.all(Array.from({ length: 12 }, () => get(undefined, { "accept-encoding": "br" })));
    assert.ok(results.every((r) => r.body.equals(first.body)));
    const filename = path.join(root, "app.js");
    const stat = await fsp.stat(filename);
    const replacement = body.replaceAll("Meowcord", "MEOWCORD");
    await fsp.writeFile(path.join(root, "new.js"), replacement);
    await fsp.utimes(path.join(root, "new.js"), stat.atime, stat.mtime);
    await fsp.rename(path.join(root, "new.js"), filename);
    const updated = await get(undefined, {
        "accept-encoding": "br",
        "if-none-match": first.headers.etag,
    });
    assert.equal(updated.status, 200);
    assert.notEqual(updated.headers.etag, first.headers.etag);
    assert.equal(zlib.brotliDecompressSync(updated.body).toString(), replacement);
    const dateOnly = await get(undefined, {
        "accept-encoding": "br",
        "if-modified-since": stat.mtime.toUTCString(),
    });
    assert.equal(dateOnly.status, 200);
    assert.equal(zlib.brotliDecompressSync(dateOnly.body).toString(), replacement);
});

test("identity and cold-cache admission fallback carry Vary, and outside symlinks are denied", async (t) => {
    const { get, root, body } = await fixture(t);
    const raw = await get();
    assert.match(raw.headers.vary, /Accept-Encoding/i);
    const outside = path.join(path.dirname(root), path.basename(root) + "-outside.js");
    await fsp.writeFile(outside, body);
    t.after(() => fsp.rm(outside, { force: true }));
    await fsp.symlink(outside, path.join(root, "escape.js"));
    assert.equal((await get("/public/escape.js", { "accept-encoding": "br" })).status, 403);
    assert.equal((await get("/public/escape.js")).status, 403);
    const random = require("node:crypto")
        .randomBytes(512 * 1024)
        .toString("hex");
    await Promise.all(Array.from({ length: 12 }, (_, i) => fsp.writeFile(path.join(root, `cold-${i}.js`), random)));
    const cold = await Promise.all(Array.from({ length: 12 }, (_, i) => get(`/public/cold-${i}.js`, { "accept-encoding": "br" })));
    assert.ok(
        cold.some((row) => !row.headers["content-encoding"]),
        "Bounded compression must fall back under admission pressure",
    );
    for (const row of cold) {
        assert.equal(row.status, 200);
        assert.match(row.headers.vary, /Accept-Encoding/i);
        assert.equal(row.headers["content-encoding"] ? zlib.brotliDecompressSync(row.body).toString() : row.body.toString(), random);
    }
});
