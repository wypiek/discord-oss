const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const http = require("node:http");
const { once } = require("node:events");
const ts = require("typescript");
const express = require("express");
const multerConfig = require("multer");
function deferred() {
    let resolve;
    const promise = new Promise((r) => {
        resolve = r;
    });
    return { promise, resolve };
}
class HTTPError extends Error {
    constructor(message, code = 400) {
        super(message);
        this.code = code;
    }
}
function load(path, imports) {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(path, "utf8"), {
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
            require: (name) => {
                if (name in imports) return imports[name];
                throw new Error(`Unexpected import ${name}`);
            },
        },
    );
    return module.exports;
}
async function fixture(handler = async (_req, res) => res.status(200).end()) {
    const state = {
        parserFiles: 0,
        parsedBytes: 0,
        handlerCalls: 0,
        signature: "synthetic-internal-upload-fixture",
    };
    const parserStarted = deferred();
    const multer = (...args) => multerConfig(...args);
    multer.memoryStorage = () => {
        const storage = multerConfig.memoryStorage();
        const original = storage._handleFile;
        storage._handleFile = function (req, file, callback) {
            state.parserFiles++;
            parserStarted.resolve();
            return original.call(this, req, file, (error, info) => {
                if (info?.buffer) state.parsedBytes += info.buffer.length;
                callback(error, info);
            });
        };
        return storage;
    };
    const imports = {
        "lambert-server/HTTPError": { HTTPError },
        "node:process": {
            env: {
                CDN_UPLOAD_BUFFER_BUDGET_BYTES: String(10 * 1024 * 1024),
                CDN_UPLOAD_MAX_CONCURRENT: "1",
            },
        },
    };
    const admission = load("src/cdn/util/uploadAdmission.ts", imports);
    const upload = load("src/cdn/util/multer.ts", {
        ...imports,
        multer,
        "./uploadAdmission": admission,
        "@spacebar/util": {
            Config: { get: () => ({ security: { requestSignature: state.signature } }) },
            isRequestSignature: (value) => typeof value === "string" && typeof state.signature === "string" && state.signature.length > 0 && value === state.signature,
        },
    });
    const app = express();
    app.post(
        "/internal",
        upload.internalUpload(async (req, res) => {
            state.handlerCalls++;
            if (!req.file) throw new HTTPError("file missing");
            return handler(req, res);
        }),
    );
    app.use((error, _req, res, _next) => {
        if (!res.destroyed) res.status(error.code === "LIMIT_UNEXPECTED_FILE" ? 400 : Number(error.code) || 500).json({ rejected: true });
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const post = async ({ signature = state.signature, field = "file", signal, bytes = 1024 } = {}) => {
        const form = new FormData();
        form.append(field, new Blob([Buffer.alloc(bytes)]), "fixture.bin");
        const response = await fetch(`${origin}/internal`, {
            method: "POST",
            body: form,
            headers: signature == null ? {} : { signature },
            signal,
        });
        await response.arrayBuffer();
        return { status: response.status, retryAfter: response.headers.get("retry-after") };
    };
    return {
        state,
        origin,
        post,
        parserStarted,
        close: async () => {
            server.closeAllConnections();
            await new Promise((resolve) => server.close(resolve));
        },
    };
}
test("actual multipart parser never starts for missing, wrong or empty configured signature", async () => {
    const h = await fixture();
    try {
        for (const signature of [null, "incorrect-fixture-signature"]) assert.equal((await h.post({ signature, bytes: 1024 * 1024 })).status, 403);
        h.state.signature = "";
        assert.equal((await h.post({ signature: "" })).status, 403);
        assert.equal(h.state.parserFiles, 0);
        assert.equal(h.state.parsedBytes, 0);
        assert.equal(h.state.handlerCalls, 0);
    } finally {
        await h.close();
    }
});
test("signed upload capacity remains held throughout delayed awaited handler", async () => {
    const entered = deferred(),
        release = deferred();
    const h = await fixture(async (_req, res) => {
        if (h.state.handlerCalls === 1) {
            entered.resolve();
            await release.promise;
        }
        res.status(200).end();
    });
    let first;
    try {
        first = h.post();
        await entered.promise;
        const busy = await h.post();
        assert.equal(busy.status, 503);
        assert.equal(busy.retryAfter, "1");
        assert.equal(h.state.parserFiles, 1);
        release.resolve();
        assert.equal((await first).status, 200);
        assert.equal((await h.post()).status, 200);
        assert.equal(h.state.parserFiles, 2);
    } finally {
        release.resolve();
        await first;
        await h.close();
    }
});
test("real parser rejection releases capacity for a later valid signed upload", async () => {
    const h = await fixture();
    try {
        assert.equal((await h.post({ field: "unexpected-file" })).status, 400);
        assert.equal(h.state.handlerCalls, 0);
        assert.equal((await h.post()).status, 200);
        assert.equal(h.state.handlerCalls, 1);
    } finally {
        await h.close();
    }
});
test("rejected awaited handler releases capacity and clears retained file buffer", async () => {
    let captured;
    const h = await fixture(async (req, res) => {
        if (h.state.handlerCalls === 1) {
            captured = req;
            throw new HTTPError("synthetic handler rejection", 400);
        }
        res.status(200).end();
    });
    try {
        assert.equal((await h.post()).status, 400);
        assert.equal(captured.file.buffer, undefined);
        assert.equal((await h.post()).status, 200);
    } finally {
        await h.close();
    }
});
test("client abort during active handler holds capacity until work finishes then releases", async () => {
    const entered = deferred(),
        release = deferred(),
        closed = deferred();
    let captured;
    const h = await fixture(async (req, res) => {
        if (h.state.handlerCalls === 1) {
            captured = req;
            res.once("close", () => closed.resolve());
            entered.resolve();
            await release.promise;
        }
        if (!res.destroyed) res.status(200).end();
    });
    const controller = new AbortController();
    let first;
    try {
        first = h.post({ signal: controller.signal }).catch(() => null);
        await entered.promise;
        controller.abort();
        await first;
        await closed.promise;
        assert.equal((await h.post()).status, 503);
        assert.equal(h.state.parserFiles, 1);
        release.resolve();
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(captured.file.buffer, undefined);
        assert.equal((await h.post()).status, 200);
    } finally {
        release.resolve();
        controller.abort();
        await first;
        await h.close();
    }
});
test("client abort in partial multipart parsing releases the shared reservation", async () => {
    const h = await fixture();
    let request;
    try {
        request = http.request(`${h.origin}/internal`, {
            method: "POST",
            headers: {
                signature: h.state.signature,
                "content-type": "multipart/form-data; boundary=synthetic-boundary",
                "content-length": String(1024 * 1024),
            },
        });
        request.on("error", () => {});
        request.write('--synthetic-boundary\r\nContent-Disposition: form-data; name="file"; filename="fixture.bin"\r\nContent-Type: application/octet-stream\r\n\r\npartial-body');
        await h.parserStarted.promise;
        const closed = new Promise((resolve) => request.once("close", resolve));
        request.destroy();
        await closed;
        let result;
        for (let i = 0; i < 20; i++) {
            result = await h.post();
            if (result.status !== 503) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(result.status, 200);
        assert.equal(h.state.handlerCalls, 1);
    } finally {
        request?.destroy();
        await h.close();
    }
});
