import { get } from "node:http";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at < 0 ? fallback : args[at + 1];
};
const origin = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3290}`;
const path = flag("path", "/assets/vencord/vencord.js");
const requests = Number(flag("requests", "1000"));
const levels = flag("concurrency", "1,8,32").split(",").map(Number);
if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Path must start with one slash");
if (!Number.isSafeInteger(requests) || requests < 1 || requests > 100000 || levels.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 256))
    throw new Error("Use 1–100000 requests and concurrency 1–256");
const url = new URL(path, origin);
if (url.protocol !== "http:") throw new Error("This local benchmark requires HTTP");
let expectedHash;
const request = () =>
    new Promise((resolve, reject) => {
        const started = performance.now();
        const req = get(url, { headers: { "accept-encoding": "br" } }, (response) => {
            const hash = createHash("sha256");
            let bytes = 0;
            response.on("data", (chunk) => {
                bytes += chunk.length;
                hash.update(chunk);
            });
            response.on("error", reject);
            response.on("end", () => {
                if (response.statusCode !== 200 || response.headers["content-encoding"] !== "br")
                    return reject(new Error(`Expected Brotli HTTP 200, received ${response.statusCode}`));
                const digest = hash.digest("hex");
                expectedHash ??= digest;
                if (digest !== expectedHash) return reject(new Error("Compressed asset changed during benchmark"));
                resolve({ elapsed: performance.now() - started, bytes });
            });
        });
        req.setTimeout(15000, () => req.destroy(new Error("Asset request timed out")));
        req.on("error", reject);
    });
const cold = await request();
const results = [];
for (const concurrency of levels) {
    let next = 0,
        bytes = 0;
    const samples = [];
    const started = performance.now();
    await Promise.all(
        Array.from({ length: Math.min(concurrency, requests) }, async () => {
            while (next++ < requests) {
                const result = await request();
                bytes += result.bytes;
                samples.push(result.elapsed);
            }
        }),
    );
    const elapsed = performance.now() - started;
    samples.sort((a, b) => a - b);
    const percentile = (p) => samples[Math.max(0, Math.ceil(samples.length * p) - 1)];
    const row = {
        concurrency,
        requests: samples.length,
        requests_per_second: (samples.length * 1000) / elapsed,
        p95_ms: percentile(0.95),
        p99_ms: percentile(0.99),
        bytes,
        statuses: { 200: samples.length },
    };
    results.push(row);
    console.log(JSON.stringify(row));
}
const report = {
    sampled_at: new Date().toISOString(),
    origin,
    path,
    first_request_ms: cold.elapsed,
    compressed_sha256: expectedHash,
    results,
};
if (flag("output")) writeFileSync(flag("output"), `${JSON.stringify(report, null, 2)}\n`);
