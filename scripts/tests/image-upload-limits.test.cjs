const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const http = require("node:http");
const { once } = require("node:events");
const ts = require("typescript");
const express = require("express");

const MiB = 1024 * 1024;
const { jsonBodyLimit, imageUploadCount, ImageUploadLimit, DEFAULT_JSON_BODY_BYTES } = require("../../dist/api/middlewares/ImageUploadLimit");
const { dataUriPayloadBytes, oversizedDataUris, MAX_IMAGE_UPLOAD_BYTES, imageTooLargeMessage } = require("../../dist/util/util/ImageUpload");
const { handleFile } = require("../../dist/util/util/cdn");

function bodyParser() {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/middlewares/BodyParser.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
            .outputText,
        {
            module,
            exports: module.exports,
            require: (id) =>
                id === "lambert-server/HTTPError"
                    ? {
                          HTTPError: class extends Error {
                              constructor(message, status) {
                                  super(message);
                                  this.status = status;
                              }
                          },
                      }
                    : require(id),
            setTimeout,
            clearTimeout,
        },
    );
    return module.exports.BodyParser({ limit: DEFAULT_JSON_BODY_BYTES }, (req) => jsonBodyLimit(req.method, req.path));
}

const dataUri = (bytes, mime = "image/gif") => `data:${mime};base64,${Buffer.alloc(bytes, 7).toString("base64")}`;

async function send(port, method, path, body) {
    const payload = Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, method, path, headers: { "content-type": "application/json", "content-length": payload.length } }, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
        });
        req.on("error", reject);
        req.end(payload);
    });
}

test("only routes that take image data URIs get a larger JSON body limit", () => {
    const oneImage = Math.ceil(MAX_IMAGE_UPLOAD_BYTES / 3) * 4;
    for (const [method, path, images] of [
        ["PATCH", "/api/v9/guilds/1570868838633877682", 4],
        ["PATCH", "/api/guilds/1570868838633877682", 4],
        ["PATCH", "/api/v10/users/@me", 2],
        ["PATCH", "/api/v9/users/@me/profile", 1],
        ["PATCH", "/api/v9/users/%40me/profile", 1],
        ["PATCH", "/api/v9/guilds/1/profile/%40me", 2],
        ["PATCH", "/api/v9/guilds/1/profile", 2],
        ["PATCH", "/api/v9/guilds/1/profile/@me", 2],
        ["PATCH", "/api/v9/guilds/1/members/@me", 2],
        ["POST", "/api/v9/guilds/1/emojis", 1],
        ["PATCH", "/api/v9/guilds/1/roles/2", 1],
        ["POST", "/api/v9/guilds", 1],
        ["PATCH", "/api/v9/channels/1", 1],
        ["PATCH", "/api/v9/admin/guilds/1", 4],
    ]) {
        assert.equal(imageUploadCount(method, path), images, `${method} ${path}`);
        assert.ok(jsonBodyLimit(method, path) >= images * oneImage + MiB, `${method} ${path}`);
    }
    for (const [method, path] of [
        ["POST", "/api/v9/channels/1/messages"],
        ["GET", "/api/v9/guilds/1"],
        ["PUT", "/api/v9/guilds/1"],
        ["PATCH", "/api/v9/guilds/1/channels"],
        ["PATCH", "/guilds/1"],
        ["PATCH", "/banners/1"],
    ]) {
        assert.equal(imageUploadCount(method, path), 0, `${method} ${path}`);
        assert.equal(jsonBodyLimit(method, path), DEFAULT_JSON_BODY_BYTES, `${method} ${path}`);
    }
    assert.ok(jsonBodyLimit("PATCH", "/api/v9/guilds/1") >= 14 * MiB);
});

test("a 10 MiB banner fits its route while other routes keep the 10 MiB body limit", async () => {
    const app = express();
    app.use(bodyParser());
    app.use((req, res) => res.json({ received: JSON.stringify(req.body).length }));
    const listener = app.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    try {
        const banner = dataUri(MAX_IMAGE_UPLOAD_BYTES);
        const accepted = await send(port, "PATCH", "/api/v9/guilds/1", { banner });
        assert.equal(accepted.status, 200, accepted.body);
        assert.ok(JSON.parse(accepted.body).received > 13 * MiB);
        const profileBanner = await send(port, "PATCH", "/api/v9/users/%40me/profile", { banner });
        assert.equal(profileBanner.status, 200, profileBanner.body);
        const refused = await send(port, "POST", "/api/v9/channels/1/messages", { content: banner });
        assert.equal(refused.status, 413);
        assert.deepEqual(JSON.parse(refused.body), { message: "Request entity too large", code: 40005 });
        const oversized = await send(port, "PATCH", "/api/v9/users/@me/profile", { banner: dataUri(2 * MAX_IMAGE_UPLOAD_BYTES) });
        assert.equal(oversized.status, 413);
        assert.equal(JSON.parse(oversized.body).code, 40005);
    } finally {
        listener.closeAllConnections();
        await new Promise((resolve) => listener.close(resolve));
    }
});

test("data URI sizes are measured without decoding them", () => {
    for (const bytes of [0, 1, 2, 3, 4, 1000, 1001, 1002]) assert.equal(dataUriPayloadBytes(dataUri(bytes)), bytes);
    assert.equal(dataUriPayloadBytes("data:text/plain,hello"), 5);
    assert.equal(dataUriPayloadBytes("https://example.com/a.gif"), 0);
    assert.equal(dataUriPayloadBytes(null), 0);
    assert.deepEqual(oversizedDataUris({ banner: dataUri(11), icon: dataUri(10), profile: { banner: dataUri(12) }, name: "x" }, 10), ["banner", "profile.banner"]);
    assert.equal(imageTooLargeMessage(), "File cannot be larger than 10240.0 kb.");
});

test("an image over 10 MiB is refused with Discord's field error", () => {
    const run = (body, method = "PATCH", path = "/api/v9/guilds/1") => {
        let result = "not called";
        ImageUploadLimit({ body, method, path }, {}, (error) => (result = error));
        return result;
    };
    assert.equal(run({ banner: dataUri(MAX_IMAGE_UPLOAD_BYTES) }), undefined);
    assert.equal(run({ banner: dataUri(MAX_IMAGE_UPLOAD_BYTES + 1) }, "POST", "/api/v9/channels/1/messages"), undefined);
    assert.equal(run({ banner: dataUri(MAX_IMAGE_UPLOAD_BYTES + 1) }, "PATCH", "/api/v9/users/%40me/profile").code, 50035);
    const error = run({ banner: dataUri(MAX_IMAGE_UPLOAD_BYTES + 1), splash: dataUri(4) });
    assert.equal(error.code, 50035);
    assert.equal(error.message, "Invalid Form Body");
    assert.deepEqual(Object.keys(error.errors), ["banner"]);
    assert.deepEqual(error.errors.banner._errors, [{ message: "File cannot be larger than 10240.0 kb.", code: "BINARY_TYPE_MAX_SIZE" }]);
});

test("handleFile refuses an oversized image before contacting the CDN", async () => {
    const fetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = async () => {
        called = true;
        throw new Error("unexpected");
    };
    try {
        await assert.rejects(
            handleFile("/banners/1", dataUri(MAX_IMAGE_UPLOAD_BYTES + 1)),
            (error) => error.code === 50045 && error.message === "File uploaded exceeds the maximum size",
        );
        assert.equal(called, false);
    } finally {
        globalThis.fetch = fetch;
    }
});
