const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
require("../../dist/util");
const { isUnicodeEmoji, parseReactionEmoji } = require("../../dist/api/util/utility/reactionEmoji");

const rejects = (raw) =>
    assert.throws(
        () => parseReactionEmoji(raw, true),
        (error) => error.code === 10014,
        raw.slice(0, 40),
    );

test("common unicode emoji, sequences, flags, keycaps and skin tones are accepted", () => {
    for (const emoji of ["👍", "❤️", "❤", "😂", "🏳️‍🌈", "🏳️‍⚧️", "🇺🇸", "1️⃣", "#️⃣", "👍🏽", "👩🏻‍❤️‍💋‍👨🏼", "🧑‍🧑‍🧒‍🧒", "©️", "™️", "🫠", "🏽"]) {
        assert.ok(isUnicodeEmoji(emoji), emoji);
        assert.deepEqual(parseReactionEmoji(encodeURIComponent(emoji), true), { id: undefined, name: emoji });
    }
});

test("every emoji in the cached Discord client is accepted", { skip: !fs.existsSync(path.join(__dirname, "../../assets/cache")) }, () => {
    const dir = path.join(__dirname, "../../assets/cache");
    const found = new Set();
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".js"))) {
        const source = fs.readFileSync(path.join(dir, file), "utf8");
        if (!source.includes('"surrogates"') && !source.includes("surrogates:")) continue;
        for (const match of source.matchAll(/"?surrogates"?:"((?:[^"\\]|\\.)*)"/g)) found.add(JSON.parse(`"${match[1].replace(/\\x([0-9a-f]{2})/gi, "\\u00$1")}"`));
    }
    found.delete("");
    found.delete("surrogates");
    if (!found.size) return;
    assert.ok(found.size > 3000);
    const refused = [...found].filter((emoji) => !isUnicodeEmoji(emoji));
    assert.deepEqual(refused, [], `${refused.length} of ${found.size} refused`);
});

test("text, oversized keys, several emoji and malformed escapes are refused", () => {
    for (const raw of ["hello_im_not_an_emoji", "a", "1", "#", "😀😀", "😀a", "x".repeat(15000), "%ff%fe%ff", "%E0%A4%A", "%00", "\u00001", "👍\u0000"]) rejects(raw);
    rejects(encodeURIComponent("🏳️‍🌈".repeat(4)));
});

test("custom emoji keys need a numeric id", () => {
    assert.deepEqual(parseReactionEmoji("blob:123456789012345678", true), { name: "blob", id: "123456789012345678" });
    for (const raw of ["blob:abc", "blob:", ":", "a:1:2", `${"n".repeat(40)}:1`]) rejects(raw);
});

test("lenient parsing still reads an existing text reaction so it can be removed", () => {
    assert.deepEqual(parseReactionEmoji("hello_im_not_an_emoji"), { id: undefined, name: "hello_im_not_an_emoji" });
    assert.throws(
        () => parseReactionEmoji("%ff"),
        (error) => error.code === 10014,
    );
});
