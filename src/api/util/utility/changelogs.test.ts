import assert from "node:assert/strict";
import { test } from "node:test";
import { changelogConfig, normalizeChangelogMarkdown, parseChangelogDate, parseYoutubeVideo, visibleChangelogs } from "./changelogs";

const NOW = new Date("2026-11-12T12:00:00Z");
const entry = (id: string, date: string, published = true, show_on_startup = true) => ({ id, date, published, show_on_startup });

test("the newest published changelog gets the highest version and drafts or future ones stay out", () => {
    const config = changelogConfig(
        [entry("300", "2026-11-01"), entry("100", "2026-11-10"), entry("200", "2026-11-10", true, false), entry("400", "2026-11-11", false), entry("500", "2026-12-01")],
        NOW,
    );
    assert.deepEqual(config, {
        "300": { min_version: 1, show_on_startup: true },
        "100": { min_version: 2, show_on_startup: true },
        "200": { min_version: 3, show_on_startup: false },
    });
    assert.deepEqual(
        visibleChangelogs([entry("1", "2026-11-12")], NOW).map((changelog) => changelog.id),
        ["1"],
    );
});

test("an empty list gives an empty config", () => {
    assert.deepEqual(changelogConfig([], NOW), {});
});

test("dates must be real calendar days", () => {
    assert.equal(parseChangelogDate("2026-11-12"), "2026-11-12");
    assert.equal(parseChangelogDate(""), undefined);
    assert.throws(() => parseChangelogDate("2026-02-30"));
    assert.throws(() => parseChangelogDate("12/11/2026"));
});

test("YouTube links and ids become a video id", () => {
    assert.equal(parseYoutubeVideo("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(parseYoutubeVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"), "dQw4w9WgXcQ");
    assert.equal(parseYoutubeVideo("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(parseYoutubeVideo("https://youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
    assert.equal(parseYoutubeVideo(""), null);
    assert.equal(parseYoutubeVideo(undefined), undefined);
    assert.throws(() => parseYoutubeVideo("https://example.com/watch?v=dQw4w9WgXcQ"));
});

test("headings and lists get the blank lines the client's parser needs", () => {
    const written = [
        "# What's new",
        "",
        "## GIFs are back",
        "The picker loads again.",
        "## Forums",
        "- Settings save",
        "- Replies work",
        "  across lines",
        "Read more below.",
        "1. first",
        "2. second",
    ].join("\n");
    assert.equal(
        normalizeChangelogMarkdown(written),
        [
            "# What's new",
            "",
            "## GIFs are back",
            "",
            "The picker loads again.",
            "",
            "## Forums",
            "",
            "- Settings save",
            "- Replies work",
            "  across lines",
            "",
            "Read more below.",
            "",
            "1. first",
            "2. second",
            "",
            "",
        ].join("\n"),
    );
});

test("paragraphs, quotes and code blocks are left as they are", () => {
    assert.equal(normalizeChangelogMarkdown("One line\nand the next.\n\n> a quote"), "One line\nand the next.\n\n> a quote\n\n");
    assert.equal(normalizeChangelogMarkdown("Before\n```\n## not a heading\n- not a list\n```\nAfter"), "Before\n\n```\n## not a heading\n- not a list\n```\n\nAfter\n\n");
    assert.equal(normalizeChangelogMarkdown("a\r\n\r\n\r\n\r\nb"), "a\n\nb\n\n");
});
