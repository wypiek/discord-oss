import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanTypingText, cleanUnicodeEmoji, normalizeTypingIndicatorStyle } from "./typingIndicator";

const emojis = async (ids: string[]) => ids.filter((id) => id === "42").map((id) => ({ id, animated: true }));

test("a full style keeps three emojis, the animation, the preset and the custom text", async () => {
    const style = await normalizeTypingIndicatorStyle(
        { emojis: [{ unicode_emoji: "😈" }, { custom_emoji_id: "42" }, { unicode_emoji: "👩‍💻" }], animation: 2, typing_suggestion: 1, custom_text: "  is   cooking  " },
        emojis,
    );
    assert.deepEqual(style, {
        emojis: [{ unicode_emoji: "😈" }, { custom_emoji_id: "42", animated: true }, { unicode_emoji: "👩‍💻" }],
        animation: 2,
        typing_suggestion: 1,
        custom_text: "is cooking",
    });
});

test("an empty or cleared style is stored as nothing", async () => {
    assert.equal(await normalizeTypingIndicatorStyle(null, emojis), null);
    assert.equal(await normalizeTypingIndicatorStyle({ emojis: [], animation: 0, typing_suggestion: 0, custom_text: "   " }, emojis), null);
});

test("unknown custom emojis and text posing as emojis are refused", async () => {
    await assert.rejects(normalizeTypingIndicatorStyle({ emojis: [{ custom_emoji_id: "7" }] }, emojis));
    await assert.rejects(normalizeTypingIndicatorStyle({ emojis: [{ unicode_emoji: "hello" }] }, emojis));
    await assert.rejects(normalizeTypingIndicatorStyle({ emojis: [{}] }, emojis));
    assert.throws(() => cleanUnicodeEmoji("a😈b c"));
    assert.equal(cleanUnicodeEmoji(" 1️⃣ "), "1️⃣");
    assert.equal(cleanUnicodeEmoji("🇵🇱"), "🇵🇱");
});

test("custom text is trimmed, stripped of control characters and capped at 32 characters", () => {
    assert.equal(cleanTypingText("is\u0000 typing\n\nfast"), "is typing fast");
    assert.equal(cleanTypingText("x".repeat(40)), "x".repeat(32));
    assert.equal(cleanTypingText(""), null);
    assert.equal(cleanTypingText(undefined), null);
});
