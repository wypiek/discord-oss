const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const express = require("express");
const { once } = require("node:events");

class HTTPError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

const load = (limits) => {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/util/utility/boundedUpload.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            Buffer,
            require: (name) =>
                ({
                    express,
                    multer: require("multer"),
                    "lambert-server/HTTPError": { HTTPError },
                    "@spacebar/util": { Config: { get: () => ({ limits: { message: limits } }) } },
                })[name],
        },
    );
    return module.exports;
};

const serve = async (middleware) => {
    const app = express();
    app.post("/", middleware, (req, res) => res.json({ files: req.files.map((file) => file.size) }));
    app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ message: error.message }));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
};

const form = (sizes) => {
    const body = new FormData();
    sizes.forEach((size, i) => body.append(`files[${i}]`, new Blob([new Uint8Array(size)]), `f${i}.bin`));
    return body;
};

test("files under the per-file and per-request budgets are kept", async () => {
    const { boundedMessageUpload, boundedMemoryStorage } = load({ maxAttachmentSize: 1024 * 1024 * 1024, maxAttachments: 15 });
    const server = await serve(boundedMessageUpload(boundedMemoryStorage(4096)));
    try {
        const res = await fetch(server.url, { method: "POST", body: form([1000, 1000, 1000]) });
        assert.equal(res.status, 200);
        assert.deepEqual((await res.json()).files, [1000, 1000, 1000]);
    } finally {
        server.close();
    }
});

test("the per-request byte budget counts every file together", async () => {
    const { boundedMessageUpload, boundedMemoryStorage } = load({ maxAttachmentSize: 1024 * 1024 * 1024, maxAttachments: 15 });
    const server = await serve(boundedMessageUpload(boundedMemoryStorage(4096)));
    try {
        const res = await fetch(server.url, { method: "POST", body: form([2000, 2000, 2000]) });
        assert.equal(res.status, 413);
    } finally {
        server.close();
    }
});

test("the file count is capped at 10 even when the message limit allows more", async () => {
    const { boundedMessageUpload } = load({ maxAttachmentSize: 1024 * 1024 * 1024, maxAttachments: 15 });
    const server = await serve(boundedMessageUpload());
    try {
        const res = await fetch(server.url, { method: "POST", body: form(Array(11).fill(10)) });
        assert.equal(res.status, 413);
    } finally {
        server.close();
    }
});

test("one file can't exceed 25 MB even when the message limit is 1 GB", async () => {
    const { boundedMessageUpload, MAX_UPLOAD_REQUEST_BYTES } = load({ maxAttachmentSize: 1024 * 1024 * 1024, maxAttachments: 15 });
    assert.equal(MAX_UPLOAD_REQUEST_BYTES, 100 * 1024 * 1024);
    const server = await serve(boundedMessageUpload());
    try {
        const res = await fetch(server.url, { method: "POST", body: form([25 * 1024 * 1024 + 1]) });
        assert.equal(res.status, 413);
    } finally {
        server.close();
    }
});

test("the interaction callback checks the token before it parses any upload", () => {
    const source = fs.readFileSync("src/api/routes/interactions/#interaction_id/#interaction_token/callback.ts", "utf8");
    const route = source.slice(source.indexOf("router.post("));
    assert.ok(route.indexOf("pendingFor(req)") < route.indexOf("upload,"));
    assert.doesNotMatch(source, /memoryStorage\(\)/);
});

test("message uploads count every file against one 100 MiB request budget", () => {
    const source = fs.readFileSync("src/api/routes/channels/#channel_id/messages/index.ts", "utf8");
    assert.match(source, /storage: boundedMemoryStorage\(\)/);
    assert.match(source, /fileSize: Math\.min\(Config\.get\(\)\.limits\.message\.maxAttachmentSize, MAX_UPLOAD_REQUEST_BYTES\)/);
    assert.doesNotMatch(source, /multer\.memoryStorage\(\)/);
});
