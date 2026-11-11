const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

module.exports = function eventWorkFixture(lifecycle, errors = []) {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/util/util/ipc/EventWork.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            console: { error: (...args) => errors.push(args) },
            require: (name) => (name === "node:async_hooks" ? require(name) : { ProcessLifecycle: lifecycle }),
        },
    );
    return module.exports;
};
