const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "../..");
function discoveryFixture({ fail = false } = {}) {
    const express = {};
    const routeUtility = {};
    const cache = {};
    const load = (file) => {
        if (file === "path") return path;
        if (file === "express") return express;
        if (file.endsWith("middlewares/Route.js")) return routeUtility;
        if (file === "picocolors") return new Proxy({}, { get: () => (text) => text });
        if (file === "lambert-server")
            return {
                traverseDirectory: async ({ dirname }, action) => {
                    // Discovery must wait for traversal, rather than returning early.
                    await new Promise((resolve) => setImmediate(resolve));
                    const file = path.join(dirname, dirname.includes("routes_toplevel") ? "healthz.js" : "admin/#user_id/index.js");
                    action(file);
                },
            };
        if (fail) throw new Error("broken route import");
        const router = express.Router();
        router.get("/", [[routeUtility.route({ summary: "Fixture route" })]], () => {}).post("/missing", () => {});
        return router;
    };
    load.resolve = (file) => file;
    load.cache = cache;
    const sandbox = {
        require: load,
        module: { exports: {} },
        __dirname: path.join(root, "scripts/util"),
        console: { log() {}, error() {} },
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, "scripts/util/getRouteDescriptions.js"), "utf8"), sandbox);
    return sandbox.module.exports;
}

test("discovery awaits traversal, supports nested middleware and chained registrations, and preserves prefixes", async () => {
    const discover = discoveryFixture();
    const routes = await discover();
    assert.equal(routes.size, 4);
    assert.equal(routes.get("/api/admin/:user_id/|get").summary, "Fixture route");
    assert.equal(routes.get("/api/admin/:user_id/missing|post"), null);
    assert.equal(routes.get("/healthz/|get").summary, "Fixture route");
    assert.equal(routes.get("/healthz/missing|post"), null);
    assert.equal((await discover()).size, 4);
    assert.equal(routes.size, 4);
});

test("route import failures reject generation instead of silently omitting endpoints", async () => {
    await assert.rejects(discoveryFixture({ fail: true })(), /Failed to discover routes/);
});

test("compiled aliases resolve inside this checkout's dist", () => {
    const result = spawnSync(
        process.execPath,
        [
            "-e",
            `
        const assert = require("node:assert/strict");
        const path = require("node:path");
        const { createRequire } = require("node:module");
        const fromDist = createRequire(path.resolve("dist/bundle/start.js"));
        for (const alias of ["@spacebar/api/middlewares", "@spacebar/database", "@spacebar/util", "lambert-server"]) {
            assert(fromDist.resolve(alias).startsWith(path.resolve("dist") + path.sep), alias);
        }
    `,
        ],
        { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
});

test("empty generation exits unsuccessfully and preserves the existing specification", () => {
    let written = false;
    const stopwatch = {
        startNew: () => ({ elapsed: () => ({ totalMilliseconds: 0, microseconds: 0 }) }),
    };
    const sandbox = {
        require: (name) => {
            if (name.endsWith("Stopwatch")) return { Stopwatch: stopwatch };
            if (name === "./util/getRouteDescriptions") return async () => new Map();
            if (name === "path") return path;
            if (name === "fs")
                return {
                    readFileSync: () => "{}",
                    writeFileSync: () => {
                        written = true;
                    },
                };
            if (name === "picocolors") return { bgRedBright: (x) => x, white: (x) => x };
            throw new Error(`Unexpected require ${name}`);
        },
        process: { env: {} },
        __dirname: path.join(root, "scripts"),
        console: { log() {}, error() {} },
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, "scripts/openapi.js"), "utf8"), sandbox);
    return new Promise((resolve) => setImmediate(resolve)).then(() => {
        assert.equal(sandbox.process.exitCode, 1);
        assert.equal(written, false);
    });
});
