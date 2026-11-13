const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const MarkdownIt = require("markdown-it");
const { dollarmathPlugin } = require("markdown-it-dollarmath");
const { bracketMath, isSafeMathMarkup, renderMath, MAX_FORMULA_LENGTH } = require("../../client/plugins/fosscordMarkdownMath/math.ts");

const ROOT = path.join(__dirname, "..", "..");

const parser = () =>
    new MarkdownIt({ html: false, linkify: false, typographer: false }).use(dollarmathPlugin, { allow_space: false, allow_digits: false, allow_labels: false }).use(bracketMath);

const flatten = (tokens) => tokens.flatMap((token) => [token, ...flatten(token.children ?? [])]);
const mathTokens = (source) =>
    flatten(parser().parse(source, {}))
        .filter((token) => token.type.startsWith("math"))
        .map((token) => [token.type, token.content]);

test("every math delimiter becomes a math token before markdown touches it", () => {
    assert.deepEqual(mathTokens(String.raw`Inline $a_b + c_d$, \(x_1^2\) and $$e^{i\pi}$$ and \[y_*\].`), [
        ["math_inline", "a_b + c_d"],
        ["math_inline", "x_1^2"],
        ["math_inline_double", String.raw`e^{i\pi}`],
        ["math_inline_double", "y_*"],
    ]);
    assert.deepEqual(mathTokens(String.raw`$$\int_0^\infty e^{-x^2}\,dx$$`), [["math_block", String.raw`\int_0^\infty e^{-x^2}\,dx`]]);
    assert.deepEqual(mathTokens("\\[\n\\sum_{n=1}^\\infty \\frac{1}{n^2}\n\\]"), [["math_block", String.raw`\sum_{n=1}^\infty \frac{1}{n^2}`]]);
    assert.deepEqual(mathTokens("Text\n\\[ a_b \\]\nmore"), [["math_block", "a_b"]]);
});

test("escaped, unterminated and code delimiters stay text", () => {
    assert.deepEqual(mathTokens(String.raw`\\(not math\\) and \(open`), []);
    assert.deepEqual(mathTokens("\\[\nunterminated\n\nparagraph"), []);
    assert.deepEqual(mathTokens("`\\(code\\)` and\n```\n\\[fenced\\]\n```"), []);
    assert.deepEqual(mathTokens(String.raw`\( \) and \[ \]`), []);
    assert.deepEqual(mathTokens("costs $5 and $10, $ x $ and $x$5"), []);
});

test("formulas render with KaTeX and fall back on errors", () => {
    const html = renderMath(String.raw`\int_0^\infty e^{-x^2}\,dx`, true);
    assert.match(html, /class="katex-display"/);
    assert.match(html, /<annotation encoding="application\/x-tex">/);
    assert.equal(renderMath(String.raw`\frac{1}{`, false), null);
    assert.equal(renderMath("   ", false), null);
    assert.equal(renderMath("x".repeat(MAX_FORMULA_LENGTH + 1), false), null);
    assert.equal(renderMath(String.raw`\def\a{\a\a}\a`, false), null);
    assert.match(renderMath(String.raw`\rule{100000em}{1em}`, false), /border-right-width:20em;/);
});

test("hostile formulas render inert", () => {
    for (const source of [
        String.raw`\href{javascript:alert(1)}{x}`,
        String.raw`\url{javascript:alert(1)}`,
        String.raw`\includegraphics{https://example.com/x.png}`,
        String.raw`\htmlStyle{background:url(https://example.com)}{x}`,
        String.raw`\htmlData{onclick=alert(1)}{x}`,
        String.raw`\text{<img src=x onerror=alert(1)><script>alert(1)</script>}`,
        String.raw`\color{red;background:url(x)}{y}`,
    ]) {
        const html = renderMath(source, false);
        if (html == null) continue;
        assert.ok(isSafeMathMarkup(html), source);
        assert.doesNotMatch(html, /<(?!\/?(?:span|math|semantics|annotation|mrow|mi|mn|mo|mtext|mstyle)\b)/, source);
        assert.doesNotMatch(html, /<[^>]*\s(?:href|src|on\w+|data-[\w-]+)=/i, source);
        assert.doesNotMatch(html, /<(?:img|script)/i, source);
        assert.doesNotMatch(html, /="[^"]*url\(/, source);
    }
});

test("the markup check rejects anything KaTeX would never emit", () => {
    assert.ok(isSafeMathMarkup('<span class="katex"><span style="height:1em;">x</span></span>'));
    assert.ok(isSafeMathMarkup('<svg xmlns="http://www.w3.org/2000/svg" width="400em" viewBox="0 0 10 10"><path d="M0 0h10"></path></svg>'));
    for (const markup of [
        "<script>alert(1)</script>",
        '<img src="x" onerror="alert(1)">',
        '<span onclick="alert(1)">x</span>',
        '<a href="javascript:alert(1)">x</a>',
        '<span style="background:url(https://example.com/x)">x</span>',
        '<span style="background:u&#114;l(x)">x</span>',
        '<span class="x" style=x>y</span>',
        "<span>a > b</span>",
        "<span",
        '<svg><foreignObject><div onclick="x"></div></foreignObject></svg>',
        "<!-- x --><span></span>",
        '<span title="x">y</span>',
    ]) {
        assert.equal(isSafeMathMarkup(markup), false, markup);
    }
});

test("the KaTeX stylesheet and fonts served by the instance match the bundled KaTeX", () => {
    const served = path.join(ROOT, "assets", "public", "katex");
    const css = fs.readFileSync(path.join(served, "katex.min.css"), "utf8");
    assert.equal(css, fs.readFileSync(require.resolve("katex/dist/katex.min.css"), "utf8"));
    const fonts = [...css.matchAll(/url\((fonts\/[\w-]+\.woff2)\)/g)].map((match) => match[1]);
    assert.ok(fonts.length >= 20);
    for (const font of fonts) assert.ok(fs.existsSync(path.join(served, font)), font);
    assert.match(fs.readFileSync(path.join(served, "LICENSE"), "utf8"), /The MIT License/);
    assert.doesNotMatch(css, /https?:\/\//);
});
