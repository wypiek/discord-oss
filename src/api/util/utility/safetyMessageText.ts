import { Embed } from "@spacebar/schemas";

export const standingLink = "https://meowcord.invalid/settings/account/account-standing";
const safeLink = (value?: string) => {
    if (!value) return null;
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href.replaceAll("(", "%28").replaceAll(")", "%29") : null;
    } catch {
        return null;
    }
};

export function systemEmbedText(embed: Embed): string[] {
    if (String(embed.type) === "safety_system_notification" || String(embed.type) === "safety_policy_notice") {
        const fields = new Map((embed.fields ?? []).map((field) => [field.name, field.value]));
        const header = fields.get("header") || "A violation was added to your account";
        const body = fields.get("body") || "Review the violation and appeal it if you think the decision was wrong on your Account Standing page.";
        const learnMore = safeLink(fields.get("learn_more_link"));
        return [`**${header}**`, body, `[Review Account Standing](${standingLink})`, ...(learnMore && learnMore !== standingLink ? [`[Learn more](${learnMore})`] : [])];
    }
    return [embed.title ? `**${embed.title}**` : "", embed.description || "", ...(embed.fields ?? []).map((field) => `**${field.name}**\n${field.value}`), embed.url || ""].filter(
        Boolean,
    );
}
