const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { chunkNames, references } = require("../client.js");

const run = (directory, origin, args = []) =>
    new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, "../client.js"), ...args], {
            env: {
                ...process.env,
                CLIENT_CACHE_PATH: directory,
                CLIENT_BASE_URL: origin,
                CLIENT_CONCURRENCY: "2",
                CLIENT_RELEASE_REVIEW: "1",
            },
        });
        let output = "";
        child.stdout.on("data", (data) => {
            output += data;
        });
        child.stderr.on("data", (data) => {
            output += data;
        });
        child.on("error", reject);
        child.on("exit", (code) => resolve({ code, output }));
    });
const fixture = async (t, files) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fosscord-client-assets-"));
    const cache = path.join(directory, "cache");
    await fs.mkdir(cache);
    const requests = [];
    const server = http.createServer((req, res) => {
        requests.push(req.url);
        const body = files[req.url];
        res.statusCode = body === undefined ? 404 : 200;
        res.end(body ?? "missing");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
        await new Promise((resolve) => server.close(resolve));
        await fs.rm(directory, { recursive: true, force: true });
    });
    return { cache, requests, origin: `http://127.0.0.1:${server.address().port}` };
};

test("worker runtime maps support minified parameter names and multiple runtimes", () => {
    const names = chunkNames('l.u=n=>""+({470004:"fcb8bbf7d9775cef",71471:"779eb8e658d40679"})[n]+".js";r.k=x=>({10:"0123456789abcdef"})[x]+".css";');
    assert.deepEqual([...names].sort(), ["0123456789abcdef.css", "779eb8e658d40679.js", "fcb8bbf7d9775cef.js"]);
});

test("generation follows worker bootstrap chunks and their nested assets", async (t) => {
    const files = {
        "/app": '<script>window.GLOBAL_ENV={"BUILD_NUMBER":"1","VERSION_HASH":"abcdef"}</script><script src="/assets/web.0123456789abcdef.js"></script>',
        "/assets/web.0123456789abcdef.js": 'new Worker("/assets/5aab2b617a1a39cd.js")',
        "/assets/5aab2b617a1a39cd.js": 'l.u=n=>""+({470004:"fcb8bbf7d9775cef"})[n]+".js";importScripts(l.p+l.u(470004));',
        "/assets/fcb8bbf7d9775cef.js": 'const wasm="abcdef0123456789.wasm";',
        "/assets/abcdef0123456789.wasm": "wasm fixture",
    };
    const { cache, origin, requests } = await fixture(t, files);
    const result = await run(cache, origin);
    assert.equal(result.code, 0, result.output);
    assert.equal(await fs.readFile(path.join(cache, "fcb8bbf7d9775cef.js"), "utf8"), files["/assets/fcb8bbf7d9775cef.js"]);
    assert.ok(requests.includes("/assets/abcdef0123456789.wasm"));
    requests.length = 0;
    assert.equal((await run(cache, origin, ["--check"])).code, 0);
    assert.deepEqual(requests, []);
    await fs.unlink(path.join(cache, "fcb8bbf7d9775cef.js"));
    const incomplete = await run(cache, origin, ["--check"]);
    assert.equal(incomplete.code, 1);
    assert.match(incomplete.output, /missing fcb8bbf7d9775cef.js/);
    assert.deepEqual(requests, []);
    const repair = await run(cache, origin, ["--missing"]);
    assert.equal(repair.code, 0, repair.output);
    assert.deepEqual(requests, ["/assets/fcb8bbf7d9775cef.js"]);
});

test("failed dependency downloads preserve the previous published index", async (t) => {
    const files = {
        "/app": '<script>window.GLOBAL_ENV={"BUILD_NUMBER":"1","VERSION_HASH":"abcdef"}</script><script src="/assets/web.0123456789abcdef.js"></script>',
        "/assets/web.0123456789abcdef.js": 'l.u=e=>({42:"fcb8bbf7d9775cef"})[e]+".js";',
    };
    const { cache, origin } = await fixture(t, files);
    await fs.writeFile(path.join(cache, "index.html"), "previous working client");
    const result = await run(cache, origin);
    assert.equal(result.code, 1);
    assert.match(result.output, /client index was not published/);
    assert.equal(await fs.readFile(path.join(cache, "index.html"), "utf8"), "previous working client");
});

test("check without a snapshot fails without requesting upstream", async (t) => {
    const { cache, origin, requests } = await fixture(t, {});
    const result = await run(cache, origin, ["--check"]);
    assert.equal(result.code, 1);
    assert.deepEqual(requests, []);
});

test("external profile and shop art are not mistaken for application chunks", () => {
    const names = references(
        'let a="https://cdn.discordapp.com/avatars/123/bb3fd59e6c2ea0a86a2bdabf5dff7856.webp?size=80",b="https://cdn.discordapp.com/assets/0123456789abcdef.js",c="abcdef0123456789.wasm";',
    );
    assert.deepEqual([...names].sort(), ["0123456789abcdef.js", "abcdef0123456789.wasm"]);
});
