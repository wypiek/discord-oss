const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("generated OpenAPI requests remain on the serving instance with valid REST and top-level paths", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meowcord-openapi-instance-"));
    const output = path.join(directory, "openapi.json");
    try {
        const result = spawnSync(process.execPath, [path.join(__dirname, "../openapi.js")], {
            cwd: path.join(__dirname, "../.."),
            env: { ...process.env, OPENAPI_OUTPUT: output },
            stdio: "ignore",
            timeout: 30000,
        });
        assert.equal(result.status, 0, "Run the actual generator against the compiled routes");
        const specification = JSON.parse(fs.readFileSync(output, "utf8"));
        assert.deepEqual(specification.servers, [{ url: "/", description: "Current instance" }]);
        assert.ok(Object.keys(specification.paths).length > 100);
        for (const origin of ["https://chat.example.invalid", "http://localhost:3290"]) {
            const document = `${origin}/_spacebar/api/openapi.json`;
            const server = new URL(specification.servers[0].url, document);
            for (const endpoint of ["/api/auth/login/", "/_spacebar/api/openapi.json/", "/admin/"]) {
                assert.ok(specification.paths[endpoint], `Documented route ${endpoint} exists`);
                const request = new URL(endpoint.slice(1), server);
                assert.equal(request.origin, origin);
                assert.equal(request.pathname, endpoint);
                assert.equal(request.username, "");
                assert.equal(request.password, "");
            }
        }
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
