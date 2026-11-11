const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load() {
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/routes/channels/#channel_id/call/index.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) =>
                ({
                    express: { Router: () => ({ get() {}, patch() {} }) },
                    "@spacebar/api/middlewares": { route: () => () => {} },
                    "@spacebar/database": { Recipient: {} },
                    "@spacebar/util": {
                        Config: { get: () => ({ limits: { channel: { maxGroupDmRecipients: 25 } } }) },
                        DiscordApiErrors: {},
                        FieldErrors: (fields) => Object.assign(new Error("Invalid Form Body"), { fields }),
                    },
                })[name],
        },
    );
    return module.exports.ringRecipients;
}

test("ring recipients are capped at the group DM size and deduplicated", () => {
    const ringRecipients = load();
    assert.equal(ringRecipients({ body: {} }), null);
    assert.deepEqual([...ringRecipients({ body: { recipients: [1, "1", "2"] } })], ["1", "2"]);
    assert.equal(ringRecipients({ body: { recipients: Array(25).fill("3") } }).length, 1);
    assert.throws(
        () => ringRecipients({ body: { recipients: Array.from({ length: 100000 }, (_, i) => String(i)) } }),
        (error) => error.fields.recipients.code === "BASE_TYPE_BAD_LENGTH",
    );
});

test("both ring routes read recipients through the capped parser", () => {
    for (const file of ["ring.ts", "stop-ringing.ts"]) {
        const source = fs.readFileSync(`src/api/routes/channels/#channel_id/call/${file}`, "utf8");
        assert.match(source, /ringRecipients\(req\)/, file);
        assert.doesNotMatch(source, /recipients\.map\(String\)/, file);
    }
});
