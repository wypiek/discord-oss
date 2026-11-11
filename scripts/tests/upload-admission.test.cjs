const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const http = require("node:http");
const { test } = require("node:test");
const ts = require("typescript");
const express = require("express");
const multer = require("multer");
class HTTPError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}
function load(env = {}) {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/cdn/util/uploadAdmission.ts", "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2022,
                esModuleInterop: true,
            },
        }).outputText,
        {
            module,
            exports: module.exports,
            Buffer,
            require(name) {
                if (name === "node:process") return { env };
                if (name === "lambert-server/HTTPError") return { HTTPError };
                return require(name);
            },
        },
    );
    return module.exports;
}
const source = load();
test("internal multipart admission uses a conservative declared body bound, preserving unknown-length limits", () => {
    for (const value of [undefined, "0", "128", String(164 * 1024 * 1024)]) {
        const req = { headers: value === undefined ? {} : { "content-length": value } };
        assert.ok(source.internalUploadBufferLimit(req) <= source.INTERNAL_UPLOAD_FILE_LIMIT);
        assert.ok(source.internalUploadBufferOverhead(req) <= source.INTERNAL_UPLOAD_OVERHEAD);
    }
    assert.equal(source.internalUploadBufferLimit({ headers: {} }), source.INTERNAL_UPLOAD_FILE_LIMIT);
    assert.equal(source.internalUploadBufferOverhead({ headers: {} }), source.INTERNAL_UPLOAD_OVERHEAD);
    assert.equal(source.internalUploadBufferLimit({ headers: { "content-length": "128" } }), 128);
    assert.equal(source.internalUploadBufferOverhead({ headers: { "content-length": "128" } }), 65536 + 512);
    for (const value of ["1.5", "-1", "NaN", "1,2", ["1", "2"], "9007199254740992"])
        assert.throws(
            () => source.internalUploadBufferLimit({ headers: { "content-length": value } }),
            (error) => error.code === 400,
        );
    assert.throws(
        () =>
            source.internalUploadBufferLimit({
                headers: { "content-length": String(164 * 1024 * 1024 + 1) },
            }),
        (error) => error.code === 413,
    );
    assert.throws(
        () => load({ CDN_UPLOAD_MAX_CONCURRENT: "65" }).attachmentUploadAdmission.reserve(0, 0),
        (error) => error.code === 503,
    );
});
const MiB = 1024 * 1024;
test("default buffering budget admits a configured 500 MiB file and rejects overlapping worst-case buffers", () => {
    const release = source.attachmentUploadAdmission.reserve(500 * MiB, source.CLOUD_UPLOAD_OVERHEAD);
    assert.throws(
        () => source.attachmentUploadAdmission.reserve(500 * MiB, source.CLOUD_UPLOAD_OVERHEAD),
        (error) => error.code === 503 && error.retryable,
    );
    release();
    release();
    const again = source.attachmentUploadAdmission.reserve(500 * MiB, source.CLOUD_UPLOAD_OVERHEAD);
    again();
    assert.throws(
        () => source.attachmentUploadAdmission.reserve(513 * MiB, source.CLOUD_UPLOAD_OVERHEAD),
        (error) => error.code === 413 && !error.retryable,
    );
});
test("zero-byte uploads count toward concurrency; capacity and configuration errors do not consume leases", () => {
    const pool = new source.UploadAdmission(() => ({ bytes: 100, concurrent: 2 }));
    const a = pool.reserve(0, 0),
        b = pool.reserve(0, 0);
    assert.throws(
        () => pool.reserve(0, 0),
        (error) => error.code === 503,
    );
    a();
    a();
    b();
    assert.throws(
        () => pool.reserve(51, 0),
        (error) => error.code === 413,
    );
    pool.reserve(50, 0)();
    for (const value of ["", "-1", "0", "1.5", "1e9", "NaN", "Infinity", "9007199254740992"]) {
        for (const name of ["CDN_UPLOAD_BUFFER_BUDGET_BYTES", "CDN_UPLOAD_MAX_CONCURRENT"]) {
            const invalid = load({ [name]: value });
            assert.throws(
                () => invalid.attachmentUploadAdmission.reserve(0, 0),
                (error) => error.code === 503 && /configuration/.test(error.message),
            );
        }
    }
});
test("actual HTTP parsing retains admission through storage, including disconnects, and releases on completion/errors/abort", async () => {
    const pool = new source.UploadAdmission(() => ({ bytes: 64, concurrent: 4 }));
    const app = express(),
        blocked = new Map(),
        writes = [];
    const parser = express.raw({ type: () => true, limit: 16, inflate: false });
    app.post(
        "/upload/:id",
        (req, res, next) => (req.headers.signature === "synthetic-fixture" ? next() : res.sendStatus(403)),
        (req, res, next) =>
            Promise.resolve(
                source.bufferedUpload(
                    () => 16,
                    parser,
                    async (req, res) => {
                        const buffer = req.body;
                        assert.ok(Buffer.isBuffer(buffer));
                        if (req.params.id.startsWith("hold")) await new Promise((resolve) => blocked.set(req.params.id, resolve));
                        if (req.params.id === "fail") throw new HTTPError("Storage failed", 503);
                        writes.push(buffer.length);
                        res.sendStatus(200);
                    },
                    0,
                    pool,
                )(req, res, next),
            ),
    );
    const multipart = source.bufferedUpload(
        () => 16,
        multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 16 } }).single("file"),
        async (_req, res) => res.sendStatus(200),
        0,
        pool,
    );
    app.post("/multipart", (req, res, next) => Promise.resolve(multipart(req, res, next)));
    app.use((error, req, res, next) => {
        assert.equal(req.body, undefined, "Buffers are dropped before forwarding errors");
        res.status(typeof error.code === "number" ? error.code : error.status || 500).json({ message: error.message });
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const waitFor = async (condition) => {
        for (let n = 0; n < 200 && !condition(); n++) await new Promise((r) => setTimeout(r, 5));
        assert.ok(condition());
    };
    const send = (id, body = "1234567890123456") =>
        fetch(`${origin}/upload/${id}`, {
            method: "POST",
            headers: { signature: "synthetic-fixture" },
            body,
        });
    const headerOnly = (headers) =>
        new Promise((resolve, reject) => {
            const request = http.request(`${origin}/upload/header`, { method: "POST", headers }, (response) => {
                response.resume();
                response.on("end", () => {
                    resolve({ status: response.statusCode, retry: response.headers["retry-after"] });
                    request.destroy();
                });
            });
            request.on("error", reject);
            request.setTimeout(1500, () => request.destroy(new Error("Admission waited for a body")));
            request.flushHeaders();
        });
    try {
        const controller = new AbortController();
        const first = fetch(`${origin}/upload/hold-a`, {
            method: "POST",
            headers: { signature: "synthetic-fixture" },
            body: "1234567890123456",
            signal: controller.signal,
        }).catch(() => null);
        const second = send("hold-b");
        await waitFor(() => blocked.size === 2);
        assert.deepEqual(await headerOnly({ signature: "synthetic-fixture", "content-length": "16" }), {
            status: 503,
            retry: "1",
        });
        assert.equal((await headerOnly({ "content-length": "16" })).status, 403);
        controller.abort();
        await first;
        assert.equal((await headerOnly({ signature: "synthetic-fixture", "content-length": "16" })).status, 503, "Disconnect must not release the buffer still held by storage");
        blocked.get("hold-a")();
        blocked.delete("hold-a");
        blocked.get("hold-b")();
        blocked.delete("hold-b");
        assert.equal((await second).status, 200);
        assert.equal((await send("retry")).status, 200);
        assert.equal((await send("too-large", "12345678901234567")).status, 413);
        assert.equal((await send("fail")).status, 503);
        assert.equal((await send("after-errors")).status, 200);
        const aborted = http.request(`${origin}/upload/partial`, {
            method: "POST",
            headers: { signature: "synthetic-fixture", "content-length": "16" },
        });
        aborted.on("error", () => {});
        aborted.write("1");
        await new Promise((resolve) => setTimeout(resolve, 20));
        const stillAvailable = pool.reserve(16, 0);
        assert.throws(
            () => pool.reserve(16, 0),
            (error) => error.code === 503,
        );
        stillAvailable();
        aborted.destroy();
        await waitFor(() => {
            const releases = [];
            try {
                releases.push(pool.reserve(16, 0));
                releases.push(pool.reserve(16, 0));
                return true;
            } catch {
                return false;
            } finally {
                for (const release of releases) release();
            }
        });
        assert.equal((await send("after-abort")).status, 200);
        const form = http.request(`${origin}/multipart`, {
            method: "POST",
            headers: {
                "content-type": "multipart/form-data; boundary=fixture",
                "content-length": "1000",
            },
        });
        form.on("error", () => {});
        form.write('--fixture\r\nContent-Disposition: form-data; name="file"; filename="x"\r\nContent-Type: application/octet-stream\r\n\r\n1');
        await new Promise((resolve) => setTimeout(resolve, 20));
        const other = pool.reserve(16, 0);
        assert.throws(
            () => pool.reserve(16, 0),
            (error) => error.code === 503,
        );
        other();
        form.destroy();
        await waitFor(() => {
            const releases = [];
            try {
                releases.push(pool.reserve(16, 0));
                releases.push(pool.reserve(16, 0));
                return true;
            } catch {
                return false;
            } finally {
                for (const release of releases) release();
            }
        });
        assert.equal(writes.length, 5);
    } finally {
        for (const release of blocked.values()) release();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
});
