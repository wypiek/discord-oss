const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function identifyShard(shard) {
    const source = fs.readFileSync(path.join(__dirname, "../../src/gateway/opcodes/Identify.ts"), "utf8");
    const parsed = ts.createSourceFile("Identify.ts", source, ts.ScriptTarget.ES2022, true);
    let branch;
    const visit = (statement) => {
        if (ts.isIfStatement(statement) && statement.expression.getText(parsed) === "identify.shard") branch = statement.getText(parsed);
        else ts.forEachChild(statement, visit);
    };
    visit(parsed);
    assert.ok(branch, "Execute the actual production shard validation branch");
    const closed = [];
    const socket = { user_id: "synthetic-bot", close: (code) => closed.push(code) };
    const execute = vm.runInNewContext(
        ts.transpileModule(`(function () { ${branch} })`, {
            compilerOptions: { target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            identify: { shard },
            user: { id: socket.user_id },
            CLOSECODES: { Invalid_shard: 4010 },
            console: { log() {} },
        },
    );
    execute.call(socket);
    return { socket, closed };
}

for (const shard of [
    [0n, 1n],
    [0n, 3n],
    [2n, 3n],
]) {
    test(`accept valid bot shard ${shard}`, () => {
        const { socket, closed } = identifyShard(shard);
        assert.deepEqual(closed, []);
        assert.equal(socket.shard_id, shard[0]);
        assert.equal(socket.shard_count, shard[1]);
    });
}

for (const shard of [
    [1n, 1n],
    [3n, 3n],
    [4n, 3n],
    [-1n, 3n],
    [0n, 0n],
    [0n, -1n],
    [undefined, 1n],
    [0n, undefined],
]) {
    test(`reject invalid bot shard ${shard} with gateway close 4010`, () => {
        assert.deepEqual(identifyShard(shard).closed, [4010]);
    });
}

test("preserve clients that omit sharding", () => {
    const { socket, closed } = identifyShard(undefined);
    assert.deepEqual(closed, []);
    assert.equal(socket.shard_id, undefined);
    assert.equal(socket.shard_count, undefined);
});
