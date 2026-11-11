const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const http = require("node:http");
const { once } = require("node:events");
const ts = require("typescript");

class HTTPError extends Error {}

const load = (endpoint, uploadDeadlineSeconds) => {
    const result = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/util/util/cdn.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module: result,
            exports: result.exports,
            Buffer,
            fetch,
            console,
            AbortSignal,
            Math,
            require(name) {
                if (name === "lambert-server/HTTPError") return { HTTPError };
                if (name === "./AttachmentFilename") return require("../../src/util/util/AttachmentFilename.ts");
                if (name === "./Config")
                    return { Config: { get: () => ({ security: { requestSignature: "trusted" }, cdn: { endpointPrivate: endpoint, uploadDeadlineSeconds } }) } };
                if (name === "../../cdn/util/storageOwnership") return { storageOwnership: { getStore: () => undefined, run: (_principal, work) => work() } };
                return require(name);
            },
        },
    );
    return result.exports;
};

const slowCdn = async (delay) => {
    let received = 0;
    const server = http.createServer((req, res) => {
        req.resume();
        req.on("end", () => {
            received++;
            setTimeout(() => {
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({ id: String(received), filename: "f.bin", size: 1, url: "x" }));
            }, delay);
        });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return { endpoint: `http://127.0.0.1:${server.address().port}`, received: () => received, close: () => server.close() };
};

const files = (count) =>
    Array.from({ length: count }, (_, i) => ({ fieldname: `files[${i}]`, mimetype: "application/octet-stream", originalname: `f${i}.bin`, buffer: Buffer.from("x") }));

test("all files of one message share a single upload deadline", async () => {
    const cdn = await slowCdn(400);
    try {
        const { uploadMessageFiles } = load(cdn.endpoint, 1);
        const started = Date.now();
        await assert.rejects(uploadMessageFiles("/attachments/1/2", files(6)));
        const elapsed = Date.now() - started;
        assert.ok(elapsed < 1800, `took ${elapsed} ms`);
        assert.ok(cdn.received() < 6, `${cdn.received()} files reached the CDN`);
    } finally {
        cdn.close();
    }
});

test("uploads that finish inside the deadline still succeed", async () => {
    const cdn = await slowCdn(10);
    try {
        const { uploadMessageFiles } = load(cdn.endpoint, 60);
        const uploaded = await uploadMessageFiles("/attachments/1/2", files(3));
        assert.equal(uploaded.length, 3);
    } finally {
        cdn.close();
    }
});

test("the deadline defaults to 60 seconds and is at least one second", () => {
    const source = fs.readFileSync("src/util/config/types/CdnConfiguration.ts", "utf8");
    assert.match(source, /uploadDeadlineSeconds: number = 60;/);
    const { uploadDeadline } = load("http://127.0.0.1:9", 0);
    assert.equal(uploadDeadline().aborted, false);
});
