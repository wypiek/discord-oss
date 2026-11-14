const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.join(__dirname, "..", "..");
const { assertMaxLength, assertMaxLengths, GIF_QUERY_LIMITS } = require(path.join(root, "dist/api/util/utility/inputCaps.js"));
const { cleanAttachmentFilename, declaredAttachmentFilename, MAX_ATTACHMENT_FILENAME } = require(path.join(root, "dist/util/util/AttachmentFilename.js"));

const fieldErrors = (thrown) => thrown.errors ?? thrown.body?.errors ?? thrown;

function loadStaffAudit() {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(path.join(root, "src/api/util/utility/staffAudit.ts"), "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            require(name) {
                if (name === "@spacebar/database") return { AuditLog: class {} };
                if (name === "@spacebar/schemas") return { AuditLogEvents: new Proxy({}, { get: () => 0 }) };
                if (name === "./adminTargets") return { assertCanActOnUser() {} };
                if (name === "@spacebar/util/util/IpHash") return require("./helpers/ip-hash.cjs");
                if (name === "@spacebar/util") return { SNOWFLAKE: /^\d{1,20}$/ };
                return {};
            },
        },
    );
    return module.exports;
}

test("assertMaxLength accepts values at the limit and rejects longer ones", () => {
    assert.doesNotThrow(() => assertMaxLength("q", "x".repeat(200), 200));
    assert.doesNotThrow(() => assertMaxLength("q", undefined, 200));
    const thrown = (() => {
        try {
            assertMaxLength("q", "x".repeat(201), 200);
        } catch (error) {
            return error;
        }
    })();
    assert.ok(thrown);
    assert.match(JSON.stringify(fieldErrors(thrown)), /BASE_TYPE_BAD_LENGTH/);
});

test("assertMaxLength rejects a repeated query parameter", () => {
    assert.throws(() => assertMaxLength("q", ["a", "b"], 200));
    assert.doesNotThrow(() => assertMaxLength("q", ["a", "b"], 200, 2));
    assert.throws(() => assertMaxLength("q", ["a", "x".repeat(201)], 200, 2));
});

test("assertMaxLengths checks every listed query field", () => {
    assert.doesNotThrow(() => assertMaxLengths({ q: "cats", locale: "en-US" }, GIF_QUERY_LIMITS));
    assert.doesNotThrow(() => assertMaxLengths(undefined, GIF_QUERY_LIMITS));
    assert.throws(() => assertMaxLengths({ q: "x".repeat(GIF_QUERY_LIMITS.q + 1) }, GIF_QUERY_LIMITS));
    assert.throws(() => assertMaxLengths({ locale: "x".repeat(GIF_QUERY_LIMITS.locale + 1) }, GIF_QUERY_LIMITS));
    assert.doesNotThrow(() => assertMaxLengths({ unrelated: "x".repeat(100000) }, GIF_QUERY_LIMITS));
});

test("cleanAttachmentFilename strips unsafe characters and caps the length", () => {
    assert.equal(cleanAttachmentFilename("my file (1).png"), "my_file_1.png");
    assert.equal(cleanAttachmentFilename("../.."), "....");
    assert.equal(cleanAttachmentFilename(".."), "file");
    assert.equal(cleanAttachmentFilename("日本"), "file");
    const long = cleanAttachmentFilename(`${"a".repeat(400)}.tar.gz`);
    assert.equal(long.length, MAX_ATTACHMENT_FILENAME);
    assert.ok(long.endsWith(".gz"));
});

test("declaredAttachmentFilename only keeps safe names up to 255 characters", () => {
    assert.equal(declaredAttachmentFilename("photo.png"), "photo.png");
    assert.equal(declaredAttachmentFilename("x".repeat(255)), "x".repeat(255));
    assert.equal(declaredAttachmentFilename("x".repeat(256)), undefined);
    assert.equal(declaredAttachmentFilename("a/b.png"), undefined);
    assert.equal(declaredAttachmentFilename("a\\b.png"), undefined);
    assert.equal(declaredAttachmentFilename("a?b.png"), undefined);
    assert.equal(declaredAttachmentFilename("a\nb.png"), undefined);
    assert.equal(declaredAttachmentFilename("a\u007fb.png"), undefined);
    assert.equal(declaredAttachmentFilename(".."), undefined);
    assert.equal(declaredAttachmentFilename(""), undefined);
    assert.equal(declaredAttachmentFilename(42), undefined);
});

test("summarizeBody caps keys and array items but still redacts long secret keys", () => {
    const { summarizeBody } = loadStaffAudit();
    const changes = summarizeBody({ [`${"k".repeat(100)}`]: "v", [`${"x".repeat(70)}password`]: "hunter2", list: ["y".repeat(500), 1] });
    assert.equal(changes[0].key.length, 64);
    assert.equal(changes[1].key.length, 64);
    assert.equal(changes[1].new_value, "[redacted]");
    assert.equal(changes[2].new_value[0].length, 201);
    assert.equal(changes[2].new_value[1], 1);
});
