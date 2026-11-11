const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const delay = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

function harness({ keyDelay = 0, postDelay = 0, response = { type: 4, data: { content: "hi" } }, status = 200 } = {}) {
    const calls = { posted: [], processed: [], failures: 0, saved: [] };
    const module = { exports: {} };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/api/util/handlers/InteractionDelivery.ts", "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        }).outputText,
        {
            module,
            exports: module.exports,
            require: (name) =>
                ({
                    "@spacebar/schemas": { getAjv: () => ({ getSchema: () => () => true }) },
                    "@spacebar/util": { saveInteraction: async (interaction) => calls.saved.push({ ...interaction }) },
                    "./Application": {
                        ensureInteractionKeys: () => delay(keyDelay, "key"),
                        postSignedInteraction: (url, key, payload, signature, applicationId, limits) => {
                            calls.posted.push(limits);
                            return new Promise((resolve, reject) => {
                                const timer = setTimeout(() => resolve(new Response(JSON.stringify(response), { status })), postDelay);
                                limits.signal.addEventListener("abort", () => {
                                    clearTimeout(timer);
                                    reject(limits.signal.reason);
                                });
                            });
                        },
                    },
                    "./Interaction": {
                        emitInteractionFailure: async () => {
                            calls.failures++;
                        },
                        processInteractionCallback: async (interaction, callback) => {
                            interaction.acknowledged = true;
                            calls.processed.push(callback);
                        },
                    },
                })[name],
            AbortController,
            Response,
            setTimeout,
            clearTimeout,
            Promise,
            Math,
            Date,
            Error,
            console: { error: () => {} },
        },
    );
    return { deliver: module.exports.deliverOverHttp, window: module.exports.INTERACTION_RESPONSE_WINDOW_MS, calls };
}

test("a response inside the window is processed", async () => {
    const { deliver, calls } = harness({ postDelay: 10 });
    const interaction = { acknowledged: false };
    await deliver("app", "https://bot.test/i", interaction, {}, Date.now() + 500);
    assert.equal(calls.processed.length, 1);
    assert.equal(calls.failures, 0);
});

test("the signed request gets only the time left after the key lookup", async () => {
    const { deliver, calls } = harness({ keyDelay: 200, postDelay: 10 });
    await deliver("app", "https://bot.test/i", { acknowledged: false }, {}, Date.now() + 500);
    assert.equal(calls.posted.length, 1);
    assert.ok(calls.posted[0].timeoutMs <= 320, `timeout was ${calls.posted[0].timeoutMs}`);
    assert.ok(calls.posted[0].signal instanceof AbortSignal);
});

test("a slow key lookup can't push the request past the deadline", async () => {
    const { deliver, calls } = harness({ keyDelay: 400 });
    const started = Date.now();
    await deliver("app", "https://bot.test/i", { acknowledged: false }, {}, Date.now() + 100);
    assert.ok(Date.now() - started < 300);
    assert.equal(calls.posted.length, 0);
    assert.equal(calls.processed.length, 0);
    assert.equal(calls.failures, 0);
});

test("a response after the deadline is dropped instead of answering a failed interaction", async () => {
    const { deliver, calls } = harness({ postDelay: 400 });
    const interaction = { acknowledged: false };
    const started = Date.now();
    await deliver("app", "https://bot.test/i", interaction, {}, Date.now() + 100);
    assert.ok(Date.now() - started < 300);
    assert.equal(interaction.acknowledged, false);
    assert.equal(calls.processed.length, 0);
    assert.equal(calls.failures, 0);
});

test("an endpoint error before the deadline reports the failure once", async () => {
    const { deliver, calls } = harness({ status: 500 });
    const interaction = { acknowledged: false };
    await deliver("app", "https://bot.test/i", interaction, {}, Date.now() + 500);
    assert.equal(calls.failures, 1);
    assert.equal(calls.saved.length, 1);
    assert.equal(calls.saved[0].failureSent, true);
    assert.equal(calls.processed.length, 0);
});

test("the request never gets more than the interaction window", async () => {
    const { deliver, window, calls } = harness({ postDelay: 1 });
    await deliver("app", "https://bot.test/i", { acknowledged: false }, {}, Date.now() + 60000);
    assert.equal(window, 3000);
    assert.ok(calls.posted[0].timeoutMs <= window);
});
