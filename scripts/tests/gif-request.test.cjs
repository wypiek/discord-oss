const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { requestGifJson } = require("../../dist/integrations/gifs/GifRequest");
async function serverFixture(handler, run) {
    const server = createServer(handler);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
        await run(`http://127.0.0.1:${server.address().port}/synthetic-key`);
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
}
test("GIF JSON reader accepts chunked Unicode JSON and sends the request without credentials in errors", async () => {
    await serverFixture(
        (req, res) => {
            assert.equal(req.headers.accept, "application/json");
            res.writeHead(200, { "content-type": "application/json" });
            res.write('{"title":"');
            res.write("🐈");
            res.end('"}');
        },
        async (url) => {
            assert.deepEqual(await requestGifJson(url, "Fixture"), { title: "🐈" });
        },
    );
});
test("GIF JSON reader rejects oversized declared and chunked bodies", async () => {
    for (const declared of [false, true]) {
        await serverFixture(
            (_req, res) => {
                res.writeHead(200, {
                    "content-type": "application/json",
                    ...(declared ? { "content-length": String(3 * 1024 * 1024) } : {}),
                });
                res.write('"');
                res.end("x".repeat(2 * 1024 * 1024));
            },
            async (url) => {
                await assert.rejects(requestGifJson(url, "Fixture"), (error) => error.message === "Invalid Fixture response");
            },
        );
    }
});
test("GIF JSON reader sanitizes invalid JSON and HTTP failures", async () => {
    for (const status of [200, 401]) {
        await serverFixture(
            (_req, res) => {
                res.writeHead(status);
                res.end("private upstream payload synthetic-key");
            },
            async (url) => {
                await assert.rejects(requestGifJson(url, "Fixture"), (error) => error.message === (status === 200 ? "Invalid Fixture response" : "Fixture request failed (401)"));
            },
        );
    }
});
test("GIF JSON reader applies the eight-second deadline to a stalled response body", { timeout: 12000 }, async () => {
    await serverFixture(
        (_req, res) => {
            res.writeHead(200);
            res.write('{"pending":');
        },
        async (url) => {
            const started = Date.now();
            await assert.rejects(requestGifJson(url, "Fixture"), /Invalid Fixture response/);
            const elapsed = Date.now() - started;
            assert.ok(elapsed >= 7500 && elapsed < 11000, `deadline elapsed ${elapsed}ms`);
        },
    );
});
