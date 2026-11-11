const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe } = require("../client-release.js");

test("release identity binds build metadata and every downloaded asset", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "client-release-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, "a.js"), "original");
    const html = '"BUILD_NUMBER":"1","VERSION_HASH":"abcdef"';
    const original = describe(directory, html, new Set(["a.js"]));
    fs.writeFileSync(path.join(directory, "a.js"), "changed");
    assert.notEqual(describe(directory, html, ["a.js"]).assetsSha256, original.assetsSha256);
    assert.equal(original.assetCount, 1);
    assert.throws(() => describe(directory, html, ["../outside"]), /Invalid client asset/);
    assert.throws(() => describe(directory, "missing identity", []), /identify/);
});

test("server gate rejects corrupted assets and a different upstream bootstrap", (t) => {
    const { spawnSync } = require("node:child_process");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "client-release-gate-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const html = '"BUILD_NUMBER":"1","VERSION_HASH":"abcdef"';
    fs.writeFileSync(path.join(directory, "index.html"), html);
    fs.writeFileSync(path.join(directory, "a.js"), "original");
    fs.writeFileSync(path.join(directory, "release-manifest.json"), JSON.stringify({ assets: ["a.js"] }));
    const pin = path.join(directory, "pin.json");
    fs.writeFileSync(pin, JSON.stringify(describe(directory, html, ["a.js"])));
    const run = () =>
        spawnSync(process.execPath, [path.join(__dirname, "../client-release.js"), "--check"], {
            env: { ...process.env, CLIENT_CACHE_PATH: directory, CLIENT_RELEASE_PATH: pin },
            encoding: "utf8",
        });
    assert.equal(run().status, 0);
    fs.writeFileSync(path.join(directory, "a.js"), "corrupted");
    assert.match(run().stderr, /assetsSha256 differs/);
    fs.writeFileSync(path.join(directory, "a.js"), "original");
    fs.writeFileSync(path.join(directory, "index.html"), `${html}<script>unexpected()</script>`);
    assert.match(run().stderr, /indexSha256 differs/);
    fs.writeFileSync(path.join(directory, "index.html"), html.replace('"1"', '"2"'));
    assert.match(run().stderr, /buildNumber differs/);
});

test("bootstrap identity ignores only discarded challenge scripts and response nonce attributes", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "client-bootstrap-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const base = '<script nonce="first">window.GLOBAL_ENV={"BUILD_NUMBER":"1","VERSION_HASH":"abcdef"}</script>';
    const challenge = '<script nonce="first">window.__CF$cv$params={request:"first"}</script>';
    const first = describe(directory, `${base}${challenge}`, []);
    const second = describe(directory, `${base.replace('nonce="first"', 'nonce="second"')}<script nonce="second">window.__CF$cv$params={request:"second"}</script>`, []);
    assert.equal(first.indexSha256, second.indexSha256);
    assert.notEqual(describe(directory, `${base}<script>unexpected()</script>`, []).indexSha256, first.indexSha256);
    assert.notEqual(describe(directory, base.replace("window.GLOBAL_ENV", "window.replaced"), []).indexSha256, first.indexSha256);
});

test("cached executable route refuses leftover files outside the verified manifest", async () => {
    const vm = require("node:vm");
    const source = fs.readFileSync("src/bundle/TestClient.ts", "utf8");
    const start = source.indexOf("    const manifestPath =");
    const block = source.slice(start, source.indexOf("\n}\n", start)).replaceAll("new Set<string>", "new Set").replaceAll(" as string", "");
    let handler;
    const served = [];
    vm.runInNewContext(block, {
        path,
        CACHE_PATH: "/owned-cache",
        fs: { existsSync: () => true, readFileSync: () => JSON.stringify({ assets: ["reviewed.js"] }) },
        app: {
            get: (route, callback) => {
                handler = callback;
            },
        },
        serveAsset: async (req) => {
            served.push(req.params.file);
        },
    });
    const response = {
        status: null,
        sendStatus(status) {
            this.status = status;
        },
    };
    for (const file of ["leftover.js", "leftover.css", "leftover.wasm"]) {
        handler({ params: { file } }, response, () => {});
        assert.equal(response.status, 404);
    }
    handler({ params: { file: "reviewed.js" } }, response, () => {});
    assert.deepEqual(served, ["reviewed.js"]);
});
