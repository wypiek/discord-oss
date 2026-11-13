import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeConnectionsOrigin, resolveConnectionOrigin } from "./ConnectionOrigin";

test("the admin override wins over every other address", () => {
    assert.deepEqual(
        resolveConnectionOrigin(
            { frontPage: "https://github.com/someone/project" },
            { connectionsOrigin: "https://chat.example.com", endpointPublic: "https://api.example.com/api/v9" },
        ),
        {
            origin: "https://chat.example.com",
            source: "connectionsOrigin",
        },
    );
});

test("the public api endpoint is used before the homepage link", () => {
    assert.deepEqual(resolveConnectionOrigin({ frontPage: "https://github.com/someone/project" }, { endpointPublic: "https://chat.example.com/api/v9" }), {
        origin: "https://chat.example.com",
        source: "apiEndpoint",
    });
});

test("a bare server name becomes an https origin", () => {
    assert.deepEqual(resolveConnectionOrigin({ serverName: "chat.example.com" }, { endpointPublic: null }), { origin: "https://chat.example.com", source: "serverName" });
});

test("no usable address gives an empty origin", () => {
    assert.deepEqual(resolveConnectionOrigin({ serverName: null, frontPage: "not a url" }, { endpointPublic: "/api/v9" }), { origin: "", source: null });
});

test("the override accepts a host or an origin and nothing more", () => {
    assert.equal(normalizeConnectionsOrigin("chat.example.com"), "https://chat.example.com");
    assert.equal(normalizeConnectionsOrigin("https://chat.example.com/"), "https://chat.example.com");
    assert.equal(normalizeConnectionsOrigin("http://localhost:3001"), "http://localhost:3001");
    assert.equal(normalizeConnectionsOrigin(""), null);
    assert.equal(normalizeConnectionsOrigin(null), null);
    assert.equal(normalizeConnectionsOrigin("https://chat.example.com/app"), undefined);
    assert.equal(normalizeConnectionsOrigin("https://user:pass@chat.example.com"), undefined);
    assert.equal(normalizeConnectionsOrigin("chat example.com"), undefined);
    assert.equal(normalizeConnectionsOrigin(42), undefined);
});
