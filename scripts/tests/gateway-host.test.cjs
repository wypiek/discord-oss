const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync("src/bundle/ClientHtml.ts", "utf8");
const expression = source
    .match(/const gateway = (.+);/)[1]
    .replace(/\\`/g, "`")
    .replace(/\\\$/g, "$");

test("initial browser gateway follows location.host including custom ports and secure origins", () => {
    for (const [protocol, host, expected] of [
        ["http:", "localhost:3290", "ws://localhost:3290"],
        ["http:", "fosscord.localhost:3290", "ws://fosscord.localhost:3290"],
        ["https:", "meowcord.example", "wss://meowcord.example"],
        ["https:", "meowcord.example:8443", "wss://meowcord.example:8443"],
        ["http:", "[::1]:3290", "ws://[::1]:3290"],
    ])
        assert.equal(vm.runInNewContext(`const secure = protocol === "https:"; ${expression}`, { protocol, host }), expected);
    assert.ok(!source.includes("gateway.endpointPublic"), "The web client cannot override its origin with a configured localhost endpoint");
});

test("native reconnect ignores the advertised resume host and follows the same browser origin", () => {
    const module = { exports: {} };
    const context = {
        module,
        exports: module.exports,
        location: { protocol: "https:", host: "meowcord.example:8443" },
        require: (name) => (name === "@utils/types" ? (plugin) => plugin : { FosscordAuthor: {} }),
    };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("client/plugins/fosscordCore/index.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
        }).outputText,
        context,
    );
    const plugin = module.exports.default;
    const replacement = plugin.patches.find((patch) => patch.find === "resume_gateway_url").replacement;
    const match = new RegExp(replacement.match.source.replace(/\\i/g, "[A-Za-z_$][\\w$]*"));
    const patched = "this.setResumeUrl(e.resume_gateway_url)".replace(match, replacement.replace);
    const receiver = {
        setResumeUrl(value) {
            this.value = value;
        },
    };
    vm.runInNewContext(`(function(){${patched}}).call(receiver)`, {
        receiver,
        $self: plugin,
        e: { resume_gateway_url: "ws://localhost:3290" },
    });
    assert.equal(receiver.value, "wss://meowcord.example:8443");
});
