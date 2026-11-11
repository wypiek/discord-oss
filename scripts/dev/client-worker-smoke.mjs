import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { chromiumPath } from "../util/chromium.cjs";
const playwright = createRequire(path.join(homedir(), ".cache/fosscord-tools/package.json"))("playwright-core");
const cache = path.resolve(process.env.CLIENT_CACHE_PATH || "assets/cache");
const browserName = process.env.BROWSER || "chromium";
assert.ok(["chromium", "webkit"].includes(browserName));
const bootstraps = readdirSync(cache)
    .sort()
    .filter((name) => {
        if (!/^[\w.-]+\.js$/.test(name)) return false;
        const source = readFileSync(path.join(cache, name), "utf8");
        return source.includes("importScripts(") && /\.[uk]=[A-Za-z_$][\w$]*=>/.test(source);
    });
assert.ok(bootstraps.length > 0);
const requests = [];
const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/")
            return new Response("<!doctype html><title>Local worker snapshot check</title>", {
                headers: { "content-type": "text/html" },
            });
        const match = pathname.match(/^\/assets\/([\w.-]+)$/);
        if (!match) return new Response("Missing", { status: 404 });
        const file = Bun.file(path.join(cache, match[1]));
        const status = (await file.exists()) ? 200 : 404;
        requests.push({ name: match[1], status });
        return status === 200
            ? new Response(file, {
                  headers: {
                      "content-type": match[1].endsWith(".js") ? "application/javascript" : file.type,
                  },
              })
            : new Response("Missing", { status });
    },
});
const origin = `http://127.0.0.1:${server.port}`;
let browser;
try {
    browser = await playwright[browserName].launch(
        browserName === "chromium"
            ? {
                  executablePath: chromiumPath(),
                  headless: true,
              }
            : { headless: true },
    );
    const context = await browser.newContext();
    const external = [];
    await context.route("**/*", async (route) => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        external.push({ protocol: new URL(route.request().url()).protocol });
        return route.abort();
    });
    const page = await context.newPage();
    await page.goto(origin);
    const results = [];
    for (const name of bootstraps) {
        const before = requests.length;
        const errors = await page.evaluate(async (name) => {
            const errors = [];
            const worker = new Worker(`/assets/${name}`);
            worker.onerror = (error) => errors.push({ line: error.lineno, column: error.colno });
            await new Promise((resolve) => setTimeout(resolve, 1000));
            worker.terminate();
            return errors;
        }, name);
        const served = requests.slice(before);
        results.push({
            bootstrap: name,
            requests: served.length,
            failures: served.filter((request) => request.status !== 200),
            errors,
        });
    }
    console.log(
        JSON.stringify({
            browser: browserName,
            workers: results.length,
            observationMs: 1000,
            externalRequests: external.length,
            results,
        }),
    );
    assert.deepEqual(external, []);
    for (const result of results) {
        assert.ok(result.requests > 1, result.bootstrap);
        assert.deepEqual(result.failures, [], result.bootstrap);
        assert.deepEqual(result.errors, [], result.bootstrap);
    }
} finally {
    await browser?.close();
    server.stop(true);
}
