const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const vm = require("node:vm");
const { createHash } = require("node:crypto");
const { Transform } = require("node:stream");
const ts = require("typescript");
class HTTPError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}
const moduleFixture = { exports: {} };
vm.runInNewContext(
    ts.transpileModule(require("node:fs").readFileSync("src/cdn/util/FileQuotaStorageAdapter.ts", "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
        },
    }).outputText,
    {
        module: moduleFixture,
        exports: moduleFixture.exports,
        Buffer,
        require(name) {
            if (name === "lambert-server/HTTPError") return { HTTPError };
            return require(name);
        },
    },
);
const { FileQuotaStorageAdapter } = moduleFixture.exports;
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function fixture(t, options = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "fosscord-file-quota-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const adapter = new FileQuotaStorageAdapter(root, "fixture", options);
    const request = (id, bytes = 128, filename = "attachments/10/file.bin") => ({
        namespace: "fixture",
        id,
        path: filename,
        principal: "user:fixture",
        category: "upload",
        upperBytes: BigInt(bytes),
    });
    return {
        root,
        adapter,
        request,
        read: (filename) => fs.readFile(path.join(root, filename ?? "attachments/10/file.bin")),
    };
}
test("actual EXIF transformed bytes are measured and replacements commit atomically", async (t) => {
    const f = await fixture(t);
    const req = f.request("first");
    const segment = Buffer.concat([Buffer.from([0xff, 0xe1, 0, 36]), Buffer.from("Exif\0\0"), Buffer.alloc(28, 9)]);
    const bytes = Buffer.concat([Buffer.from([0xff, 0xd8]), segment, Buffer.from("image fixture content"), Buffer.from([0xff, 0xd9])]);
    const result = await f.adapter.write(req, bytes);
    const stored = await f.read();
    assert.equal(result.bytes, BigInt(stored.length));
    assert.ok(stored.length < bytes.length);
    assert.equal(result.generation, "first");
    const second = await f.adapter.write(f.request("second"), Buffer.from("replacement"));
    assert.equal(second.bytes, 11n);
    assert.equal((await f.read()).toString(), "replacement");
    await assert.rejects(f.adapter.remove(req.path, "first"), (error) => error.code === 409);
    assert.equal((await f.read()).toString(), "replacement");
});
test("bounded transformed output rejects growth and preserves prior generation", async (t) => {
    let expand = false;
    const f = await fixture(t, {
        transform: () =>
            new Transform({
                transform(chunk, encoding, callback) {
                    callback(null, expand ? Buffer.concat([chunk, Buffer.alloc(32)]) : chunk);
                },
            }),
    });
    await f.adapter.write(f.request("old", 8), Buffer.from("old"));
    expand = true;
    const req = f.request("expanded", 8);
    await assert.rejects(f.adapter.write(req, Buffer.from("new")), (error) => error.code === 413);
    assert.equal((await f.read()).toString(), "old");
    assert.equal(await f.adapter.unchanged(req), true);
    const files = await fs.readdir(path.join(f.root, "attachments/10"));
    assert.deepEqual(files, ["file.bin"]);
});
test("all pre-replacement failure points preserve old bytes and prove unchanged", async (t) => {
    for (const step of ["prepared", "written"]) {
        let fail = false;
        const f = await fixture(t, {
            checkpoint: async (current) => {
                if (fail && current === step) {
                    assert.equal((await f.read()).toString(), "old");
                    throw Error(`failure ${step}`);
                }
            },
        });
        await f.adapter.write(f.request("old"), Buffer.from("old"));
        fail = true;
        const req = f.request(`failed-${step}`);
        await assert.rejects(f.adapter.write(req, Buffer.from("new")), /failure/);
        assert.equal((await f.read()).toString(), "old");
        assert.equal(await f.adapter.unchanged(req), true);
    }
});
test("post-rename failure never proves unchanged and generation replay recovers metadata", async (t) => {
    for (const step of ["renamed", "recorded"]) {
        let once = true;
        const f = await fixture(t, {
            checkpoint: async (current) => {
                if (once && current === step) {
                    once = false;
                    throw Error(`failure ${step}`);
                }
            },
        });
        const req = f.request(`failed-${step}`);
        await assert.rejects(f.adapter.write(req, Buffer.from("new bytes")), /failure/);
        assert.equal(await f.adapter.unchanged(req), false);
        assert.equal((await f.read()).toString(), "new bytes");
        const result = await f.adapter.write(req, Buffer.from("new bytes"));
        assert.equal(result.bytes, 9n);
        assert.equal(result.generation, req.id);
        await f.adapter.remove(req.path, req.id);
        await assert.rejects(f.read(), (error) => error.code === "ENOENT");
    }
});
test("write replay is idempotent and reused operation cannot change path or byte bound", async (t) => {
    const f = await fixture(t),
        req = f.request("same");
    await f.adapter.write(req, Buffer.from("original"));
    const before = await fs.stat(path.join(f.root, req.path));
    await f.adapter.write(req, Buffer.from("ignored retry"));
    const after = await fs.stat(path.join(f.root, req.path));
    assert.equal(before.ino, after.ino);
    assert.equal((await f.read()).toString(), "original");
    await assert.rejects(f.adapter.write({ ...req, path: "another.bin" }, Buffer.from("x")), (error) => error.code === 409);
    await assert.rejects(f.adapter.write({ ...req, upperBytes: 127n }, Buffer.from("x")), (error) => error.code === 409);
});
test("clone is bounded, independently stored and checks source generation/content", async (t) => {
    const f = await fixture(t),
        source = f.request("source", 100, "attachments/10/source.bin");
    await f.adapter.write(source, Buffer.from("source data"));
    const dest = f.request("clone", 11, "attachments/10/clone.bin");
    const result = await f.adapter.clone(dest, { path: source.path, generation: "source" });
    assert.equal(result.bytes, 11n);
    assert.equal((await f.read(dest.path)).toString(), "source data");
    const a = await fs.stat(path.join(f.root, source.path)),
        b = await fs.stat(path.join(f.root, dest.path));
    assert.notEqual(a.ino, b.ino);
    await assert.rejects(
        f.adapter.clone(f.request("small", 1, "small.bin"), {
            path: source.path,
            generation: "source",
        }),
        (error) => error.code === 413,
    );
    await assert.rejects(
        f.adapter.clone(f.request("wrong", 20, "wrong.bin"), {
            path: source.path,
            generation: "wrong",
        }),
        (error) => error.code === 409,
    );
    await fs.writeFile(path.join(f.root, source.path), "tampered");
    await assert.rejects(
        f.adapter.clone(f.request("tampered", 20, "tampered.bin"), {
            path: source.path,
            generation: "source",
        }),
        (error) => error.code === 503,
    );
});
test("delete failure remains retryable and tombstone proves success after downstream DB failure", async (t) => {
    for (const step of ["before-delete", "deleted"]) {
        let fail = false;
        const f = await fixture(t, {
            checkpoint: async (current) => {
                if (fail && current === step) {
                    fail = false;
                    throw Error(`failure ${step}`);
                }
            },
        });
        const req = f.request("generation");
        await f.adapter.write(req, Buffer.from("file"));
        fail = true;
        await assert.rejects(f.adapter.remove(req.path, req.id), /failure/);
        if (step === "before-delete") assert.equal((await f.read()).toString(), "file");
        await f.adapter.remove(req.path, req.id);
        await f.adapter.remove(req.path, req.id);
        await assert.rejects(f.read(), (error) => error.code === "ENOENT");
        await f.adapter.write(f.request("new-generation"), Buffer.from("new"));
        await assert.rejects(f.adapter.remove(req.path, req.id), (error) => error.code === 409);
        assert.equal((await f.read()).toString(), "new");
    }
});
test("tampered or unknown files never become unchanged/adopted/deleted", async (t) => {
    const f = await fixture(t);
    const req = f.request("good");
    await f.adapter.write(req, Buffer.from("original"));
    await fs.writeFile(path.join(f.root, req.path), "tampered");
    await assert.rejects(f.adapter.remove(req.path, req.id), (error) => error.code === 409);
    await assert.rejects(f.adapter.write(f.request("overwrite"), Buffer.from("new")), (error) => error.code === 503);
    assert.equal(await f.adapter.unchanged(f.request("unstarted")), false);
    await fs.writeFile(path.join(f.root, "unknown.bin"), "legacy object");
    await assert.rejects(f.adapter.write(f.request("claim", 128, "unknown.bin"), Buffer.from("new")), (error) => error.code === 503);
    await assert.rejects(f.adapter.remove("unknown.bin", "attacker"), (error) => error.code === 409);
    assert.equal((await f.read("unknown.bin")).toString(), "legacy object");
});
test("path traversal, reserved metadata, symlink and hardlink destinations fail closed", async (t) => {
    const f = await fixture(t);
    for (const name of ["../outside", "/absolute", "a/../escape", "a//file", "a\\file", ".storage-quota/objects/injection", "file\0"])
        await assert.rejects(f.adapter.write(f.request("bad", 128, name), Buffer.from("x")), (error) => error.code === 400);
    const outside = path.join(f.root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "keep.bin"), "preserved");
    await fs.symlink(outside, path.join(f.root, "linked"));
    await assert.rejects(f.adapter.write(f.request("link", 128, "linked/keep.bin"), Buffer.from("x")), (error) => error.code === 503);
    await fs.symlink(path.join(outside, "keep.bin"), path.join(f.root, "leaf.bin"));
    await assert.rejects(f.adapter.write(f.request("leaf", 128, "leaf.bin"), Buffer.from("x")), (error) => error.code === 503);
    await fs.link(path.join(outside, "keep.bin"), path.join(f.root, "hard.bin"));
    await assert.rejects(f.adapter.write(f.request("hard", 128, "hard.bin"), Buffer.from("x")), (error) => error.code === 503);
    assert.equal((await fs.readFile(path.join(outside, "keep.bin"))).toString(), "preserved");
});
test("metadata tampering cannot redirect unchanged proof outside target", async (t) => {
    let fail = true;
    const f = await fixture(t, {
        checkpoint: async (step) => {
            if (fail && step === "prepared") {
                fail = false;
                throw Error("prepared fail");
            }
        },
    });
    const req = f.request("metadata");
    await assert.rejects(f.adapter.write(req, Buffer.from("x")), /fail/);
    const filename = path.join(f.root, ".storage-quota/operations", hash(req.id));
    const intent = JSON.parse(await fs.readFile(filename, "utf8"));
    intent.temporary = "/definitely-outside-this-fixture";
    await fs.writeFile(filename, JSON.stringify(intent));
    assert.equal(await f.adapter.unchanged(req), false);
});
test("two adapter instances serialize physical writes without stealing crash locks", async (t) => {
    let release, entered;
    const hold = new Promise((resolve) => (release = resolve)),
        ready = new Promise((resolve) => (entered = resolve));
    const f = await fixture(t, {
        checkpoint: async (step) => {
            if (step === "prepared") {
                entered();
                await hold;
            }
        },
    });
    const other = new FileQuotaStorageAdapter(f.root, "fixture");
    const first = f.adapter.write(f.request("first"), Buffer.from("first"));
    await ready;
    await assert.rejects(other.write(f.request("other"), Buffer.from("other")), (error) => error.code === 409);
    release();
    await first;
    const lock = path.join(f.root, ".storage-quota/locks", hash("crashed.bin"));
    await fs.mkdir(lock);
    await assert.rejects(other.write(f.request("crash", 10, "crashed.bin"), Buffer.from("x")), (error) => error.code === 409);
    await fs.stat(lock);
});

test("late destination tampering blocks delete and metadata symlinks cannot escape root", async (t) => {
    let tamper = false;
    const f = await fixture(t, {
        checkpoint: async (step) => {
            if (tamper && step === "before-delete") await fs.writeFile(path.join(f.root, "attachments/10/file.bin"), "changed after proof");
        },
    });
    const req = f.request("owned");
    await f.adapter.write(req, Buffer.from("original"));
    tamper = true;
    await assert.rejects(f.adapter.remove(req.path, req.id), (error) => error.code === 409);
    assert.equal((await f.read()).toString(), "changed after proof");
    const second = await fixture(t);
    await second.adapter.write(second.request("init"), Buffer.from("init"));
    const folder = path.join(second.root, ".storage-quota/operations");
    await fs.rename(folder, folder + "-saved");
    await fs.symlink(folder + "-saved", folder);
    await assert.rejects(second.adapter.write(second.request("escape"), Buffer.from("x")), (error) => error.code === 503);
});

test("zero-byte files retain generations and malformed admission never writes a target", async (t) => {
    const f = await fixture(t);
    const req = f.request("zero", 0, "zero.bin");
    assert.equal((await f.adapter.write(req, Buffer.alloc(0))).bytes, 0n);
    assert.equal((await f.read("zero.bin")).length, 0);
    assert.equal(
        (
            await f.adapter.clone(f.request("zero-clone", 0, "zero-clone.bin"), {
                path: "zero.bin",
                generation: "zero",
            })
        ).bytes,
        0n,
    );
    await assert.rejects(f.adapter.write({ ...f.request("bad", 1, "bad.bin"), namespace: "other" }, Buffer.from("x")), (error) => error.code === 400);
    await assert.rejects(f.adapter.write(f.request("large", 1, "large.bin"), Buffer.from("large")), (error) => error.code === 413);
    await assert.rejects(f.read("bad.bin"), (error) => error.code === "ENOENT");
    await assert.rejects(f.read("large.bin"), (error) => error.code === "ENOENT");
});

test("root namespace binding cannot be reset by constructing another ledger namespace", async (t) => {
    const f = await fixture(t);
    await f.adapter.write(f.request("first"), Buffer.from("original"));
    const other = new FileQuotaStorageAdapter(f.root, "different");
    await assert.rejects(other.write({ ...f.request("attempt"), namespace: "different" }, Buffer.from("overwrite")), (error) => error.code === 503);
    assert.equal((await f.read()).toString(), "original");
});
