const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { chromiumPath } = require("../util/chromium.cjs");
const source = fs.readFileSync("scripts/dev/e2ee-test.mjs", "utf8");
function restoration(failAt = 0) {
    const opened = [],
        closed = [],
        diagnosed = [],
        logs = [];
    let verifiedHistory = false;
    const failure = new Error("private fixture data must not be logged");
    failure.name = "TimeoutError";
    const context = {
        backupRow: () => ({ mode: "password", version: 1 }),
        tester: { password: "fixture-password" },
        originalPassword: "fixture-password",
        edited: "private fixture history",
        fresh: (name) => `${name}-${opened.length + 1}`,
        launch: async (_, options) => {
            const session = { options };
            opened.push(session);
            return session;
        },
        waitReady: async () => {
            if (opened.length === failAt) throw failure;
        },
        status: async () => ({ linked: true, locked: false }),
        sql: () => "1",
        dm: { id: "fixture" },
        waitDecrypted: async (_, text) => {
            assert.equal(text, "private fixture history");
            verifiedHistory = true;
        },
        close: async (session) => closed.push(session),
        diagnose: async (session) => diagnosed.push(session),
        assert,
        console: { error: (...args) => logs.push(args) },
    };
    vm.createContext(context);
    const start = source.indexOf("const restoreFixtureAccess = async () => {");
    const end = source.indexOf("\n};", start) + 3;
    vm.runInContext(`${source.slice(start, end)};globalThis.restore=restoreFixtureAccess`, context);
    return {
        invoke: context.restore,
        opened,
        closed,
        diagnosed,
        logs,
        failure,
        verified: () => verifiedHistory,
    };
}
test("restoration uses fresh login profiles and keeps the native encrypted-history check", async () => {
    const h = restoration();
    await h.invoke();
    assert.deepEqual(
        h.opened.map((s) => s.options.profile),
        ["fixture-restoration-1", "fixture-password-check-2"],
    );
    assert.equal(h.opened[0].options.strictSafety, true);
    assert.equal(h.verified(), true);
    assert.equal(h.closed.length, 2);
    assert.equal(h.diagnosed.length, 0);
});
for (const failedStage of [1, 2]) {
    test(`restoration stage ${failedStage} diagnoses before closing without logging private errors`, async () => {
        const h = restoration(failedStage);
        await assert.rejects(h.invoke(), (error) => error === h.failure);
        assert.equal(h.diagnosed.length, 1);
        assert.equal(h.diagnosed[0], h.opened[failedStage - 1]);
        assert.equal(h.closed.length, failedStage);
        assert.equal(JSON.stringify(h.logs).includes(h.failure.message), false);
    });
}

test("real stalled browser evaluation fails at the diagnostic deadline", { skip: process.env.E2EE_BROWSER_DEADLINE_TEST !== "1", timeout: 15000 }, async () => {
    const { createRequire } = require("node:module");
    const { homedir } = require("node:os");
    const { chromium } = createRequire(`${homedir()}/.cache/fosscord-tools/package.json`)("playwright-core");
    const context = { setTimeout, clearTimeout };
    vm.createContext(context);
    const start = source.indexOf("const browserDeadline =");
    const end = source.indexOf("\nconst diagnosticEndpoint =", start);
    vm.runInContext(`${source.slice(start, end)};globalThis.deadline=browserDeadline`, context);
    const browser = await chromium.launch({
        executablePath: chromiumPath(),
        headless: true,
        timeout: 10000,
    });
    try {
        const page = await browser.newPage();
        const stalled = page.evaluate(() => new Promise(() => {}));
        const began = Date.now();
        await assert.rejects(context.deadline(stalled, 100), (error) => error.name === "TimeoutError" && error.message === "Browser operation timed out");
        assert.ok(Date.now() - began < 2000);
        assert.equal(await page.evaluate(() => 42), 42);
    } finally {
        await browser.close();
    }
});
