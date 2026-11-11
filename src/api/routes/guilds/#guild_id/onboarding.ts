import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Guild, Member, Role } from "@spacebar/database";
import { GuildOnboarding } from "@spacebar/schemas";
import { DiscordApiErrors } from "@spacebar/util";
import { In } from "typeorm";
import { onboardingCaps } from "@spacebar/api/util/utility/fieldCaps";
import { assertRoleEditable, getRoleAuthority } from "@spacebar/api/util/utility/roleAuthorization";

const router = Router({ mergeParams: true });

const defaults = (guild_id: string, onboarding?: Partial<GuildOnboarding> | null): GuildOnboarding => ({
    guild_id,
    prompts: onboarding?.prompts ?? [],
    default_channel_ids: onboarding?.default_channel_ids ?? [],
    enabled: onboarding?.enabled ?? false,
    mode: onboarding?.mode ?? 0,
    below_requirements: false,
});

router.get("/", route({}), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    const [guild, member] = await Promise.all([
        Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, onboarding: true } }),
        Member.findOne({
            where: { id: req.user_id, guild_id },
            select: { id: true, onboarding_responses: true },
        }),
    ]);
    res.json({
        ...defaults(guild_id, guild.onboarding),
        responses: member?.onboarding_responses?.onboarding_responses ?? [],
        onboarding_prompts_seen: member?.onboarding_responses?.onboarding_prompts_seen ?? {},
        onboarding_responses_seen: member?.onboarding_responses?.onboarding_responses_seen ?? {},
    });
});

router.put("/", route({ permission: "MANAGE_GUILD" }), async (req: Request, res: Response) => {
    const { guild_id } = req.params as { [key: string]: string };
    onboardingCaps(req.body);
    const guild = await Guild.findOneOrFail({ where: { id: guild_id } });
    const body = req.body as Partial<GuildOnboarding>;
    const onboarding = defaults(guild_id, { ...defaults(guild_id, guild.onboarding), ...body });
    onboarding.prompts = onboarding.prompts.map((prompt) => ({
        ...prompt,
        options: prompt.options.map((option) => ({
            ...option,
            emoji: option.emoji ?? (option.emoji_id || option.emoji_name ? { id: option.emoji_id, name: option.emoji_name, animated: option.emoji_animated } : null),
        })),
    }));
    const grantedRoles = (value?: Partial<GuildOnboarding> | null) =>
        new Set((value?.prompts ?? []).flatMap((prompt) => prompt.options ?? []).flatMap((option) => option.role_ids ?? []));
    const granted = grantedRoles(onboarding);
    const changedRoles = [...grantedRoles(guild.onboarding).symmetricDifference(granted)];
    if (changedRoles.length) {
        const authority = await getRoleAuthority(req.user_id, guild_id);
        const roles = await Role.find({ where: { id: In(changedRoles), guild_id } });
        if (changedRoles.some((id) => granted.has(id) && !roles.some((role) => role.id === id))) throw DiscordApiErrors.UNKNOWN_ROLE;
        for (const role of roles) assertRoleEditable(authority, role);
    }
    guild.onboarding = onboarding;

    const features = new Set(guild.features);
    if (onboarding.enabled) features.add("GUILD_ONBOARDING").add("GUILD_ONBOARDING_EVER_ENABLED");
    else features.delete("GUILD_ONBOARDING");
    if (onboarding.prompts.length) features.add("GUILD_ONBOARDING_HAS_PROMPTS");
    else features.delete("GUILD_ONBOARDING_HAS_PROMPTS");
    const featuresChanged = features.size !== guild.features.length || [...features].some((f) => !guild.features.includes(f));
    guild.features = [...features];
    await guild.save();

    if (featuresChanged) await Guild.emitUpdate(guild_id);

    res.json(onboarding);
});

export default router;
