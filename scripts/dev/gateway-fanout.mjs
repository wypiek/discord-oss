import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { createPrivateKey } from "node:crypto";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const { Client } = require("pg");
const jwt = require("jsonwebtoken");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
};
const root = new URL("../../", import.meta.url);
const env = Object.fromEntries(
    readFileSync(new URL(".env", root), "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const port = flag("port", process.env.PORT || env.PORT);
const total = Number(flag("sockets", "300"));
const concurrency = Number(flag("concurrency", "50"));
const runs = Number(flag("runs", "10"));
const lists = Number(flag("lists", "50"));
const compress = flag("compress", "");
const only = flag("only")?.split(",");
const selected = (name) => !only || only.some((part) => name.includes(part));
const api = `http://localhost:${port}/api/v9`;
const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fixture = JSON.parse(readFileSync(new URL("./.perf-fixture.json", import.meta.url), "utf8"));
const { guild, general, tester, roles } = fixture;
const key = createPrivateKey(readFileSync(new URL("jwt.key", root)));
const sign = (id) => jwt.sign({ id, iat: Math.floor(Date.now() / 1000), ver: 3 }, key, { algorithm: "ES512" });

const pid = execFileSync("lsof", [`-tiTCP:${port}`, "-sTCP:LISTEN"])
    .toString()
    .trim()
    .split("\n")[0];
const processStat = () => {
    const [rss, time] = execFileSync("ps", ["-o", "rss=,time=", "-p", pid]).toString().trim().split(/\s+/);
    const [rest, fraction] = time.split(".");
    const seconds = rest
        .split(":")
        .map(Number)
        .reduce((a, b) => a * 60 + b, 0);
    return { rss: Number(rss) * 1024, cpu: (seconds + Number(`0.${fraction}`)) * 1000 };
};

const db = new Client({ connectionString: env.DATABASE });
await db.connect();
const database = (await db.query("SELECT current_database() AS name")).rows[0].name;
const logPath = process.env.SERVER_LOG || new URL("server.log", root).pathname;
const logSize = () => (existsSync(logPath) ? statSync(logPath).size : 0);
const queriesSince = (from) => {
    const size = logSize();
    const buffer = Buffer.alloc(Math.max(0, size - from));
    const fd = openSync(logPath, "r");
    readSync(fd, buffer, 0, buffer.length, from);
    closeSync(fd);
    return buffer
        .toString("utf8")
        .split("\n")
        .filter((line) => /^query( failed)?:/.test(line) && !line.includes('SET "last_seen"')).length;
};
let poolSamples = [];
let sampling = false;
const sampleConnections = async () => {
    const sampler = new Client({ connectionString: env.DATABASE });
    await sampler.connect();
    sampling = true;
    poolSamples = [];
    while (sampling) {
        const { rows } = await sampler.query(
            "SELECT count(*) FILTER (WHERE state = 'active') AS active, count(*) AS open FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid() AND application_name = ''",
            [database],
        );
        poolSamples.push({ active: Number(rows[0].active), open: Number(rows[0].open) });
        await sleep(100);
    }
    await sampler.end();
};

const userIds = (await db.query("SELECT id FROM members WHERE guild_id = $1 AND id NOT IN ($2, $3) ORDER BY id LIMIT $4", [guild, tester.id, fixture.friend.id, total])).rows.map(
    (row) => row.id,
);
if (userIds.length < total) throw new Error(`the fixture has ${userIds.length} members, run seed-perf.mjs with MEMBERS=${total}`);

const call = async (method, path, body) => {
    for (;;) {
        const res = await fetch(`${api}${path}`, {
            method,
            headers: { ...(body && { "content-type": "application/json" }), authorization: tester.token },
            body: body && JSON.stringify(body),
        });
        const text = await res.text();
        if (res.status === 429) {
            await sleep(Math.ceil((JSON.parse(text).retry_after ?? 1) * 1000) + 50);
            continue;
        }
        if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
        return text ? JSON.parse(text) : null;
    }
};

const waiters = new Set();
const connect = (token, subscribe) =>
    new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/?encoding=json&v=9${compress ? `&compress=${compress}` : ""}`, { headers: { "user-agent": userAgent } });
        const socket = { ws, send: (payload) => ws.send(JSON.stringify(payload)), close: () => ws.close(1000) };
        let started;
        let inflate;
        if (compress === "zlib-stream") inflate = require("node:zlib").createInflate();
        const handle = (payload) => {
            if (payload.op === 10) {
                const beat = setInterval(() => ws.readyState === 1 && socket.send({ op: 1, d: null }), payload.d.heartbeat_interval * 0.8);
                ws.on("close", () => clearInterval(beat));
                started = performance.now();
                socket.send({
                    op: 2,
                    d: {
                        token,
                        capabilities: 30717,
                        properties: { os: "Linux", browser: "Chrome" },
                        presence: { status: "online", activities: [], afk: false, since: 0 },
                        compress: false,
                        client_state: { guild_versions: {} },
                    },
                });
            }
            if (payload.t === "READY") {
                socket.readyMs = performance.now() - started;
                if (subscribe) socket.send({ op: 14, d: { guild_id: guild, channels: { [general]: [[0, 99]] } } });
                resolve(socket);
            }
            if (payload.op === 9) reject(new Error("invalid session"));
            if (payload.op === 0) for (const waiter of waiters) waiter(socket, payload);
        };
        if (inflate) {
            let pending = "";
            inflate.on("data", (chunk) => {
                pending += chunk.toString();
            });
            ws.on("message", (raw) => {
                inflate.write(raw);
                inflate.flush(require("node:zlib").constants.Z_SYNC_FLUSH, () => {
                    if (!pending) return;
                    const text = pending;
                    pending = "";
                    handle(JSON.parse(text));
                });
            });
        } else ws.on("message", (raw) => handle(JSON.parse(raw.toString())));
        ws.on("close", (code) => reject(new Error(`closed ${code}`)));
        ws.on("error", reject);
        setTimeout(() => reject(new Error("identify timed out")), 120_000);
    });

const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? NaN;
};

let watcher;
for (let attempt = 1; !watcher; attempt++)
    watcher = await connect(tester.token, true).catch((error) => {
        if (attempt === 3) throw error;
        console.error(`watcher identify failed: ${error.message}`);
    });
await sleep(2000);
const baseline = processStat();
const sockets = [];
const failures = {};
const identifyLogStart = logSize();
const sampler = sampleConnections();
const identifyStarted = performance.now();
let cursor = 0;
await Promise.all(
    Array.from({ length: concurrency }, async () => {
        while (cursor < userIds.length) {
            const i = cursor++;
            try {
                sockets.push(await connect(sign(userIds[i]), i < lists));
                if (sockets.length % 250 === 0) console.error(`${sockets.length} sockets ready after ${((performance.now() - identifyStarted) / 1000).toFixed(1)} s`);
            } catch (error) {
                failures[error.message] = (failures[error.message] ?? 0) + 1;
            }
        }
    }),
);
const identifySeconds = (performance.now() - identifyStarted) / 1000;
sampling = false;
await sampler;
await sleep(3000);
const identifyQueries = queriesSince(identifyLogStart);
const connected = processStat();
const readyTimes = sockets.map((socket) => socket.readyMs);
console.log(
    JSON.stringify({
        sockets: sockets.length,
        failures,
        identifyPerSecond: Number((sockets.length / identifySeconds).toFixed(1)),
        readyP50: Math.round(percentile(readyTimes, 0.5)),
        readyP95: Math.round(percentile(readyTimes, 0.95)),
        readyMax: Math.round(Math.max(...readyTimes)),
        queriesPerIdentify: Number((identifyQueries / Math.max(1, sockets.length)).toFixed(1)),
        maxActiveConnections: Math.max(0, ...poolSamples.map((s) => s.active)),
        maxOpenConnections: Math.max(0, ...poolSamples.map((s) => s.open)),
        poolSaturatedShare: Number((poolSamples.filter((s) => s.active >= s.open && s.open > 0).length / Math.max(1, poolSamples.length)).toFixed(2)),
        rssBefore: baseline.rss,
        rssAfter: connected.rss,
        bytesPerSocket: Math.round((connected.rss - baseline.rss) / Math.max(1, sockets.length)),
        identifyCpuMs: Math.round((connected.cpu - baseline.cpu) / Math.max(1, sockets.length)),
    }),
);

const everyone = [...sockets, watcher];
const deliver = (predicate, audience) =>
    new Promise((resolve) => {
        const pending = new Set(audience);
        const times = [];
        const started = performance.now();
        const waiter = (socket, payload) => {
            if (!pending.has(socket) || !predicate(payload)) return;
            pending.delete(socket);
            times.push(performance.now() - started);
            if (pending.size) return;
            waiters.delete(waiter);
            clearTimeout(timer);
            resolve({ times, missing: 0 });
        };
        const timer = setTimeout(() => {
            waiters.delete(waiter);
            resolve({ times, missing: pending.size });
        }, 60_000);
        waiters.add(waiter);
    });

let n = 0;
const role = roles[1];
const target = userIds[0];
const listeners = sockets.slice(0, lists);
const scenarios = {
    MESSAGE_CREATE: () => {
        const nonce = `${Date.now()}${++n}`;
        return [deliver((p) => p.t === "MESSAGE_CREATE" && p.d.nonce === nonce, everyone), () => call("POST", `/channels/${general}/messages`, { content: `fanout ${n}`, nonce })];
    },
    TYPING_START: () => [deliver((p) => p.t === "TYPING_START" && p.d.user_id === tester.id, sockets), () => call("POST", `/channels/${general}/typing`)],
    PRESENCE_UPDATE: () => {
        const status = ++n % 2 ? "idle" : "online";
        return [
            deliver((p) => p.t === "PRESENCE_UPDATE" && p.d.user?.id === tester.id && p.d.status === status, listeners),
            async () => watcher.send({ op: 3, d: { status, since: 0, activities: [], afk: false } }),
        ];
    },
    GUILD_MEMBER_UPDATE: () => {
        const nick = `fan ${++n}`;
        return [deliver((p) => p.t === "GUILD_MEMBER_UPDATE" && p.d.nick === nick, everyone), () => call("PATCH", `/guilds/${guild}/members/${target}`, { nick })];
    },
    CHANNEL_CREATE: () => {
        const name = `fan-${Date.now()}-${++n}`;
        return [
            deliver((p) => p.t === "CHANNEL_CREATE" && p.d.name === name, everyone),
            async () => {
                const created = await call("POST", `/guilds/${guild}/channels`, { name, type: 0 });
                cleanup.push(created.id);
            },
        ];
    },
    GUILD_ROLE_UPDATE: () => {
        const color = (++n * 2654435761) & 0xffffff;
        return [deliver((p) => p.t === "GUILD_ROLE_UPDATE" && p.d.role?.color === color, everyone), () => call("PATCH", `/guilds/${guild}/roles/${role}`, { color })];
    },
};
const cleanup = [];

const rows = [];
for (const [name, scenario] of Object.entries(scenarios)) {
    if (!selected(name)) continue;
    const latencies = [];
    const lastTimes = [];
    const queries = [];
    let missing = 0;
    let cpu = 0;
    for (let i = 0; i < runs; i++) {
        await sleep(1500);
        const before = logSize();
        const cpuBefore = processStat().cpu;
        const [delivered, trigger] = scenario();
        await trigger();
        const result = await delivered;
        cpu += processStat().cpu - cpuBefore;
        await sleep(1500);
        queries.push(queriesSince(before));
        missing += result.missing;
        latencies.push(...result.times);
        lastTimes.push(Math.max(...result.times));
        for (const id of cleanup.splice(0)) await call("DELETE", `/channels/${id}`);
        if (name === "PRESENCE_UPDATE") await sleep(4500);
        console.error(`${name} run ${i + 1}: last ${Math.max(...result.times).toFixed(0)} ms, ${queries.at(-1)} queries, ${result.missing} missing`);
    }
    rows.push({
        name,
        queries: percentile(queries, 0.5),
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        last: percentile(lastTimes, 0.5),
        cpu: cpu / runs,
        missing,
    });
}

const final = processStat();
console.log(
    `\n${"event".padEnd(20)} ${"queries".padStart(8)} ${"p50 ms".padStart(8)} ${"p95 ms".padStart(8)} ${"last ms".padStart(8)} ${"cpu ms".padStart(8)} ${"missing".padStart(8)}`,
);
for (const r of rows)
    console.log(
        `${r.name.padEnd(20)} ${String(r.queries).padStart(8)} ${r.p50.toFixed(1).padStart(8)} ${r.p95.toFixed(1).padStart(8)} ${r.last.toFixed(1).padStart(8)} ${r.cpu.toFixed(0).padStart(8)} ${String(r.missing).padStart(8)}`,
    );
console.log(
    `\n${sockets.length} sockets, ${lists} with a member list, ${runs} runs per event, rss ${Math.round(final.rss / 1048576)} MiB, load ${execFileSync("uptime").toString().trim().split("averages: ")[1]}`,
);
for (const socket of [...sockets, watcher]) socket.ws.terminate();
await db.end();
process.exit(0);
