const assert = require("node:assert/strict");
const test = require("node:test");
const { mathSafeLineCount } = require("../../client/plugins/fosscordMarkdownMath/preview.ts");

const lines = (text) => text.split("\n");

test("the collapsed preview keeps a display formula whole", () => {
    const file = lines(
        ["Intro", "\\[", "\\boxed{f(x)=\\lim_{n\\to\\infty}", "\\left[\\sum_{k=1}^{n}\\frac{x^k}{k!}", "+\\int_0^x e^{-t^2}dt", "\\right]}", "\\]", "after", "more", "end"].join(
            "\n",
        ),
    );
    assert.equal(mathSafeLineCount(file, 6), 7);
    assert.equal(mathSafeLineCount(lines(["a", "$$", "x^2", "y^2", "z^2", "w^2", "$$", "b"].join("\n")), 6), 7);
});

test("a formula that never closes is left out instead of shown half", () => {
    const file = lines(["one", "two", "$$", ...Array.from({ length: 50 }, (_, index) => `x_${index}`)].join("\n"));
    assert.equal(mathSafeLineCount(file, 6), 2);
});

test("ordinary text, inline math and code keep the usual six lines", () => {
    assert.equal(mathSafeLineCount(lines("1\n2\n3\n4\n5\n6\n7\n8"), 6), 6);
    assert.equal(mathSafeLineCount(lines("$a$\n$$b$$\nc\nd\ne\nf\ng"), 6), 6);
    assert.equal(mathSafeLineCount(lines("```\n$$\n```\nd\ne\nf\ng\nh"), 6), 6);
    assert.equal(mathSafeLineCount(lines("`$$`\nb\nc\nd\ne\nf\ng"), 6), 6);
    assert.equal(mathSafeLineCount(lines("short\nfile"), 6), 6);
    assert.equal(mathSafeLineCount(undefined, 6), 6);
});
