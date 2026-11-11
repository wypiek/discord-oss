import { readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at < 0 ? fallback : args[at + 1];
};
if (args.includes("--help")) {
    console.log(
        "PORT=3290 bun scripts/dev/admin-bench.mjs --concurrency 1,8,32 --requests 200 --output report.json\nUses the isolated dev .test-account or ADMIN_BENCH_TOKEN. Only sends GET requests. --paths accepts comma-separated API paths.",
    );
    process.exit(0);
}
const origin = process.env.ORIGIN || `http://localhost:${process.env.PORT || 3001}`;
const requests = Number(flag("requests", "200"));
const levels = flag("concurrency", "1,8,32").split(",").map(Number);
if (!Number.isSafeInteger(requests) || requests < 1 || requests > 100000 || levels.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 256))
    throw new Error("Use 1–100000 requests and concurrency 1–256");
let token = process.env.ADMIN_BENCH_TOKEN;
if (!token) {
    const account = Object.fromEntries(
        readFileSync(new URL("./.test-account", import.meta.url), "utf8")
            .trim()
            .split("\n")
            .map((line) => line.split("=")),
    );
    const res = await fetch(`${origin}/api/v9/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: account.TEST_EMAIL, password: account.TEST_PASSWORD }),
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Dev login failed (${res.status})`);
    token = (await res.json()).token;
}
const paths = flag("paths", "/admin,/admin/users?limit=50,/admin/guilds?limit=50,/admin/store").split(",");
if (paths.some((path) => !path.startsWith("/") || path.startsWith("//"))) throw new Error("Paths must start with one slash");
const results = [];
const percentile = (sorted, p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
for (const path of paths) {
    const probe = await fetch(`${origin}/api/v9${path}`, {
        headers: { authorization: token },
        signal: AbortSignal.timeout(15000),
    });
    await probe.arrayBuffer();
    if (!probe.ok) throw new Error(`Benchmark route ${path} returned ${probe.status}`);
    for (const concurrency of levels) {
        let next = 0;
        const samples = [],
            statuses = {};
        const started = performance.now();
        await Promise.all(
            Array.from({ length: Math.min(concurrency, requests) }, async () => {
                while (next++ < requests) {
                    const t = performance.now();
                    let status;
                    try {
                        const res = await fetch(`${origin}/api/v9${path}`, {
                            headers: { authorization: token },
                            signal: AbortSignal.timeout(15000),
                        });
                        await res.arrayBuffer();
                        status = String(res.status);
                    } catch {
                        status = "network_error";
                    }
                    statuses[status] = (statuses[status] || 0) + 1;
                    samples.push(performance.now() - t);
                }
            }),
        );
        const elapsed = performance.now() - started;
        samples.sort((a, b) => a - b);
        const row = {
            path,
            concurrency,
            requests: samples.length,
            elapsed_ms: elapsed,
            requests_per_second: (samples.length * 1000) / elapsed,
            p50_ms: percentile(samples, 0.5),
            p95_ms: percentile(samples, 0.95),
            p99_ms: percentile(samples, 0.99),
            max_ms: samples.at(-1),
            statuses,
        };
        results.push(row);
        console.log(
            `${path} c=${concurrency}: ${row.requests_per_second.toFixed(1)} req/s, p50=${row.p50_ms.toFixed(1)} p95=${row.p95_ms.toFixed(1)} p99=${row.p99_ms.toFixed(1)} ms; ${JSON.stringify(statuses)}`,
        );
    }
}
const report = {
    sampled_at: new Date().toISOString(),
    origin,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    node: process.version,
    cpu_parallelism: availableParallelism(),
    results,
};
if (flag("output")) writeFileSync(flag("output"), `${JSON.stringify(report, null, 2)}\n`);
if (results.some((row) => Object.keys(row.statuses).some((status) => Number(status) < 200 || Number(status) >= 300 || status === "network_error"))) process.exitCode = 1;
