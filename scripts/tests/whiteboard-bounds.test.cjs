const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load() {
    const routes = {};
    const router = () => ({
        get: (path, ...handlers) => (routes[`get ${path}`] = handlers),
        post: (path, ...handlers) => (routes[`post ${path}`] = handlers),
        use() {},
    });
    const express = Object.assign(() => {}, { json: () => () => {}, static: () => () => {}, Router: router });
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/activities/whiteboard.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
        }).outputText,
        {
            module,
            exports: module.exports,
            setInterval: () => 0,
            clearInterval() {},
            require: (name) =>
                ({
                    "node:path": require("node:path"),
                    express: { __esModule: true, default: express, Router: router },
                    typeorm: { In: (values) => values },
                    "@spacebar/database": {
                        ActivityInstance: { findOne: async () => null },
                        ActivityInstanceParticipant: { exists: async () => true },
                        ActivityInstances: { onChange() {}, participants: async () => [], find: async () => ({ id: "instance" }) },
                        Member: {},
                        User: {},
                    },
                    "@spacebar/util": { Config: { get: () => ({ cdn: { endpointPublic: "" } }) } },
                    "./common": { ACTIVITY_ASSETS: "/tmp", readProxyTicket: () => ({ uid: "user" }) },
                })[name],
        },
    );
    const respond = (locals) => {
        const res = { locals, status: undefined, written: [], sendStatus: (code) => (res.status = code), set() {}, flushHeaders() {}, write: (chunk) => res.written.push(chunk) };
        return res;
    };
    const stroke = (id, points, userId = "user") => {
        const res = respond({ instanceId: "instance", userId, client: "c" });
        routes["post /instances/:instance_id/strokes"].at(-1)({ body: { id, color: "#000000", size: 2, points } }, res);
        return res.status;
    };
    const watch = async (userId) => {
        const res = respond({ instanceId: "instance", userId, client: "c" });
        await routes["get /instances/:instance_id/events"].at(-1)({ on() {} }, res);
        return res.status ?? JSON.parse(res.written[0].split("data: ")[1]);
    };
    return { stroke, watch, api: module.exports };
}

test("a full board refuses new strokes without storing an empty one", async () => {
    const { stroke, watch } = load();
    const batch = Array.from({ length: 1024 }, () => 1);
    let calls = 0;
    while (stroke(`s${Math.floor(calls / 7)}`, batch) === 204) calls++;
    assert.ok(calls >= 390, `${calls} batches fit`);
    let filler = 0;
    while (stroke(`fill${filler}`, [1, 1]) === 204) filler++;
    assert.ok(filler < 512);
    for (let i = 0; i < 1000; i++) assert.equal(stroke(`fresh${i}`, [1, 1]), 413);
    assert.equal(stroke("one-more", [1, 1]), 413);
    const { strokes } = await watch("user");
    assert.equal(strokes.filter((entry) => entry.id.startsWith("fresh") || entry.points.length === 0).length, 0);
});

test("a board holds at most 10,000 strokes", () => {
    const { stroke, api } = load();
    assert.equal(api.MAX_BOARD_STROKES, 10000);
    for (let i = 0; i < 10000; i++) assert.equal(stroke(`s${i}`, [1, 1]), 204);
    assert.equal(stroke("over", [1, 1]), 413);
    assert.equal(stroke("s5", [2, 2]), 204);
});

test("one user can hold at most 4 event streams per board", async () => {
    const { watch, api } = load();
    assert.equal(api.MAX_VIEWERS_PER_USER, 4);
    for (let i = 0; i < 4; i++) assert.equal(typeof (await watch("user")), "object");
    assert.equal(await watch("user"), 429);
    assert.equal(typeof (await watch("someone-else")), "object");
});
