const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

test("repository ignore rules protect runtime secrets, fixture accounts and client caches", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meowcord-ignore-"));
    const protectedPaths = [
        ".env",
        ".env.local",
        ".env.production",
        ".env.test",
        "nested/.env.local",
        "config.json",
        ".e2ee-recovery.key",
        ".e2ee-recovery.key.previous",
        ".e2ee-system/identity.json",
        ".announcement-spool/envelope.json",
        "scripts/dev/.test-account",
        "scripts/dev/.e2ee-test-accounts",
        "scripts/dev/.test-bot",
        "scripts/dev/.scale-tokens.json",
        "assets/cache/client.js",
        "assets/cache_compressed/client.js.br",
        "assets/vencord/browser.js",
        ".vencord/src/index.ts",
    ];
    const publicPaths = [".env.example", "nested/.env.example", "client/vencord.json", "client/plugins/fosscordPride/index.ts"];
    try {
        execFileSync("git", ["init", "-q", directory]);
        fs.copyFileSync(path.resolve(".gitignore"), path.join(directory, ".gitignore"));
        const ignored = execFileSync("git", ["-c", "core.excludesFile=/dev/null", "check-ignore", "--no-index", "--stdin"], {
            cwd: directory,
            input: [...protectedPaths, ...publicPaths].join("\n") + "\n",
            encoding: "utf8",
        })
            .trim()
            .split("\n");
        assert.deepEqual(ignored, protectedPaths);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
