const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const source = ts.createSourceFile("Server.ts", fs.readFileSync("src/bundle/Server.ts", "utf8"), ts.ScriptTarget.Latest, true);
const registration = source.statements.find(
    (node) =>
        ts.isExpressionStatement(node) &&
        ts.isCallExpression(node.expression) &&
        node.expression.expression.getText(source) === "ProcessLifecycle.eventEmitter.on" &&
        node.expression.arguments[0]?.text === "stopping",
);
const callback = registration.expression.arguments[1].getText(source);

function stop(listener, sessions = []) {
    const component = { stop: async () => {} };
    const context = {
        gateway: component,
        cdn: component,
        api: component,
        webrtc: component,
        server: { close() {} },
        secureServer: listener,
        secureSessions: new Set(sessions),
    };
    const code = ts.transpileModule(`export const stop = ${callback};`, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    vm.runInNewContext(code, { ...context, module, exports: module.exports });
    return module.exports.stop();
}

test("bundle shutdown closes HTTP2 sessions and waits for the separate HTTPS listener", async () => {
    let closed = 0;
    let finish;
    let done = false;
    const stopping = stop(
        {
            listening: true,
            close: (callback) => {
                finish = callback;
            },
        },
        [{ close: () => closed++ }],
    ).then(() => {
        done = true;
    });
    await new Promise(setImmediate);
    assert.equal(closed, 1);
    assert.equal(done, false);
    finish();
    await stopping;
    assert.equal(done, true);
});

test("shared-port TLS closes HTTP2 sessions without closing an unbound secure listener", async () => {
    let closed = 0;
    await stop(
        {
            listening: false,
            close: () => {
                throw Error("unbound listener must not close");
            },
        },
        [{ close: () => closed++ }],
    );
    assert.equal(closed, 1);
    await stop(undefined);
});

test("HTTPS listener close failures reject lifecycle shutdown", async () => {
    await assert.rejects(stop({ listening: true, close: (callback) => callback(Error("synthetic close failure")) }), /synthetic close failure/);
});
