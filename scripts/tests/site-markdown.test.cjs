const { test } = require("node:test");
const assert = require("node:assert/strict");
const { renderMarkdown, safeLinkUrl, safeImageUrl, markdownText, slugify, isSlug, uniqueSlug } = require("../../dist/util/util/Markdown.js");

const origins = ["https://chat.example.org/api/v9", "https://cdn.example.org/"];
const render = (source) => renderMarkdown(source, { imageOrigins: origins });

test("raw HTML is shown as text, never passed through", () => {
    const html = render('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<a href="javascript:alert(1)">x</a>');
    assert.ok(!/<script|<img|<a /i.test(html), html);
    assert.match(html, /&#60;script&#62;alert\(1\)&#60;\/script&#62;/);
    assert.match(html, /onerror=&#34;alert\(1\)&#34;/);
});

test("only http(s) and relative links become anchors", () => {
    for (const url of [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "data:text/html,<b>x</b>",
        "vbscript:x",
        "//evil.example",
        "/\\evil.example",
        "file:///etc/passwd",
        "mailto:a@b.c",
        "java\tscript:x",
    ])
        assert.equal(safeLinkUrl(url), null, url);
    for (const url of ["https://example.org/a?b=c#d", "http://example.org", "/support/articles/x", "#heading", "./a", "../b"]) assert.equal(safeLinkUrl(url), url, url);
    const html = render("[bad](javascript:alert(1)) [good](https://example.org) [local](/blog)");
    assert.ok(!html.includes("javascript"), html);
    assert.match(html, /<a href="https:\/\/example.org" rel="nofollow noopener noreferrer">good<\/a>/);
    assert.match(html, /<a href="\/blog">local<\/a>/);
    assert.match(html, /bad/);
});

test("attribute values can't break out of their quotes", () => {
    const html = render('[x](https://example.org/"onmouseover="alert(1)) ![y](/site-images/a.png"onerror="alert(1))');
    assert.ok(!/<a [^>]*onmouseover|<img [^>]*onerror/.test(html), html);
});

test("images load only from the instance", () => {
    assert.equal(safeImageUrl("/site-images/0123456789abcdef0123456789abcdef.png", origins), "/site-images/0123456789abcdef0123456789abcdef.png");
    assert.equal(safeImageUrl("https://cdn.example.org/site-images/a.png", origins), "https://cdn.example.org/site-images/a.png");
    assert.equal(safeImageUrl("https://chat.example.org/x.png", origins), "https://chat.example.org/x.png");
    for (const url of [
        "https://tracker.example.com/pixel.gif",
        "//cdn.example.org/a.png",
        "data:image/png;base64,AAAA",
        "javascript:alert(1)",
        "https://cdn.example.org.evil.com/a.png",
    ])
        assert.equal(safeImageUrl(url, origins), null, url);
    const html = render("![tracker](https://tracker.example.com/p.gif) ![ours](https://cdn.example.org/site-images/a.png)");
    assert.ok(!html.includes("tracker.example.com"), html);
    assert.match(html, /tracker/);
    assert.match(html, /<img src="https:\/\/cdn.example.org\/site-images\/a.png" alt="ours" loading="lazy" decoding="async">/);
});

test("common Markdown renders to a small fixed set of tags", () => {
    const html = render(
        "# Title\n\nSome **bold**, *italic*, ~~gone~~ and `code <b>`.\n\n- one\n- two\n  - nested\n\n1. first\n2. second\n\n> quoted\n\n```js\nconst a = '<x>';\n```\n\n---\n\nVisit https://example.org.",
    );
    assert.match(html, /<h2 id="title">Title<\/h2>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<em>italic<\/em>/);
    assert.match(html, /<del>gone<\/del>/);
    assert.match(html, /<code>code &#60;b&#62;<\/code>/);
    assert.match(html, /<ul><li>one<\/li><li>two\n?<ul><li>nested<\/li><\/ul><\/li><\/ul>/);
    assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
    assert.match(html, /<blockquote><p>quoted<\/p><\/blockquote>/);
    assert.match(html, /<pre><code class="language-js">const a = &#39;&#60;x&#62;&#39;;<\/code><\/pre>/);
    assert.match(html, /<hr>/);
    assert.match(html, /<a href="https:\/\/example.org" rel="nofollow noopener noreferrer">https:\/\/example.org<\/a>\./);
    const tags = new Set([...html.matchAll(/<([a-z0-9]+)/g)].map((match) => match[1]));
    for (const tag of tags) assert.ok(["h2", "p", "strong", "em", "del", "code", "ul", "ol", "li", "blockquote", "pre", "hr", "a"].includes(tag), tag);
});

test("snake_case and lone delimiters stay literal", () => {
    assert.equal(render("use snake_case_names and 2 * 3 * 4"), "<p>use snake_case_names and 2 * 3 * 4</p>");
    assert.equal(render("\\*not italic\\*"), "<p>*not italic*</p>");
});

test("pathological input renders quickly", () => {
    const started = Date.now();
    render(`${"*a ".repeat(30000)}\n\n${"[".repeat(20000)}\n\n${"> ".repeat(500)}x\n\n${"_a ".repeat(30000)}`);
    assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});

test("markdownText strips syntax for excerpts and search", () => {
    assert.equal(markdownText("## Hello\n\nA [link](https://x.org) and **bold** ![img](/a.png)"), "Hello A link and bold img");
});

test("slugs are lowercase ASCII words joined by hyphens", () => {
    assert.equal(slugify("Welcome to Café Ünïcode!"), "welcome-to-cafe-unicode");
    assert.equal(slugify("  --Hello,   World--  "), "hello-world");
    assert.equal(slugify("🎉🎉"), "");
    assert.equal(slugify("a".repeat(200)).length, 80);
    assert.ok(!slugify(`${"word ".repeat(30)}`).endsWith("-"));
    assert.ok(isSlug("getting-started"));
    for (const bad of ["", "Upper", "a--b", "-a", "a-", "a_b", "../x", "a/b", "a.b", "x".repeat(81)]) assert.ok(!isSlug(bad), bad);
});

test("uniqueSlug falls back and adds a number when taken", async () => {
    const taken = new Set(["welcome", "welcome-2", "post"]);
    const isTaken = async (slug) => taken.has(slug);
    assert.equal(await uniqueSlug("Welcome", "post", isTaken), "welcome-3");
    assert.equal(await uniqueSlug("Fresh title", "post", isTaken), "fresh-title");
    assert.equal(await uniqueSlug("🎉", "post", isTaken), "post-2");
    const long = await uniqueSlug("x".repeat(100), "post", async (slug) => slug === "x".repeat(80));
    assert.equal(long, `${"x".repeat(78)}-2`);
    assert.ok(isSlug(long));
});
