const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync("scripts/vencord.js", "utf8");

function select(versions, installed = "12.8.1") {
    const calls = [];
    let initialized = false;
    let bootstrapped = false;
    const selectPnpm = vm.runInNewContext(`${source.slice(source.indexOf("const pnpm ="), source.indexOf("const install ="))}pnpm`, {
        path,
        SOURCE: "/source",
        CACHE: "/cache",
        process: { env: {} },
        fs: {
            readFileSync: (file) => JSON.stringify(file === "/source/package.json" ? { packageManager: "pnpm@12.8.1" } : { bin: { pnpm: "pnpm" } }),
            existsSync: () => bootstrapped,
            writeFileSync: (file, value) => {
                assert.equal(file, "/cache/tools/package.json");
                assert.equal(JSON.parse(value).private, true);
                initialized = true;
            },
            mkdirSync: () => {},
        },
        spawnSync: (command, args) => ({
            stdout: command === "node" ? (bootstrapped ? installed : "") : (versions[command] ?? ""),
        }),
        run: (command, args) => {
            assert.equal(initialized, true);
            calls.push([command, ...args]);
            bootstrapped = true;
        },
    });
    return { command: Array.from(selectPnpm()), calls };
}

test("Equicord rejects a different pnpm minor and bootstraps the exact pin through Node", () => {
    const result = select({ pnpm: "12.9.0", corepack: "11.0.0" });
    assert.deepEqual(result.command, ["node", "/cache/tools/node_modules/pnpm/bin/pnpm.mjs"]);
    assert.deepEqual(result.calls, [["bun", "add", "--cwd", "/cache/tools", "pnpm@12.8.1"]]);
});

test("Equicord uses an already installed exact pnpm without bootstrapping", () => {
    assert.deepEqual(select({ pnpm: "12.8.1" }), { command: ["pnpm"], calls: [] });
});

test("Equicord refuses a bootstrap that does not produce its pinned pnpm", () => {
    assert.throws(() => select({}, "12.9.0"), /could not bootstrap pinned pnpm 12.8.1/);
});

function typecheck(failure) {
    const calls = [];
    const main = source.slice(source.lastIndexOf("(() => {"));
    const context = {
        typecheck: true,
        checkout() {},
        pnpm: () => ["node", "/cache/tools/node_modules/pnpm/bin/pnpm.mjs"],
        install() {},
        copyPlugins: () => ["fosscordCore"],
        console: { log() {} },
        run: (command, args) => {
            calls.push([command, ...Array.from(args)]);
            if (failure) throw failure;
        },
        fs: {
            writeFileSync() {
                throw new Error("typecheck wrote build output");
            },
        },
    };
    return { run: () => vm.runInNewContext(main, context), calls };
}

test("Equicord typecheck invokes the pinned compiler without building or writing assets", () => {
    const check = typecheck();
    check.run();
    assert.deepEqual(check.calls, [["node", "/cache/tools/node_modules/pnpm/bin/pnpm.mjs", "testTsc"]]);
});

test("Equicord typecheck propagates compiler failures", () => {
    const failure = new Error("compiler rejected plugin");
    const check = typecheck(failure);
    assert.throws(check.run, (error) => error === failure);
    assert.equal(check.calls.length, 1);
});
