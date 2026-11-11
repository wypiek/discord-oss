const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const express = require("express");
const http = require("node:http");
const { once } = require("node:events");

function parser(deadline = 15000) {
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
            setTimeout: (fn) => setTimeout(fn, deadline),
            clearTimeout,
        },
    );
    return module.exports.BodyParser({ limit: "10mb" });
}

async function server(middleware, run) {
    const app = express();
    app.use(middleware);
    app.post("/", (req, res) => res.json(req.body));
    app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ message: error.message }));
    const listener = app.listen(0, "127.0.0.1");
    await once(listener, "listening");
    try {
        await run(listener.address().port);
    } finally {
        listener.closeAllConnections();
        await new Promise((resolve) => listener.close(resolve));
    }
}

function request(port, body, finish = true, headers = {}) {
    let req;
    const response = new Promise((resolve, reject) => {
        req = http.request({ host: "127.0.0.1", port, method: "POST", headers: { "content-type": "application/json", ...headers } }, (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
        });
        req.on("error", reject);
        req.write(body);
        if (finish) req.end();
    });
    response.catch(() => {});
    return { req, response };
}

test("JSON parsers share an aggregate admission budget and release disconnected requests", async () => {
    await server(parser(), async (port) => {
        const pending = Array.from({ length: 6 }, () => request(port, "{", false));
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(await request(port, "{}").response, 503);
        for (const item of pending) item.req.destroy();
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(await request(port, "{}").response, 200);
    });
});

test("compressed bodies reserve their inflated ceiling despite a small declared wire length", async () => {
    await server(parser(), async (port) => {
        const pending = Array.from({ length: 6 }, () => request(port, Buffer.from([31, 139]), false, { "content-encoding": "gzip", "content-length": "64" }));
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(await request(port, "{}").response, 503);
        for (const item of pending) item.req.destroy();
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(await request(port, "{}").response, 200);
    });
});

test("unfinished JSON bodies expire and normal malformed JSON remains a 400", async () => {
    await server(parser(50), async (port) => {
        assert.equal(await request(port, "{", false).response, 408);
        assert.equal(await request(port, "{").response, 400);
        assert.equal(await request(port, "{}").response, 200);
    });
});

test("bodyless reads and parsed small bodies leave capacity for nested JSON requests", async () => {
    const middleware = parser();
    const app = express();
    const held = [];
    const errors = [];
    app.use(middleware);
    app.use(middleware);
    app.get("/held", (_req, res) => held.push(res));
    app.post("/held", (req, res) => {
        assert.equal(JSON.stringify(req.body), "{}");
        held.push(res);
    });
    app.post("/", (req, res) => res.json(req.body));
    app.use((error, _req, res, _next) => {
        errors.push(error.message);
        res.status(error.status ?? 500).end();
    });
    const listener = app.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    const pending = [];
    try {
        for (const method of ["GET", "POST"])
            for (let index = 0; index < 8; index++) {
                const req = http.request({
                    host: "127.0.0.1",
                    port,
                    method,
                    path: "/held",
                    headers: method === "POST" ? { "content-type": "application/json", "content-length": "2" } : {},
                });
                req.on("error", () => {});
                req.end(method === "POST" ? "{}" : undefined);
                pending.push(req);
            }
        for (let index = 0; index < 100 && held.length < 16; index++) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(held.length, 16, JSON.stringify(errors));
        assert.equal(await request(port, "{}").response, 200);
    } finally {
        for (const response of held) response.end();
        for (const req of pending) req.destroy();
        listener.closeAllConnections();
        await new Promise((resolve) => listener.close(resolve));
    }
});
