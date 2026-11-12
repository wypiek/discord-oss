import { HTTPError } from "lambert-server/HTTPError";
import { In } from "typeorm";
import { Emoji } from "@spacebar/database";
import { TypingIndicatorEmoji, TypingIndicatorStyle, TypingIndicatorStyleInput } from "@spacebar/schemas";

export const TYPING_ANIMATIONS = 3;
export const TYPING_SUGGESTIONS = 7;
export const TYPING_CUSTOM_TEXT_MAX = 32;
export const TYPING_EMOJI_SLOTS = 3;

const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
const CONTROL = /[\p{Cc}\p{Cf}]/gu;
const CONTROL_CHAR = /[\p{Cc}\p{Cf}]/u;
const KEEP_IN_EMOJI = /[‍️⃣]/;

export const cleanTypingText = (value: string | null | undefined) => {
    if (value == null) return null;
    const text = [...value.replace(/\s+/g, " ").replace(CONTROL, "").trim()].slice(0, TYPING_CUSTOM_TEXT_MAX).join("").trim();
    return text || null;
};

export const cleanUnicodeEmoji = (value: string) => {
    const emoji = [...value.trim()].filter((char) => KEEP_IN_EMOJI.test(char) || !CONTROL_CHAR.test(char)).join("");
    if (!emoji || [...emoji].length > 16 || !PICTOGRAPHIC.test(emoji) || /\s|[\p{L}\p{N}]{2,}/u.test(emoji)) throw new HTTPError("Pick emojis for the typing indicator", 400);
    return emoji;
};

export const isEmptyTypingStyle = (style: TypingIndicatorStyle) => !style.emojis.length && !style.animation && !style.typing_suggestion && !style.custom_text;

export async function normalizeTypingIndicatorStyle(
    input: TypingIndicatorStyleInput | null,
    findEmojis: (ids: string[]) => Promise<{ id: string; animated: boolean }[]> = (ids) => Emoji.find({ where: { id: In(ids) }, select: { id: true, animated: true } }),
): Promise<TypingIndicatorStyle | null> {
    if (input == null) return null;
    const requested = (input.emojis ?? []).slice(0, TYPING_EMOJI_SLOTS);
    const customIds = requested.map((emoji) => emoji.custom_emoji_id).filter((id): id is string => !!id);
    const known = new Map((customIds.length ? await findEmojis(customIds) : []).map((emoji) => [emoji.id, emoji]));
    const emojis: TypingIndicatorEmoji[] = requested.map((emoji) => {
        if (emoji.custom_emoji_id) {
            const found = known.get(emoji.custom_emoji_id);
            if (!found) throw new HTTPError("That custom emoji doesn't exist", 400);
            return { custom_emoji_id: found.id, animated: !!found.animated };
        }
        if (emoji.unicode_emoji) return { unicode_emoji: cleanUnicodeEmoji(emoji.unicode_emoji) };
        throw new HTTPError("Pick emojis for the typing indicator", 400);
    });
    const style: TypingIndicatorStyle = {
        emojis,
        animation: Math.min(Math.max(input.animation ?? 0, 0), TYPING_ANIMATIONS),
        typing_suggestion: Math.min(Math.max(input.typing_suggestion ?? 0, 0), TYPING_SUGGESTIONS),
        custom_text: cleanTypingText(input.custom_text),
    };
    return isEmptyTypingStyle(style) ? null : style;
}
