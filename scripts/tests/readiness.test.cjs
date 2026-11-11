const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const http = require("node:http");
const net = require("node:net");
const ts = require("typescript");
const express = require("express");

function load(path, imports, globals = {}) {
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(path, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
        module,
        exports: module.exports,
        require: (name) => imports[name],
        setTimeout,
        clearTimeout,
        ...globals,
    });
    return module.exports;
}

function readiness(globals) {
    return load("src/api/util/utility/readiness.ts", {}, globals).databaseReady;
}

async function serve(databaseReady, database) {
    const router = load("src/api/routes_toplevel/readyz.ts", {
        express,
        "@spacebar/api/middlewares": { route: () => (_, __, next) => next() },
        "@spacebar/database": { getDatabase: () => database },
        "../util/utility/readiness": { databaseReady },
    }).default;
    const app = express();
    app.use("/readyz", router);
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}/readyz`,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}

test("readiness rejects absent and closed databases without issuing SQL", async () => {
    const check = readiness();
    assert.equal(await check(null), false);
    assert.equal(await check({ isInitialized: false, query: () => assert.fail("closed database queried") }), false);
});

test("readiness shares pending work, bounds the deadline, and recovers after late completion", async () => {
    let expire;
    let finish;
    let calls = 0;
    const check = readiness({
        setTimeout: (callback) => {
            expire = callback;
            return 1;
        },
        clearTimeout: () => {},
    });
    const database = {
        isInitialized: true,
        query: (sql) => {
            assert.equal(sql, "SELECT 1");
            calls++;
            return new Promise((resolve) => {
                finish = resolve;
            });
        },
    };
    const first = check(database);
    assert.equal(check(database), first);
    await Promise.resolve();
    assert.equal(calls, 1);
    expire();
    assert.equal(await first, false);
    for (let i = 0; i < 100; i++) assert.equal(await check(database), false);
    assert.equal(calls, 1);
    finish([]);
    await new Promise((resolve) => setImmediate(resolve));
    database.query = async () => {
        calls++;
        return [{ value: 1 }];
    };
    assert.equal(await check(database), true);
    assert.equal(calls, 2);
});

test("actual readiness route returns uncached 503 on query failure and 200 after recovery", async () => {
    let failing = false;
    const database = {
        isInitialized: true,
        query: async () => {
            if (failing) throw new Error("private connection detail");
            return [{ value: 1 }];
        },
    };
    const server = await serve(readiness(), database);
    try {
        let response = await fetch(server.url);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-store");
        failing = true;
        response = await fetch(server.url);
        assert.equal(response.status, 503);
        assert.equal(await response.text(), "Service Unavailable");
        failing = false;
        assert.equal((await fetch(server.url)).status, 200);
    } finally {
        await server.close();
    }
});

test("readiness HTTP detects real PostgreSQL connection loss and recovery", { skip: !process.env.READINESS_TEST_DATABASE }, async () => {
    const { Pool } = require("pg");
    const upstream = new URL(process.env.READINESS_TEST_DATABASE);
    const sockets = new Set();
    let available = true;
    const proxy = net.createServer((socket) => {
        if (!available) {
            socket.destroy();
            return;
        }
        const remote = net.connect(Number(upstream.port || 5432), upstream.hostname);
        sockets.add(socket);
        sockets.add(remote);
        socket.on("error", () => remote.destroy());
        remote.on("error", () => socket.destroy());
        socket.on("close", () => {
            sockets.delete(socket);
            remote.destroy();
        });
        remote.on("close", () => {
            sockets.delete(remote);
            socket.destroy();
        });
        socket.pipe(remote).pipe(socket);
    });
    await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const target = new URL(upstream);
    target.hostname = "127.0.0.1";
    target.port = String(proxy.address().port);
    const pool = new Pool({
        connectionString: target.href,
        max: 1,
        connectionTimeoutMillis: 500,
        query_timeout: 500,
    });
    pool.on("error", () => {});
    const server = await serve(readiness(), {
        isInitialized: true,
        query: (sql) => pool.query(sql),
    });
    try {
        assert.equal((await fetch(server.url)).status, 200);
        available = false;
        for (const socket of sockets) socket.destroy();
        assert.equal((await fetch(server.url)).status, 503);
        available = true;
        assert.equal((await fetch(server.url)).status, 200);
    } finally {
        await server.close();
        await pool.end();
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => proxy.close(resolve));
    }
});
