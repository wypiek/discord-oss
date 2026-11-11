const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const transpile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

const { BoundedMap } = (() => {
    const module = { exports: {} };
    vm.runInNewContext(transpile(fs.readFileSync("client/e2ee/src/boundedMap.ts", "utf8")), { module, exports: module.exports, Map });
    return module.exports;
})();

function engine() {
    const source = ts.createSourceFile("engine.ts", fs.readFileSync("client/e2ee/src/engine.ts", "utf8"), ts.ScriptTarget.Latest, true);
    const engineClass = source.statements.find((node) => ts.isClassDeclaration(node) && node.name.text === "Engine");
    const methods = ["queryKeys", "keysFor"].map((name) => engineClass.members.find((node) => ts.isMethodDeclaration(node) && node.name.getText(source) === name).getText(source));
    const module = { exports: {} };
    vm.runInNewContext(transpile(`class Extracted { ${methods.join("\n")} };module.exports=Extracted;`), {
        module,
        KEY_QUERY_BATCH: 100,
        DIRECTORY_TTL_MS: 5 * 60 * 1000,
        Promise,
        Set,
        Map,
        Date,
    });
    const requests = [];
    const instance = Object.assign(new module.exports(), {
        keyBatch: null,
        directory: new BoundedMap(2000),
        api: {
            request: async (method, url, body) => {
                requests.push(body.user_ids);
                return { users: Object.fromEntries(body.user_ids.map((id) => [id, { identity_key: `key-${id}`, devices: [] }])) };
            },
        },
        verifyEntry: async (userId, keys) => ({ userId, keys, fetchedAt: Date.now() }),
    });
    return { instance, requests };
}

test("the bounded map evicts the least recently used entry", () => {
    const map = new BoundedMap(3);
    map.set("a", 1).set("b", 2).set("c", 3);
    assert.equal(map.get("a"), 1);
    map.set("d", 4);
    assert.deepEqual([...map.keys()], ["c", "a", "d"]);
    assert.equal(map.has("b"), false);
    map.set("c", 30);
    map.set("e", 5);
    assert.deepEqual(
        [...map.entries()],
        [
            ["d", 4],
            ["c", 30],
            ["e", 5],
        ],
    );
    assert.equal(map.get("missing"), undefined);
    assert.equal(map.size, 3);
    assert.ok(map instanceof Map);
});

test("the bounded map stays at its limit after many inserts", () => {
    const map = new BoundedMap(5000);
    for (let i = 0; i < 20000; i++) map.set(`m${i}`, { content: "x".repeat(10) });
    assert.equal(map.size, 5000);
    assert.equal(map.has("m14999"), false);
    assert.equal(map.has("m15000"), true);
});

test("concurrent key lookups for different senders share one request", async () => {
    const { instance, requests } = engine();
    const entries = await Promise.all(["1", "2", "3", "1", "4"].map((id) => instance.keysFor([id])));
    assert.equal(requests.length, 1);
    assert.deepEqual([...requests[0]].sort(), ["1", "2", "3", "4"]);
    assert.deepEqual(
        entries.map(([entry]) => entry.userId),
        ["1", "2", "3", "1", "4"],
    );
    await instance.keysFor(["2"]);
    assert.equal(requests.length, 1);
});

test("a lookup of more than 100 users is split into batches the server accepts", async () => {
    const { instance, requests } = engine();
    const ids = Array.from({ length: 250 }, (_, i) => String(i + 1));
    const entries = await instance.keysFor(ids);
    assert.equal(entries.length, 250);
    assert.deepEqual(
        requests.map((batch) => batch.length),
        [100, 100, 50],
    );
    assert.deepEqual(
        entries.map((entry) => entry.userId),
        ids,
    );
});

test("forced lookups ask the server again", async () => {
    const { instance, requests } = engine();
    await instance.keysFor(["1"]);
    await instance.keysFor(["1"], true);
    assert.equal(requests.length, 2);
});

test("plaintext, key and lookup caches in the encryption client are bounded", () => {
    const engineSource = fs.readFileSync("client/e2ee/src/engine.ts", "utf8");
    for (const field of ["directory", "members", "profiles", "canonical", "resolvedCanonical", "localOf", "plaintext", "contentKeys", "storedKeys"])
        assert.match(engineSource, new RegExp(`private ${field} = new BoundedMap<`), field);
    const hooks = fs.readFileSync("client/e2ee/src/hooks.ts", "utf8");
    for (const field of ["readable", "payloads", "previewed", "soundCache"]) assert.match(hooks, new RegExp(`const ${field} = new BoundedMap<`), field);
    assert.match(hooks, /channel = new BoundedMap\(READABLE_PER_CHANNEL\)/);
    const sw = fs.readFileSync("client/e2ee/src/sw.ts", "utf8");
    for (const field of ["entries", "posters"]) assert.match(sw, new RegExp(`const ${field} = new BoundedMap<`), field);
});
