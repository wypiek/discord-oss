const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function harness() {
    const scripts = [];
    const timers = new Map();
    let registered = false;
    let nextTimer = 0;
    const source = fs.readFileSync("client/plugins/fosscordCap/index.tsx", "utf8");
    const loader = source.slice(source.indexOf("let widgetLoader:"), source.indexOf("function SignupVerification"));
    const compiled = ts.transpileModule(
        `${loader}
loadWidget;`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const window = {};
    const load = vm.runInNewContext(compiled, {
        window,
        customElements: { get: () => (registered ? class {} : undefined) },
        document: {
            createElement: () => ({
                removed: false,
                remove() {
                    this.removed = true;
                },
            }),
            head: { append: (script) => scripts.push(script) },
        },
        setTimeout: (callback, duration) => {
            assert.equal(duration, 15000);
            timers.set(++nextTimer, callback);
            return nextTimer;
        },
        clearTimeout: (id) => timers.delete(id),
    });
    return {
        load,
        scripts,
        timers,
        window,
        register: () => {
            registered = true;
        },
    };
}

test("HTTP 200 without widget registration rejects and retry issues another SDK request", async () => {
    const h = harness();
    const first = h.load();
    assert.equal(h.load(), first);
    assert.equal(h.scripts.length, 1);
    h.scripts[0].onload();
    await assert.rejects(first, /Could not load verification/);
    assert.equal(h.scripts[0].removed, true);
    assert.equal(h.timers.size, 0);
    const retry = h.load();
    assert.equal(h.scripts.length, 2);
    h.register();
    h.scripts[1].onload();
    await retry;
    assert.equal(h.timers.size, 0);
});

test("stalled SDK requests expire once, remove their script and permit retry", async () => {
    const h = harness();
    const first = h.load();
    const expired = h.scripts[0];
    [...h.timers.values()][0]();
    await assert.rejects(first, /Could not load verification/);
    assert.equal(expired.removed, true);
    assert.equal(expired.onload, null);
    assert.equal(expired.onerror, null);
    const retry = h.load();
    h.register();
    h.scripts[1].onload();
    await retry;
    assert.equal(h.window.CAP_CUSTOM_WASM_URL, "/api/v9/auth/cap/cap_wasm_bg.wasm");
});

test("network failure releases the shared load and registered widgets avoid more requests", async () => {
    const h = harness();
    const first = h.load();
    h.scripts[0].onerror();
    await assert.rejects(first, /Could not load verification/);
    h.register();
    await h.load();
    assert.equal(h.scripts.length, 1);
    assert.equal(h.timers.size, 0);
});
