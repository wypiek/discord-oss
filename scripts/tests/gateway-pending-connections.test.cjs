const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load() {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/gateway/util/PendingConnections.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        { module, exports: module.exports, Map, WeakMap, require: () => ({}) },
    );
    return module.exports;
}

test("one address can hold only the configured number of sockets that haven't identified", () => {
    const { admitPendingConnection, settlePendingConnection, pendingConnections } = load();
    const sockets = Array.from({ length: 60 }, () => ({}));
    const admitted = sockets.map((socket) => admitPendingConnection(socket, "203.0.113.9", 50));
    assert.equal(admitted.filter(Boolean).length, 50);
    assert.equal(pendingConnections("203.0.113.9"), 50);
    assert.equal(admitPendingConnection({}, "198.51.100.4", 50), true);
    settlePendingConnection(sockets[0]);
    settlePendingConnection(sockets[0]);
    settlePendingConnection(sockets[55]);
    assert.equal(pendingConnections("203.0.113.9"), 49);
    assert.equal(admitPendingConnection({}, "203.0.113.9", 50), true);
    for (const socket of sockets) settlePendingConnection(socket);
    assert.equal(pendingConnections("203.0.113.9"), 1);
});

test("sockets without an address and a limit of 0 are not capped", () => {
    const { admitPendingConnection, pendingConnections } = load();
    for (let i = 0; i < 100; i++) assert.equal(admitPendingConnection({}, undefined, 1), true);
    for (let i = 0; i < 100; i++) assert.equal(admitPendingConnection({}, "203.0.113.9", 0), true);
    assert.equal(pendingConnections("203.0.113.9"), 0);
});

test("the gateway admits a socket before setting it up and settles it on identify, resume and close", () => {
    const connection = fs.readFileSync("src/gateway/events/Connection.ts", "utf8");
    assert.ok(connection.indexOf("admitPendingConnection(") < connection.indexOf("compressors.deflate()"));
    assert.match(connection, /socket\.on\("close", \(\) => \{\n\s+settlePendingConnection\(socket\);/);
    assert.match(fs.readFileSync("src/gateway/opcodes/Identify.ts", "utf8"), /clearTimeout\(this\.readyTimeout\);\n\s+settlePendingConnection\(this\);/);
    assert.match(fs.readFileSync("src/gateway/opcodes/Resume.ts", "utf8"), /clearTimeout\(this\.readyTimeout\);\n\s+settlePendingConnection\(this\);/);
    assert.match(fs.readFileSync("src/util/config/types/subconfigurations/limits/GatewayLimits.ts", "utf8"), /pendingConnectionsPerIp: number = 50;/);
});
