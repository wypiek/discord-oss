export const SAFETY_STANDING_URL = "https://meowcord.invalid/settings/account/account-standing";

export function readableSafetyNotice(content: string): string {
    const match =
        /^\*\*icon_type\*\*\n(default|danger)\n\n\*\*theme\*\*\n(default|danger)\n\n\*\*header\*\*\n([^\n]+)\n\n\*\*body\*\*\n([\s\S]*?)\n\n\*\*timestamp\*\*\n\d{9,12}\n\n\*\*ctas\*\*(?:\n)?([\s\S]*)$/.exec(
            content,
        );
    if (!match) return content;
    const tail = match[5];
    if (
        !/^(?:account_standing|policy_violation_detail|learn_more_link)?(?:\n\n\*\*classification_id\*\*\n\d{1,20})?(?:\n\n\*\*learn_more_link\*\*\nhttps?:\/\/[^\s]+)?$/.test(tail)
    )
        return content;
    let learnMore = "";
    const link = /\*\*learn_more_link\*\*\n([^\s]+)$/.exec(tail)?.[1];
    if (link) {
        try {
            const url = new URL(link);
            if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password)
                learnMore = `\n\n[Learn more](${url.href.replaceAll("(", "%28").replaceAll(")", "%29")})`;
        } catch {
            learnMore = "";
        }
    }
    return `**${match[3]}**\n\n${match[4]}\n\n[Review Account Standing](${SAFETY_STANDING_URL})${learnMore}`;
}
