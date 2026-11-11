import { PartialEmoji } from "@spacebar/schemas";
import { DiscordApiErrors } from "@spacebar/util";

const MAX_EMOJI_BYTES = 64;
const emojiSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const emojiCharacters = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Emoji_Modifier}|\u200d|\ufe0e|\ufe0f|\u20e3)+$/u;
const emojiBase = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u20e3/u;

export function isUnicodeEmoji(value: string) {
    if (!value || Buffer.byteLength(value) > MAX_EMOJI_BYTES) return false;
    return emojiCharacters.test(value) && emojiBase.test(value) && [...emojiSegmenter.segment(value)].length === 1;
}

export function parseReactionEmoji(raw: string, strict = false): PartialEmoji {
    let emoji: string;
    try {
        emoji = decodeURIComponent(raw);
    } catch {
        throw DiscordApiErrors.UNKNOWN_EMOJI;
    }
    if (!emoji || emoji.includes("\0") || emoji.length > 256) throw DiscordApiErrors.UNKNOWN_EMOJI;
    if (emoji.includes(":")) {
        const [name, id, ...rest] = emoji.split(":");
        if (rest.length || !/^\d{1,20}$/.test(id ?? "") || name.length > 32) throw DiscordApiErrors.UNKNOWN_EMOJI;
        return { name, id };
    }
    if (strict && !isUnicodeEmoji(emoji)) throw DiscordApiErrors.UNKNOWN_EMOJI;
    return { id: undefined, name: emoji };
}
