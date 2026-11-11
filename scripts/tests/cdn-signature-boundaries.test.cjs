const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const security = { cdnSignatureKey: "test-key", cdnSignatureDuration: "1h", cdnSignatureIncludeIp: false, cdnSignatureIncludeUserAgent: false };
const imports = {
    "@spacebar/util": { Config: { get: () => ({ security }) } },
    "node:crypto": require("node:crypto"),
    "node:util": require("node:util"),
    ms: require("ms"),
    "./util/ConsoleUtils": { ConsoleUtils: {} },
    "./util/ColorUtils": { ColorUtils: {} },
};
const loaded = { exports: {} };
vm.runInNewContext(
    ts.transpileModule(fs.readFileSync("src/util/Signing.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText,
    {
        module: loaded,
        exports: loaded.exports,
        Buffer,
        Date,
        URL,
        TextEncoder,
        Int8Array,
        process: { env: {} },
        console,
        require: (name) => {
            assert.ok(name in imports, `missing mock for ${name}`);
            return imports[name];
        },
    },
);
const { getUrlSignature, hasValidSignature, UrlSignResult } = loaded.exports;

test("a signed cdn url can't be stretched by moving digits from is into ex", () => {
    const path = "/attachments/1/2/file.png";
    const signed = getUrlSignature({ path });
    const check = (issuedAt, expiresAt) => hasValidSignature({}, new UrlSignResult({ path, issuedAt, expiresAt, hash: signed.hash }));
    assert.equal(check(signed.issuedAt, signed.expiresAt), true);
    assert.equal(check(signed.issuedAt.slice(0, -1), signed.issuedAt.slice(-1) + signed.expiresAt), false);
    assert.equal(check(signed.issuedAt.slice(0, -2), signed.issuedAt.slice(-2) + signed.expiresAt), false);
    const mixed = `${signed.expiresAt.slice(0, -1)}${signed.expiresAt.endsWith("a") ? "B" : "A"}`;
    assert.equal(check(signed.issuedAt, mixed), false);
});
