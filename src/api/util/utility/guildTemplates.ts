import { HTTPError } from "lambert-server/HTTPError";
import { Guild, Tag, Template } from "@spacebar/database";
import { Config, DiscordApiErrors } from "@spacebar/util";
import { ChannelType } from "@spacebar/schemas";

// a template code, or a link to one: discord.new/<code>, discord.com/template/<code> or this instance's /template/<code>
export function guildTemplateCode(input: string) {
    let value = input.trim();
    try {
        value = decodeURIComponent(value);
    } catch {
        // keep it as it is
    }
    const link = value.match(/(?:discord\.new|(?:discord(?:app)?\.com|\/)\/?template)\/([\w-]+)/i) ?? value.match(/^(?:https?:\/\/)?discord\.new\/([\w-]+)/i);
    return link ? link[1] : value;
}

// discord's templates, kept briefly so loading the preview and then creating the server is one request to discord
const discordTemplates = new Map<string, { at: number; template: Template }>();
const DISCORD_TEMPLATE_TTL = 10 * 60 * 1000;

async function fetchDiscordTemplate(code: string): Promise<Template> {
    const cached = discordTemplates.get(code);
    const allowRemote = Config.get().externalRequests.discordTemplates;
    if (cached && (!allowRemote || Date.now() - cached.at < DISCORD_TEMPLATE_TTL)) return cached.template;
    if (!allowRemote) throw DiscordApiErrors.UNKNOWN_GUILD_TEMPLATE;

    let response: Response;
    try {
        response = await fetch(`https://discord.com/api/v9/guilds/templates/${encodeURIComponent(code)}`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10000),
            redirect: "error",
        });
    } catch {
        throw new HTTPError("Couldn't reach Discord to load this template. Try again in a bit.", 502);
    }
    if (response.status === 404) throw DiscordApiErrors.UNKNOWN_GUILD_TEMPLATE;
    if (response.status === 429) throw new HTTPError("Discord is rate limiting template lookups. Try again in a minute.", 429);
    if (!response.ok) throw new HTTPError(`Discord couldn't load this template (${response.status}).`, 502);

    const template = (await response.json()) as Template;
    const guild = template.serialized_source_guild;
    if (!guild?.roles || !guild?.channels) throw new HTTPError("Discord sent a template this instance can't read.", 502);

    // discord numbers roles by their position, and the creator's avatar lives on discord's cdn, not this one
    guild.roles.forEach((role) => {
        role.position = role.id as unknown as number;
    });
    guild.channels.forEach((channel) => {
        if (channel.type === ChannelType.GUILD_FORUM || channel.type === ChannelType.GUILD_MEDIA)
            channel.available_tags =
                channel.available_tags?.map((tag) =>
                    Tag.create({
                        name: tag.name,
                        emoji_id: tag.emoji_id,
                        emoji_name: tag.emoji_name,
                        moderated: tag.moderated,
                    }),
                ) ?? [];
    });
    if (template.creator) template.creator = { ...template.creator, avatar: null } as unknown as Template["creator"];
    template.code = code;

    discordTemplates.set(code, { at: Date.now(), template });
    return template;
}

/**
 * Finds a template by code or link: this instance's own first, then (when allowed) discord's, so discord.new links work as they are.
 * `discord:<code>` always asks discord, and `external:<json>` is a raw template when raws are allowed.
 */
export async function resolveGuildTemplate(input: string): Promise<Template> {
    const { allowDiscordTemplates, allowRaws, enabled } = Config.get().templates;
    if (!enabled) throw new HTTPError("Template creation & usage is disabled on this instance.", 403);

    if (input.startsWith("external:")) {
        if (!allowRaws) throw new HTTPError("Importing raws is disabled on this instance.", 403);
        return input.split("external:", 2)[1] as unknown as Template;
    }

    const forceDiscord = input.startsWith("discord:");
    const code = guildTemplateCode(forceDiscord ? input.slice("discord:".length) : input);
    if (!/^[\w-]{1,64}$/.test(code)) throw DiscordApiErrors.UNKNOWN_GUILD_TEMPLATE;

    if (!forceDiscord) {
        const template = await Template.findOne({ where: { code }, relations: { creator: true } });
        if (template) return template;
    }
    if (!allowDiscordTemplates) {
        if (forceDiscord) throw new HTTPError("Discord templates cannot be used on this instance.", 403);
        throw DiscordApiErrors.UNKNOWN_GUILD_TEMPLATE;
    }
    return fetchDiscordTemplate(code);
}

// the server-wide settings a template carries, which Guild.createGuild leaves at the instance defaults
export async function applyTemplateSettings(guildId: string, source: Template["serialized_source_guild"]) {
    const settings: Record<string, string | number> = {};
    const s = source as unknown as Record<string, unknown>;
    for (const key of ["verification_level", "default_message_notifications", "explicit_content_filter", "afk_timeout", "system_channel_flags"])
        if (typeof s[key] === "number") settings[key] = s[key];
    if (typeof s.preferred_locale === "string") settings.preferred_locale = s.preferred_locale;
    if (typeof s.description === "string" && s.description) settings.description = s.description;
    if (Object.keys(settings).length) await Guild.update({ id: guildId }, settings as Parameters<typeof Guild.update>[1]);
}
