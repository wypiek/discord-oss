const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const http = require("node:http");
const source = fs.readFileSync("src/api/util/handlers/Message.ts", "utf8");
const ast = ts.createSourceFile("Message.ts", source, ts.ScriptTarget.Latest, true);
const helper = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "convertCloudAttachmentToAttachment").getText(ast);
class HTTPError extends Error {
    constructor(message, code = 400) {
        super(message);
        this.code = code;
    }
}
async function fixture(changes = {}) {
    const row = {
        userId: "101",
        channelId: "201",
        userAttachmentId: "0",
        userFilename: "file.txt",
        uploadFilename: "201/CLOUD_101_disposable/0/file.txt",
        size: 3,
        userFileSize: 3,
        userOriginalContentType: "text/plain",
        ...changes,
    };
    const requests = [],
        queries = [],
        permissions = [];
    const server = http.createServer((req, res) => {
        requests.push({ method: req.method, path: req.url });
        assert.equal(req.headers.signature, "fixture-signature");
        res.setHeader("content-type", "application/json");
        res.end(
            JSON.stringify({
                success: true,
                new_path: `attachments/${new URL(req.url, "http://fixture").searchParams.get("channel_id")}/301/file.txt`,
            }),
        );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const find = async ({ where }) => {
        queries.push(where);
        return Object.entries(where).every(([key, value]) => row[key] === value) ? row : null;
    };
    const module = { exports: {} };
    const context = {
        module,
        exports: module.exports,
        CloudAttachment: {
            findOne: find,
            findOneOrFail: async (options) => {
                const value = await find(options);
                if (!value) throw new HTTPError("Unavailable", 404);
                return value;
            },
        },
        Attachment: { create: (value) => value },
        Config: {
            get: () => ({
                cdn: { endpointPrivate: `http://127.0.0.1:${server.address().port}` },
                security: { requestSignature: "fixture-signature" },
            }),
        },
        HTTPError,
        fetch,
        AbortSignal,
        Permissions: { FLAGS: { VIEW_CHANNEL: 1n, ATTACH_FILES: 2n } },
        getPermission: async (actor, guild, channel) => {
            permissions.push({ actor, guild, channel });
            return { has: (flag) => !fixture.deny?.includes(flag) };
        },
        console: { log: () => {}, error: () => {} },
    };
    vm.runInNewContext(
        ts.transpileModule(`${helper}\nmodule.exports=convertCloudAttachmentToAttachment`, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        context,
    );
    return {
        row,
        requests,
        queries,
        permissions,
        convert: module.exports,
        close: () => new Promise((resolve) => server.close(resolve)),
    };
}
const denied = async (changes, actor = "101", channel = "201") => {
    const f = await fixture(changes);
    try {
        await assert.rejects(f.convert({ uploaded_filename: f.row.uploadFilename }, channel, "301", actor), (error) => [400, 403, 404].includes(error.code));
        assert.equal(f.requests.length, 0);
    } finally {
        await f.close();
    }
};
test("leaked foreign upload filename cannot be cloned by a different sender", async () => denied({}, "102"));
test("an uploader cannot reuse a reservation in another channel", async () => denied({}, "101", "202"));
test("missing or invalid actor cannot turn a bearer path into a private signed clone", async () => {
    for (const actor of [undefined, "", "not-an-id"]) {
        const f = await fixture();
        try {
            await assert.rejects(f.convert({ uploaded_filename: f.row.uploadFilename }, "201", "301", actor), (error) => error.code === 404);
            assert.equal(f.requests.length, 0);
        } finally {
            await f.close();
        }
    }
});
test("unfinished uploads and erased ownership metadata cannot be converted", async () => {
    for (const changes of [{ size: undefined }, { size: null }, { size: -1 }, { size: NaN }, { userId: null }, { channelId: null }]) await denied(changes);
});
test("reservation object slot/name/channel must agree with the referenced path", async () => {
    for (const changes of [
        { userAttachmentId: "1" },
        { userFilename: "other.txt" },
        { uploadFilename: "201/CLOUD_101_disposable/0/../file.txt" },
        { uploadFilename: "201/CLOUD_101_disposable/0/file.txt?channel_id=999" },
    ])
        await denied(changes);
});
test("current destination view/attach permissions are checked again after reservation", async () => {
    for (const flag of [1n, 2n]) {
        fixture.deny = [flag];
        try {
            await denied({});
        } finally {
            fixture.deny = undefined;
        }
    }
});
test("a completed own upload in its reserved channel is copied using the private endpoint", async () => {
    const f = await fixture();
    try {
        const result = await f.convert({ uploaded_filename: f.row.uploadFilename, title: "Example", description: "Fixture" }, "201", "301", "101");
        assert.equal(result.channel_id, "201");
        assert.equal(result.message_id, "301");
        assert.equal(result.filename, "file.txt");
        assert.equal(result.size, 3);
        assert.equal(result.title, "Example");
        assert.equal(result.description, "Fixture");
        assert.equal(f.requests.length, 1);
        assert.equal(f.requests[0].path, `/attachments/201/CLOUD_101_disposable/0/file.txt/clone_to_message/301?channel_id=201&attachment_id=${result.id}`);
        assert.equal(f.permissions[0].actor, "101");
        assert.equal(f.permissions[0].channel, "201");
    } finally {
        await f.close();
    }
});
test("zero-byte completed uploads remain supported", async () => {
    const f = await fixture({ size: 0, userFileSize: 0 });
    try {
        const result = await f.convert({ uploaded_filename: f.row.uploadFilename }, "201", "301", "101");
        assert.equal(result.size, 0);
        assert.equal(f.requests.length, 1);
    } finally {
        await f.close();
    }
});
