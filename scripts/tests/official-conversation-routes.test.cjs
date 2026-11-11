const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
function harness() {
    const routes = {};
    const audits = [];
    let fail;
    const query = {
        innerJoin() {
            return this;
        },
        where() {
            return this;
        },
        andWhere() {
            return this;
        },
        orderBy() {
            return this;
        },
        take() {
            return this;
        },
        async getOne() {
            return { id: "20" };
        },
        async getMany() {
            return [{ id: "30", author_id: "2", timestamp: "2026-10-04", encrypted: true }];
        },
    };
    class HTTPError extends Error {
        constructor(message, status) {
            super(message);
            this.status = status;
        }
    }
    class NotReady extends Error {}
    const imports = {
        express: {
            Router: () => ({
                get: (path, guard, handler) => (routes.get = { guard, handler }),
                post: (path, guard, handler) => (routes.post = { guard, handler }),
            }),
        },
        "@spacebar/api/middlewares": { route: (options) => options },
        "@spacebar/database": {
            User: {
                findOne: async (options) => (options.where.id === "2" ? { id: "2", username: "peer" } : null),
            },
            Channel: { createQueryBuilder: () => query },
            Recipient: {},
            Message: { createQueryBuilder: () => query, exists: async () => false },
            AuditLog: {
                create: (value) => ({
                    async save() {
                        audits.push(value);
                        return {
                            async remove() {
                                audits.pop();
                            },
                        };
                    },
                }),
            },
        },
        "@spacebar/util": {
            Config: { get: () => ({ limits: { message: { maxCharacters: 4000 } } }) },
            Snowflake: { generate: () => "31" },
        },
        "@spacebar/schemas": {
            ChannelType: { DM: 1 },
            AuditLogEvents: { ADMIN_OFFICIAL_MESSAGE_SEND: 2001 },
        },
        "lambert-server/HTTPError": { HTTPError },
        "@spacebar/api/util": {
            getSystemAccount: async () => ({ id: "1", username: "official" }),
            sendSystemDM: async (sender, user, body) => {
                if (fail) throw fail;
                return { id: body.id, channel_id: "20" };
            },
        },
        "@spacebar/api/util/utility/announcements": { serializeOfficial: (user) => user },
        "@spacebar/api/util/utility/officialConversations": {
            decryptOfficialMessages: async (rows) =>
                rows.map(() => ({
                    status: "fulfilled",
                    value: {
                        content: "reply",
                        attachments: [{ filename: "photo.png", size: 15, key: "PRIVATE", iv: "PRIVATE" }],
                    },
                })),
        },
        "@spacebar/api/util/utility/systemEncryption": { SystemRecipientNotReady: NotReady },
    };
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync("src/api/routes/admin/conversations/#user_id/index.ts", "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports, require: (name) => imports[name] });
    const res = {
        headers: {},
        set(key, value) {
            this.headers[key] = value;
            return this;
        },
        status(value) {
            this.statusCode = value;
            return this;
        },
        json(value) {
            this.body = value;
            return this;
        },
    };
    return { routes, audits, res, NotReady, setFailure: (value) => (fail = value) };
}
test("official conversation routes require operator and strip attachment keys", async () => {
    const h = harness();
    for (const route of Object.values(h.routes)) {
        assert.equal(route.guard.right, "OPERATOR");
        assert.equal(route.guard.spacebarOnly, true);
    }
    await h.routes.get.handler({ params: { user_id: "2" }, query: {} }, h.res);
    assert.equal(h.res.headers["Cache-Control"], "no-store");
    assert.equal(h.res.body.messages[0].content, "reply");
    assert.equal(JSON.stringify(h.res.body).includes("PRIVATE"), false);
    await assert.rejects(h.routes.get.handler({ params: { user_id: "2" }, query: { before: ["30"] } }, h.res), (e) => e.status === 400);
    await assert.rejects(h.routes.get.handler({ params: { user_id: "999" }, query: {} }, h.res), (e) => e.status === 404);
});
test("official send validates text and audits actor without plaintext", async () => {
    const h = harness();
    const req = { params: { user_id: "2" }, user_id: "9", body: { content: " hello " } };
    await h.routes.post.handler(req, h.res);
    assert.equal(h.res.statusCode, 201);
    assert.equal(h.audits[0].user_id, "9");
    assert.equal(h.audits[0].target_id, "2");
    assert.equal(JSON.stringify(h.audits).includes("hello"), false);
    for (const content of [" ", "x".repeat(4001), null]) await assert.rejects(h.routes.post.handler({ ...req, body: { content } }, h.res), (e) => e.status === 400);
});
test("unready private chat returns actionable conflict and removes unsent audit", async () => {
    const h = harness();
    h.setFailure(new h.NotReady());
    await assert.rejects(
        h.routes.post.handler({ params: { user_id: "2" }, user_id: "9", body: { content: "hello" } }, h.res),
        (e) => e.status === 409 && e.message.includes("unlock"),
    );
    assert.equal(h.audits.length, 0);
});
