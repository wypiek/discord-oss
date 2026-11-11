const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("scripts/dev/e2ee-test.mjs", "utf8");
const sentinel = "PRIVATE_SENTINEL_FOR_DIAGNOSTIC_TEST";
function diagnosticHarness({ failingEvaluation = false, nativeStoreFailure = false, malformedGateway = false } = {}) {
    const logs = [];
    const context = {
        URL,
        setTimeout,
        clearTimeout,
        dm: { id: "123" },
        console: { error: (...args) => logs.push(args) },
        window: {
            Vencord: nativeStoreFailure
                ? undefined
                : {
                      Webpack: {
                          findStore: (name) =>
                              name === "SelectedChannelStore"
                                  ? { getChannelId: () => "123" }
                                  : {
                                        getMessages: () => ({
                                            toArray: () => [{ content: sentinel }, { content: sentinel }],
                                        }),
                                    },
                      },
                  },
            __fosscordE2ee: {
                status: () => ({
                    ready: true,
                    linked: true,
                    locked: false,
                    trustsServer: true,
                    serverRecoveryReady: true,
                    identity: sentinel,
                    backup: { secret: sentinel },
                    failure: null,
                    states: {
                        [sentinel]: { state: "decrypted", content: sentinel },
                        second: { state: "failed", error: sentinel },
                        third: { state: "pending" },
                    },
                }),
            },
        },
        document: {
            querySelectorAll: () => [{ textContent: sentinel }, { textContent: sentinel }],
            querySelector: () => null,
        },
    };
    vm.createContext(context);
    const start = source.indexOf("const diagnosticErrorCategory =");
    const end = source.indexOf("\nconst phase =", start);
    vm.runInContext(`${source.slice(start, end)};globalThis.diagnoseTest=diagnose`, context);
    return {
        logs,
        invoke: () =>
            context.diagnoseTest({
                user: { name: sentinel },
                sent: [{ content: sentinel, encrypted: { ct: sentinel, key: sentinel } }],
                errors: [`decrypt failed ${sentinel}`, `unknown ${sentinel}`],
                gateway: malformedGateway
                    ? { opened: sentinel, closed: -1, receivedFrames: Infinity, url: sentinel }
                    : { opened: 1, closed: 0, receivedFrames: 7, url: sentinel, token: sentinel },
                network: [
                    { path: `/api/v9/e2ee/devices/${sentinel}`, method: "POST", status: 403 },
                    { path: `/private/${sentinel}`, method: sentinel, status: 401 },
                    { path: `/api/v9/channels/123/messages?token=${sentinel}`, method: "GET", status: 200 },
                ],
                page: {
                    url: () => `http://localhost:3397/channels/@me/123?token=${sentinel}`,
                    evaluate: async (fn, argument) => {
                        if (failingEvaluation) throw new Error(`network ${sentinel}`);
                        return fn(argument);
                    },
                },
            }),
    };
}
test("E2EE diagnostics retain useful counts and HTTP statuses without sensitive values", async () => {
    const h = diagnosticHarness();
    await h.invoke();
    assert.equal(JSON.stringify(h.logs).includes(sentinel), false);
    const output = JSON.parse(h.logs[0][1]);
    assert.equal(output.browser, "fixture");
    assert.equal(output.page, "private-chat");
    assert.equal(output.state.decrypted, 1);
    assert.equal(output.state.failed, 1);
    assert.equal(output.state.otherStates, 1);
    assert.equal(output.state.renderedMessages, 2);
    assert.equal(output.state.nativeSelectedChannel, true);
    assert.equal(output.state.nativeMessageCount, 2);
    assert.equal(output.state.composerPresent, false);
    assert.deepEqual(output.gateway, { opened: 1, closed: 0, receivedFrames: 7 });
    assert.equal(output.sentCount, 1);
    assert.equal(output.encryptedSentCount, 1);
    assert.deepEqual(output.errors, ["decryption", "other"]);
    assert.deepEqual(output.network, [
        { endpoint: "e2ee", method: "POST", status: 403 },
        { endpoint: "other", method: "other", status: 401 },
        { endpoint: "messages", method: "GET", status: 200 },
    ]);
});
test("browser evaluation failures expose only a fixed diagnostic category", async () => {
    const h = diagnosticHarness({ failingEvaluation: true });
    await h.invoke();
    assert.equal(JSON.stringify(h.logs).includes(sentinel), false);
    assert.deepEqual(JSON.parse(h.logs[0][1]).state, { diagnosticFailure: "network" });
});
test("restoration error metadata redacts private error text and preserves the original exception", async () => {
    const logs = [];
    const failure = new Error(sentinel);
    failure.name = "TimeoutError";
    const context = {
        backupRow: () => {
            throw failure;
        },
        console: { error: (...args) => logs.push(args) },
    };
    vm.createContext(context);
    const start = source.indexOf("const restoreFixtureAccess = async () => {");
    const end = source.indexOf("\n};", start) + 3;
    vm.runInContext(`${source.slice(start, end)};globalThis.restore=restoreFixtureAccess`, context);
    await assert.rejects(context.restore(), (error) => error === failure);
    assert.equal(JSON.stringify(logs).includes(sentinel), false);
    assert.deepEqual(JSON.parse(logs[0][1]), {
        step: "inspect-backup",
        error: "TimeoutError",
        category: "timeout",
    });
});

test("missing native stores retain crypto diagnostics and malformed gateway fields stay private", async () => {
    const h = diagnosticHarness({ nativeStoreFailure: true, malformedGateway: true });
    await h.invoke();
    assert.equal(JSON.stringify(h.logs).includes(sentinel), false);
    const output = JSON.parse(h.logs[0][1]);
    assert.equal(output.state.decrypted, 1);
    assert.equal(output.state.nativeSelectedChannel, false);
    assert.equal(output.state.nativeMessageCount, null);
    assert.deepEqual(output.gateway, { opened: 0, closed: 0, receivedFrames: 0 });
});
