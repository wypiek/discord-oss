const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const http = require("node:http");
const ts = require("typescript");

function fixture(endpoint) {
    const result = { exports: {} };
    class HTTPError extends Error {
        constructor(message, code) {
            super(message);
            this.code = code;
        }
    }
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
            AbortSignal: {
                timeout(milliseconds) {
                    assert.equal(milliseconds, 30000);
                    return AbortSignal.timeout(100);
                },
            },
            require(name) {
                if (name === "lambert-server/HTTPError") return { HTTPError };
                if (name === "./AttachmentFilename") return require("../../src/util/util/AttachmentFilename.ts");
                if (name === "./Config") return { Config: { get: () => ({ security: { requestSignature: "trusted" }, cdn: { endpointPrivate: endpoint } }) } };
                if (name === "../../cdn/util/storageOwnership") return { storageOwnership: { getStore: () => "user:1" } };
                return require(name);
            },
        },
    );
    return result.exports;
}

test("private CDN transfer deadline covers a response that stalls after its headers", async (t) => {
    const server = http.createServer((req, res) => {
        assert.equal(req.headers["x-storage-principal"], "user:1");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.write("{");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => {
        server.closeAllConnections();
        server.close();
    });
    const api = fixture(`http://127.0.0.1:${server.address().port}`);
    await assert.rejects(api.uploadFile("/upload", { buffer: Buffer.from("body"), originalname: "file", mimetype: "text/plain" }));
});

test("private CDN rejects oversized JSON without retaining an unbounded response", async (t) => {
    const server = http.createServer((_req, res) => res.end(JSON.stringify({ value: "x".repeat(600000) })));
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => {
        server.closeAllConnections();
        server.close();
    });
    const api = fixture(`http://127.0.0.1:${server.address().port}`);
    await assert.rejects(api.deleteFile("/file"), /CDN response too large/);
});
