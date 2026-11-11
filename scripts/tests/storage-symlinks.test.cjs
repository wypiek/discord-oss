const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

test("local storage refuses symlink parents and leaves external files untouched", async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "storage-symlink-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const storageRoot = path.join(root, "storage");
    const external = path.join(root, "external");
    await fs.mkdir(storageRoot);
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, "secret"), "private");
    await fs.symlink(external, path.join(storageRoot, "escape"));
    const fixture = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(await fs.readFile("src/cdn/util/FileStorage.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        { module: fixture, exports: fixture.exports, Buffer, require, process: { env: { STORAGE_LOCATION: storageRoot } } },
    );
    const storage = new fixture.exports.FileStorage();
    for (const operation of [
        () => storage.get("escape/secret"),
        () => storage.set("escape/secret", Buffer.from("overwrite")),
        () => storage.delete("escape/secret"),
        () => storage.clone("escape/secret", "copy"),
        () => storage.move("escape/secret", "moved"),
    ])
        await assert.rejects(operation, /unsafe storage entry/);
    await assert.rejects(async () => {
        for await (const object of storage.inventory()) void object;
    }, /unsafe storage entry/);
    assert.equal(await fs.readFile(path.join(external, "secret"), "utf8"), "private");
    await fs.unlink(path.join(storageRoot, "escape"));
    await storage.set("safe/file", Buffer.from("value"));
    assert.equal((await storage.get("safe/file")).toString(), "value");
});
