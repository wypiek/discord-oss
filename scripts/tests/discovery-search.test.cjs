const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
    compareDiscovery,
    discoveryCategoryIds,
    discoveryKeywords,
    discoveryPrefixRange,
    discoveryQuery,
    discoveryTerms,
    discoveryWords,
    isLocallyDiscoverable,
    sameDiscoveryTerms,
} = require("../../src/util/util/DiscoverySearch.ts");

const now = Date.parse("2026-10-13T12:00:00.000Z");
const day = 86_400_000;

test("words are lowercased, split on punctuation and lose their accents", () => {
    assert.deepEqual(discoveryWords("Café-Racers & CATS_2"), ["cafe", "racers", "cats", "2"]);
    assert.deepEqual(discoveryWords("Ünïcödé  Пушкин 東京"), ["unicode", "пушкин", "東京"]);
    assert.deepEqual(discoveryWords(null), []);
    assert.equal(discoveryWords("a".repeat(80))[0].length, 32);
});

test("keywords are trimmed, deduplicated without case and capped at 10 of 30 characters", () => {
    assert.deepEqual(discoveryKeywords([" Synth  wave ", "synth wave", "", 3, "x".repeat(40)]), ["Synth wave", "x".repeat(30)]);
    assert.equal(discoveryKeywords(Array.from({ length: 20 }, (_, index) => `k${index}`)).length, 10);
    assert.deepEqual(discoveryKeywords("not a list"), []);
});

test("category ids keep whole numbers in range and at most 5", () => {
    assert.deepEqual(discoveryCategoryIds(["2", 2, -1, 1.5, "x", 40000, 3, 4, 5, 6, 7]), [2, 3, 4, 5, 6]);
    assert.deepEqual(discoveryCategoryIds("6"), [6]);
});

test("terms weigh the name above keywords above the description, plus the exact name and categories", () => {
    const terms = discoveryTerms({ name: "Night Owls", description: "owls and synth music", keywords: ["Synth"], category_ids: [2, 6] });
    const weight = Object.fromEntries(terms.map((row) => [row.term, row.weight]));
    assert.equal(weight["=night owls"], 4);
    assert.equal(weight.owls, 3);
    assert.equal(weight.synth, 2);
    assert.equal(weight.music, 1);
    assert.equal(weight["#2"], 0);
    assert.equal(weight["#6"], 0);
    assert.ok(sameDiscoveryTerms(terms, [...terms].reverse()));
    assert.ok(!sameDiscoveryTerms(terms, terms.slice(1)));
});

test("terms stay bounded for long descriptions", () => {
    const description = Array.from({ length: 2000 }, (_, index) => `word${index}`).join(" ");
    const terms = discoveryTerms({ name: "Big", description, category_ids: [1] });
    assert.ok(terms.length <= 120);
    assert.ok(terms.some((row) => row.term === "#1"));
    assert.ok(terms.some((row) => row.term === "big"));
});

test("queries keep 6 distinct words and the exact form of the whole text", () => {
    assert.deepEqual(discoveryQuery("  Night   OWLS night "), { words: ["night", "owls"], exact: "=night owls night" });
    assert.equal(discoveryQuery("a b c d e f g h").words.length, 6);
    assert.deepEqual(discoveryQuery("!!!"), { words: [], exact: null });
});

test("prefix ranges cover every term that starts with the word and nothing else", () => {
    const [from, to] = discoveryPrefixRange("lan");
    for (const term of ["lan", "lantern", "lanz"]) assert.ok(term >= from && term < to, term);
    for (const term of ["lam", "lao", "la", "#1", "=lan"]) assert.ok(!(term >= from && term < to), term);
});

test("ranking puts the exact name first, then admin weight, recent activity, members and the latest activity", () => {
    const rows = [
        { id: "1", exact: false, member_count: 900, active_at: now - 90 * day },
        { id: "2", exact: false, member_count: 40, active_at: now - day },
        { id: "3", exact: true, member_count: 2, active_at: null },
        { id: "4", exact: false, member_count: 40, active_at: now - 2 * day },
        { id: "5", exact: false, weight: 5, member_count: 1, active_at: null },
        { id: "6", exact: false, member_count: 40, active_at: now - day },
    ];
    assert.deepEqual(
        rows.sort(compareDiscovery(now)).map((row) => row.id),
        ["3", "5", "2", "6", "4", "1"],
    );
});

test("local discovery lists only published servers that admins didn't exclude", () => {
    assert.ok(isLocallyDiscoverable({ features: ["DISCOVERABLE"] }, false));
    assert.ok(!isLocallyDiscoverable({ features: [] }, false));
    assert.ok(isLocallyDiscoverable({ features: [] }, true));
    assert.ok(!isLocallyDiscoverable({ features: ["DISCOVERABLE"], discovery_excluded: true }, true));
});
