const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const source = fs.readFileSync("scripts/dev/worktree-setup.sh", "utf8");

function fixture(t, options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meowcord-setup-fixture-"));
    const bin = path.join(root, "bin");
    const script = path.join(root, "scripts/dev/worktree-setup.sh");
    const trace = path.join(root, "trace");
    const pid = path.join(root, "owned-pid");
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.mkdirSync(path.join(root, "extra/pion-sfu"), { recursive: true });
    fs.mkdirSync(bin);
    fs.writeFileSync(script, source);
    const mock = (name, code) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nprintf '%s\\n' "${name} $*" >> "$SETUP_FIXTURE_TRACE"\n${code}\n`, { mode: 0o700 });
    mock("git", 'printf "worktree %s\\n" "$PWD"');
    mock("go", "exit 1");
    mock("curl", "exit 0");
    mock("createdb", '[ "$SETUP_FIXTURE_RACE" = 1 ] && exit 1\nexit 0');
    mock("dropdb", "exit 99");
    if (!options.realPostgres) mock("psql", '[ "$SETUP_FIXTURE_EXISTING" = 1 ] && echo 1\nexit 0');
    mock(
        "lsof",
        `
if [ -n "$SETUP_FIXTURE_BUSY" ] && [ "$1" = "$SETUP_FIXTURE_BUSY" ]; then echo 999999; exit 0; fi
if [ -f "$SETUP_FIXTURE_PID" ] && [ "$1" = "-tiTCP:3413" ]; then
    if [ "$SETUP_FIXTURE_LATE_LISTENER" = 1 ]; then echo 999999; else cat "$SETUP_FIXTURE_PID"; fi
    exit 0
fi
exit 1`,
    );
    mock(
        "bun",
        `
if [ "$1" = dist/bundle/start.js ]; then
    [ "$SETUP_FIXTURE_START_FAILURE" = 1 ] && exit 78
    exec "$SETUP_FIXTURE_BUN" -e 'require("node:fs").writeFileSync(process.env.SETUP_FIXTURE_PID,String(process.pid));setInterval(()=>{},1000)'
fi
exit 0`,
    );
    t.after(async () => {
        if (fs.existsSync(pid)) {
            const child = Number(fs.readFileSync(pid, "utf8"));
            try {
                process.kill(child, "SIGTERM");
            } catch (error) {
                if (error.code !== "ESRCH") throw error;
            }
            for (let count = 0; count < 100; count++) {
                try {
                    process.kill(child, 0);
                } catch {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
        }
        fs.rmSync(root, { recursive: true, force: true });
    });
    const run = (overrides = {}, args = ["3413", "meowcord_setup_fixture"]) =>
        spawnSync("/bin/sh", [script, ...args], {
            env: {
                ...process.env,
                PATH: `${bin}:${process.env.PATH}`,
                USER: options.user || "fixture_owner",
                SETUP_FIXTURE_TRACE: trace,
                SETUP_FIXTURE_PID: pid,
                SETUP_FIXTURE_BUN: process.execPath,
                ...overrides,
            },
            encoding: "utf8",
            timeout: 10000,
        });
    return {
        root,
        run,
        calls: () => (fs.existsSync(trace) ? fs.readFileSync(trace, "utf8").trim().split("\n") : []),
    };
}

for (const name of [".env", ".env.local", ".env.production", "config.json"]) {
    test(`setup preserves existing ${name} before running commands`, (t) => {
        const f = fixture(t);
        const file = path.join(f.root, name);
        fs.writeFileSync(file, "existing configuration");
        const result = f.run();
        assert.equal(result.status, 1);
        assert.match(result.stderr, /refusing to overwrite existing runtime configuration/);
        assert.equal(fs.readFileSync(file, "utf8"), "existing configuration");
        assert.deepEqual(f.calls(), []);
    });
}

test("setup rejects a broken configuration symlink without replacing it", (t) => {
    const f = fixture(t);
    const file = path.join(f.root, ".env");
    fs.symlinkSync("missing-private-config", file);
    assert.equal(f.run().status, 1);
    assert.equal(fs.readlinkSync(file), "missing-private-config");
    assert.deepEqual(f.calls(), []);
});

for (const endpoint of ["-tiTCP:3413", "-tiTCP:4413", "-tiUDP:5413"]) {
    test(`setup refuses occupied ${endpoint} without claiming a database`, (t) => {
        const f = fixture(t);
        const result = f.run({ SETUP_FIXTURE_BUSY: endpoint });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /already occupied/);
        assert.ok(f.calls().every((call) => call.startsWith("lsof ")));
        assert.equal(fs.existsSync(path.join(f.root, ".env")), false);
    });
}

test("setup refuses an existing database without drops, installation or file changes", (t) => {
    const f = fixture(t);
    const result = f.run({ SETUP_FIXTURE_EXISTING: "1" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already exists/);
    assert.ok(f.calls().some((call) => call.startsWith("psql ")));
    assert.ok(f.calls().every((call) => /^(lsof|psql) /.test(call)));
    assert.equal(fs.existsSync(path.join(f.root, ".env")), false);
});

test("database creation losing a race stops before any configuration changes", (t) => {
    const f = fixture(t);
    const result = f.run({ SETUP_FIXTURE_RACE: "1" });
    assert.equal(result.status, 1);
    assert.ok(f.calls().some((call) => call.startsWith("createdb ")));
    assert.ok(f.calls().every((call) => /^(lsof|psql|createdb) /.test(call)));
    assert.equal(fs.existsSync(path.join(f.root, ".env")), false);
    assert.equal(fs.existsSync(path.join(f.root, "config.json")), false);
});

test("setup rejects invalid ports and database names before running commands", (t) => {
    const f = fixture(t);
    for (const args of [
        ["0", "valid"],
        ["080", "valid"],
        ["63536", "valid"],
        ["3413", "a/b"],
        ["3413", "bad';drop"],
        ["3413", "a".repeat(64)],
    ]) {
        assert.equal(f.run({}, args).status, 1);
        assert.deepEqual(f.calls(), []);
    }
});

test("fresh setup claims one database, preserves the example and starts only its owned child", (t) => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.root, ".env.example"), "public placeholders");
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const calls = f.calls();
    assert.equal(calls.filter((call) => call.startsWith("createdb ")).length, 1);
    assert.ok(calls.indexOf(calls.find((call) => call.startsWith("createdb "))) < calls.indexOf("bun install --frozen-lockfile"));
    assert.ok(calls.every((call) => !call.startsWith("dropdb ")));
    assert.ok(calls.includes("bun dist/bundle/start.js"));
    assert.ok(calls.includes("bun scripts/dev/seed.mjs"));
    assert.ok(calls.some((call) => call.includes("http://localhost:3413/readyz")));
    assert.ok(calls.some((call) => call.includes("http://localhost:3413/api/ping")));
    assert.ok(calls.some((call) => call.includes("http://localhost:3413/login")));
    assert.equal(fs.readFileSync(path.join(f.root, ".env.example"), "utf8"), "public placeholders");
    assert.equal(fs.statSync(path.join(f.root, ".env")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(f.root, "config.json")).mode & 0o777, 0o600);
});

test("a late foreign listener is rejected before seeding and never stopped", (t) => {
    const f = fixture(t);
    const result = f.run({ SETUP_FIXTURE_LATE_LISTENER: "1" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /other process was left running/);
    assert.ok(!f.calls().includes("bun scripts/dev/seed.mjs"));
});

test("an owned startup failure stops before seeding", (t) => {
    const f = fixture(t);
    const result = f.run({ SETUP_FIXTURE_START_FAILURE: "1" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /owned server exited before readiness/);
    assert.ok(!f.calls().includes("bun scripts/dev/seed.mjs"));
});

test("real PostgreSQL existing-database refusal preserves its marker row", { skip: !process.env.DATABASE_TEST_ADMIN_URL }, async (t) => {
    const { Client } = require("pg");
    const url = new URL(process.env.DATABASE_TEST_ADMIN_URL);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.equal(url.port || "5432", "5432");
    const database = `meowcord_setup_${randomUUID().replaceAll("-", "")}`;
    const admin = new Client({ connectionString: url.href });
    let created = false;
    let connection;
    try {
        await admin.connect();
        await admin.query(`CREATE DATABASE "${database}"`);
        created = true;
        url.pathname = `/${database}`;
        connection = new Client({ connectionString: url.href });
        await connection.connect();
        await connection.query("CREATE TABLE setup_marker (id integer PRIMARY KEY)");
        await connection.query("INSERT INTO setup_marker VALUES (1)");
        const f = fixture(t, { realPostgres: true, user: decodeURIComponent(url.username) });
        const result = f.run({}, ["3413", database]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, /already exists/);
        assert.deepEqual((await connection.query("SELECT id FROM setup_marker")).rows, [{ id: 1 }]);
        assert.ok(f.calls().every((call) => call.startsWith("lsof ")));
        assert.equal(fs.existsSync(path.join(f.root, ".env")), false);
    } finally {
        await connection?.end();
        if (created) await admin.query(`DROP DATABASE "${database}"`);
        await admin.end();
    }
});
