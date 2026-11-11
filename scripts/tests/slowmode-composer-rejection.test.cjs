const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const moduleFixture = { exports: {} };
const source = ts.transpileModule(fs.readFileSync("client/plugins/fosscordSlowmode/index.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
vm.runInNewContext(source, {
    module: moduleFixture,
    exports: moduleFixture.exports,
    require: (name) => (name === "@utils/types" ? { default: (value) => value, __esModule: true } : { FosscordAuthor: {} }),
});
const plugin = moduleFixture.exports.default;
const patch = plugin.patches[1].replacement;
const pattern = new RegExp(patch.match.source.replaceAll("\\i", "[A-Za-z_$][\\w$]*"), patch.match.flags);
const expression = "actions.sendMessage(channel.id,message,undefined,options).catch(error=>{throw(null!=options.scheduledTimestamp||!1===options.eagerDispatch)&&restore(),error})";
const changed = expression.replace(pattern, patch.replace.replaceAll("$self", "plugin"));
assert.notEqual(changed, expression);
const run = new Function("actions", "channel", "message", "options", "restore", "plugin", `return ${changed}`);

test("composer handles only numeric slowmode rejection and keeps draft cleanup", async () => {
    for (const options of [{}, { scheduledTimestamp: 1 }, { eagerDispatch: false }]) {
        let restored = 0;
        const failure = { status: 429, body: { code: 20016 } };
        const action = Promise.reject(failure);
        const result = run({ sendMessage: () => action }, { id: "111" }, { content: "Draft" }, options, () => restored++, plugin);
        assert.equal(await result, undefined);
        assert.equal(restored, options.scheduledTimestamp || options.eagerDispatch === false ? 1 : 0);
        await assert.rejects(action, (error) => error === failure);
    }
});

test("composer preserves unrelated, malformed and scheduled failures", async () => {
    for (const failure of [
        { status: 400, body: { code: 50035 } },
        { status: 403, body: { code: 20016 } },
        { status: 429, body: { code: 50000 } },
        { status: "429", body: { code: 20016 } },
        { status: 429, body: { code: "20016" } },
        { status: 429 },
        null,
        undefined,
        new Error("Synthetic network failure"),
    ]) {
        let restored = 0;
        const result = run({ sendMessage: () => Promise.reject(failure) }, { id: "111" }, {}, { scheduledTimestamp: 1 }, () => restored++, plugin);
        await assert.rejects(result, (error) => error === failure);
        assert.equal(restored, 1);
    }
});

test("successful sends preserve their result without restoring a draft", async () => {
    const sent = { id: "222" };
    let restored = 0;
    assert.equal(await run({ sendMessage: () => Promise.resolve(sent) }, { id: "111" }, {}, {}, () => restored++, plugin), sent);
    assert.equal(restored, 0);
});
