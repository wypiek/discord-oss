const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function harness() {
    const source = fs.readFileSync("client/plugins/fosscordCap/index.tsx", "utf8");
    const guard = source.slice(source.indexOf("let current:"), source.indexOf("let widgetLoader:"));
    const { registerAccount: register, setCurrent } = vm.runInNewContext(
        ts.transpileModule(`${guard}\n({ registerAccount, setCurrent(value) { current = value; } });`, {
            compilerOptions: { target: ts.ScriptTarget.ES2022 },
        }).outputText,
    );
    const calls = [];
    const api = {
        post(options) {
            assert.equal(this, api);
            let resolve;
            let reject;
            const request = new Promise((yes, no) => {
                resolve = yes;
                reject = no;
            });
            calls.push({ options, resolve, reject, request });
            return request;
        },
    };
    return { register: (options) => register(api, options), calls, raw: register, setCurrent };
}

test("concurrent signup submissions share one request without changing its body", async () => {
    const h = harness();
    const body = { username: "first", captcha_key: "owned-proof" };
    const options = { body };
    const first = h.register(options);
    const second = h.register({ body: { username: "second", captcha_key: "other-proof" } });
    assert.equal(first, second);
    assert.equal(h.calls.length, 1);
    assert.notEqual(h.calls[0].options, options);
    assert.equal(h.calls[0].options.retries, 0);
    assert.equal(options.retries, undefined);
    assert.equal(h.calls[0].options.body, body);
    const response = { status: 200, body: { token: "synthetic-account-token" } };
    h.calls[0].resolve(response);
    assert.equal(await first, response);
    assert.equal(await second, response);
    const next = h.register({ body: { username: "next" } });
    assert.equal(h.calls.length, 2);
    h.calls[1].resolve(response);
    assert.equal(await next, response);
});

test("correctable signup responses release the request without replacing its result", async () => {
    const h = harness();
    const response = { status: 400, body: { errors: { username: "unavailable" } } };
    const first = h.register({ body: { captcha_key: "owned-proof" } });
    h.calls[0].resolve(response);
    assert.equal(await first, response);
    const retry = h.register({ body: { captcha_key: "owned-proof", username: "corrected" } });
    assert.equal(h.calls.length, 2);
    h.calls[1].resolve({ status: 200, body: { token: "synthetic-account-token" } });
    await retry;
});

test("disconnected signup requests release admission and preserve their rejection", async () => {
    const h = harness();
    const failure = new Error("owned disconnect");
    const first = h.register({ body: {} });
    const second = h.register({ body: {} });
    h.calls[0].reject(failure);
    await assert.rejects(first, (error) => error === failure);
    await assert.rejects(second, (error) => error === failure);
    const retry = h.register({ body: {} });
    assert.equal(h.calls.length, 2);
    h.calls[1].resolve({ status: 200, body: { token: "synthetic-account-token" } });
    await retry;
});

test("synchronous request failures do not reserve signup admission", async () => {
    const h = harness();
    const failure = new Error("owned synchronous failure");
    assert.throws(
        () =>
            h.raw(
                {
                    post() {
                        throw failure;
                    },
                },
                { body: {} },
            ),
        (error) => error === failure,
    );
    const next = h.register({ body: {} });
    assert.equal(h.calls.length, 1);
    h.calls[0].resolve({ status: 200, body: { token: "synthetic-account-token" } });
    await next;
});

test("unknown signup outcomes notify the active form once and retain the original failure as its cause", async () => {
    for (const status of [undefined, null, 0, 200, 201, 299, 500, 503, 599]) {
        const h = harness();
        let interrupted = 0;
        h.setCurrent({
            registrationInterrupted() {
                interrupted++;
            },
        });
        const failure = Object.assign(new Error("owned interrupted request"), { status });
        const first = h.register({ body: {} });
        const second = h.register({ body: {} });
        h.calls[0].reject(failure);
        await assert.rejects(first, (error) => error.cause === failure && error.status === 0 && error.body?.message.includes("recovery options"));
        await assert.rejects(second, (error) => error.cause === failure);
        assert.equal(interrupted, 1);
        const retry = h.register({ body: {} });
        assert.equal(h.calls.length, 2);
        h.calls[1].resolve({ status: 200, body: { token: "synthetic-account-token" } });
        await retry;
        assert.equal(interrupted, 1);
    }
});

test("definite signup failures preserve verification without an interrupted-outcome notification", async () => {
    for (const failure of [new Error("owned local error"), null, "owned failure", ...[400, 401, 403, 409, 429, 600].map((status) => ({ status }))]) {
        const h = harness();
        let interrupted = 0;
        h.setCurrent({
            registrationInterrupted() {
                interrupted++;
            },
        });
        const pending = h.register({ body: {} });
        h.calls[0].reject(failure);
        await assert.rejects(pending, (error) => error === failure);
        assert.equal(interrupted, 0);
    }
});

test("late signup failures do not update a replaced form controller", async () => {
    const h = harness();
    let previous = 0;
    let current = 0;
    h.setCurrent({
        registrationInterrupted() {
            previous++;
        },
    });
    const pending = h.register({ body: {} });
    h.setCurrent({
        registrationInterrupted() {
            current++;
        },
    });
    h.calls[0].reject({ status: 0 });
    await assert.rejects(pending);
    assert.equal(previous, 0);
    assert.equal(current, 0);
    const retry = h.register({ body: {} });
    h.calls[1].reject({ status: 0 });
    await assert.rejects(retry);
    assert.equal(current, 1);
});

test("incomplete successful signup responses fail closed and permit explicit recovery", async () => {
    for (const body of [undefined, null, {}, { token: null }, { token: 123 }, { token: "" }, { token: "   " }]) {
        const h = harness();
        let interrupted = 0;
        h.setCurrent({
            registrationInterrupted() {
                interrupted++;
            },
        });
        const pending = h.register({ body: {} });
        const duplicate = h.register({ body: {} });
        assert.equal(pending, duplicate);
        h.calls[0].resolve({ status: 200, body });
        await assert.rejects(pending, (error) => error.status === 0);
        assert.equal(interrupted, 1);
        const retry = h.register({ body: {} });
        assert.equal(h.calls.length, 2);
        const response = { status: 200, body: { token: "synthetic-account-token" } };
        h.calls[1].resolve(response);
        assert.equal(await retry, response);
    }
});

test("signup never automatically retries an uncertain one-use proof", async () => {
    const h = harness();
    const body = { captcha_key: "owned-one-use-proof" };
    const options = { body, retries: 5 };
    const pending = h.register(options);
    assert.equal(h.calls[0].options.retries, 0);
    assert.equal(h.calls[0].options.body, body);
    assert.equal(options.retries, 5);
    h.calls[0].reject({ status: 0 });
    await assert.rejects(pending);
    assert.equal(h.calls.length, 1);
});

test("signup rate limits preserve the response and permit an explicit retry without replaying automatically", async () => {
    const h = harness();
    let delay;
    h.setCurrent({
        registrationRateLimited(seconds) {
            delay = seconds;
        },
    });
    const response = { status: 429, body: { retry_after: 2.5 } };
    const request = h.register({ body: { username: "retained-draft" } });
    h.calls[0].reject(response);
    await assert.rejects(request, (error) => error === response);
    assert.equal(delay, 2.5);
    assert.equal(h.calls.length, 1);
    const retry = h.register({ body: { username: "retained-draft" } });
    h.calls[1].resolve({ status: 200, body: { token: "synthetic-account-token" } });
    await retry;
    assert.equal(h.calls.length, 2);
});
