const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { matchRegexPatternsWithTimeout, REGEX_TIMEOUT_MS } = require("../../dist/api/util/utility/automodRegex.js");

test("automod regexes match in a worker and keep their order", async () => {
    const matches = await matchRegexPatternsWithTimeout("buy CHEAP pills here", ["nothing", "cheap\\s+pills", "(", "here"]);
    assert.deepEqual(matches, [
        { pattern: "cheap\\s+pills", match: "CHEAP pills" },
        { pattern: "here", match: "here" },
    ]);
});

test("a catastrophic automod regex is cut off instead of blocking the event loop", async () => {
    let ticks = 0;
    const interval = setInterval(() => ticks++, 10);
    const started = Date.now();
    const result = await matchRegexPatternsWithTimeout(`${"a".repeat(60)}!`, ["^(a|aa)+$"]);
    clearInterval(interval);
    assert.equal(result, null);
    assert.ok(Date.now() - started < REGEX_TIMEOUT_MS + 5000);
    assert.ok(ticks > 0);
    assert.deepEqual(await matchRegexPatternsWithTimeout("still works", ["works"]), [{ pattern: "works", match: "works" }]);
});

test("automod keyword checks don't compile rule regexes on the main thread", () => {
    const source = fs.readFileSync("src/api/util/utility/automod.ts", "utf8");
    assert.match(source, /matchRegexPatternsWithTimeout\(content, patterns\)/);
    assert.doesNotMatch(source, /new RegExp\(pattern, "iu"\);\s*\} catch \{\s*continue;/);
});
