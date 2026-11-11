const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { StubError, loadModule } = require("./helpers/route-harness.cjs");

function utilStub(checked) {
    return {
        Config: { get: () => ({ security: { requestSignature: "secret" }, cdn: { maxAttachmentSize: 1024 } }) },
        isRequestSignature: (value) => {
            checked.push(value);
            return false;
        },
    };
}

test("internal cdn uploads check the request signature through the constant time compare", () => {
    const checked = [];
    const { requireInternalUploadSignature } = loadModule("src/cdn/util/cloudUploads.ts", {
        "lambert-server/HTTPError": { HTTPError: StubError },
        "@spacebar/database": { CloudAttachment: {} },
        "@spacebar/util": utilStub(checked),
    });
    let passed;
    requireInternalUploadSignature({ headers: { signature: "secret" } }, {}, (error) => {
        passed = error;
    });
    assert.deepEqual(checked, ["secret"]);
    assert.equal(passed?.code, 403);
});

test("buffered internal uploads check the request signature through the constant time compare", () => {
    const checked = [];
    const { internalUpload } = loadModule("src/cdn/util/multer.ts", {
        multer: Object.assign(() => ({ single: () => () => undefined }), { memoryStorage: () => undefined }),
        "lambert-server/HTTPError": { HTTPError: StubError },
        "@spacebar/util": utilStub(checked),
        "./uploadAdmission": {
            bufferedUpload: () => () => assert.fail("the upload ran without a valid signature"),
            internalUploadBufferLimit: 1,
            internalUploadBufferOverhead: 1,
        },
    });
    let passed;
    internalUpload(async () => undefined)({ headers: { signature: "secret" } }, {}, (error) => {
        passed = error;
    });
    assert.deepEqual(checked, ["secret"]);
    assert.equal(passed?.code, 403);
});

test("no cdn code compares the request signature header with a plain equality check", () => {
    for (const file of ["src/cdn/Server.ts", "src/cdn/util/cloudUploads.ts", "src/cdn/util/multer.ts"]) {
        const source = fs.readFileSync(file, "utf8");
        assert.doesNotMatch(source, /headers\.signature\s*[!=]==?/, file);
        assert.doesNotMatch(source, /[!=]==?\s*req\.headers\.signature/, file);
    }
});
