import { route } from "@spacebar/api/middlewares";
import { AuditLog, Guild } from "@spacebar/database";
import { DiscordApiErrors, handleFile } from "@spacebar/util";
import { applyGuildTag, syncTagAdopters, updatedImageHash } from "@spacebar/api/util";
import { Request, Response, Router } from "express";
import { AuditLogEvents, GuildProfileModifySchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            "200": {
                body: "GuildProfileResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const guild = await Guild.findOne({ where: { id: guild_id } });
        if (!guild) throw DiscordApiErrors.UNKNOWN_GUILD;

        res.send((await guild.withPresenceCount()).toGuildProfile());
    },
);

router.patch(
    "/",
    route({
        requestBody: "GuildProfileModifySchema",
        permission: "MANAGE_GUILD",
        responses: {
            "200": {
                body: "GuildProfileResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const body = req.body as GuildProfileModifySchema;
        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });
        const profile = { ...(guild.profile ?? {}) };
        const auditKeys = ["name", "description", "icon", "discovery_splash"];
        const auditBefore = { name: guild.name, description: guild.description, icon: guild.icon, discovery_splash: guild.discovery_splash };

        if (body.name != null) guild.name = body.name;
        if (body.description !== undefined) guild.description = body.description ?? undefined;
        Object.assign(guild, {
            icon: await updatedImageHash(guild.icon, body.icon, (image) => handleFile(`/icons/${guild_id}`, image)),
            discovery_splash: await updatedImageHash(guild.discovery_splash, body.custom_banner, (image) => handleFile(`/discovery-splashes/${guild_id}`, image)),
        });
        if (body.visibility != null) profile.visibility = body.visibility;
        if (body.brand_color_primary !== undefined) profile.brand_color_primary = body.brand_color_primary;
        if (body.game_application_ids) profile.game_application_ids = body.game_application_ids;
        if (body.traits) profile.traits = body.traits.filter((trait) => trait?.label).map((trait, position) => ({ ...trait!, position: trait!.position ?? position }));

        guild.profile = profile;
        const tagChanged = applyGuildTag(guild, {
            tag: body.tag,
            badge: body.badge,
            badge_color_primary: body.badge_color_primary,
            badge_color_secondary: body.badge_color_secondary,
        });
        await guild.save();
        const changes = AuditLog.diff(auditBefore, guild, auditKeys);
        if (changes.length)
            await AuditLog.log({
                guild_id,
                user_id: req.user_id,
                action_type: AuditLogEvents.GUILD_UPDATE,
                target_id: guild_id,
                changes,
                reason: req.headers["x-audit-log-reason"],
            });
        if (tagChanged) await syncTagAdopters(guild);

        await Guild.emitUpdate(guild_id);

        res.json((await guild.withPresenceCount()).toGuildProfile());
    },
);

export default router;
