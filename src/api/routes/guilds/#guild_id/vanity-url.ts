import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Channel, getDatabase, Guild, Invite } from "@spacebar/database";
import { ChannelType, VanityUrlSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const InviteRegex = /\W/g;

router.get(
    "/",
    route({
        permission: "MANAGE_GUILD",
        responses: {
            200: {
                body: "GuildVanityUrlResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });

        if (!guild.features.includes("ALIASABLE_NAMES")) {
            const invite = await Invite.findOne({
                where: { guild_id: guild_id, vanity_url: true },
            });
            if (!invite) return res.json({ code: null });

            return res.json({ code: invite.code, uses: invite.uses });
        } else {
            const invite = await Invite.find({
                where: { guild_id: guild_id, vanity_url: true },
            });
            if (!invite || invite.length == 0) return res.json({ code: null });

            return res.json(invite.map((x) => ({ code: x.code, uses: x.uses })));
        }
    },
);

router.patch(
    "/",
    route({
        requestBody: "VanityUrlSchema",
        permission: "MANAGE_GUILD",
        responses: {
            200: {
                body: "GuildVanityUrlCreateResponse",
            },
            403: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };
        const body = req.body as VanityUrlSchema;
        const code = body.code?.replace(InviteRegex, "").toLowerCase() || null;

        const guild = await Guild.findOneOrFail({ where: { id: guild_id } });
        if (!guild.features.includes("VANITY_URL")) throw new HTTPError("Your guild doesn't support vanity urls");
        if (code && (code.length < 2 || code.length > 32)) throw new HTTPError("Vanity URL must be between 2 and 32 characters", 400);

        const taken = () => new HTTPError("Vanity URL is already taken", 400);
        const holder = code ? await Invite.findOne({ where: { code }, select: { code: true, guild_id: true, vanity_url: true } }) : null;
        if (holder && !(holder.vanity_url && holder.guild_id === guild_id)) throw taken();

        const channel_id = code
            ? (guild.rules_channel_id ??
              guild.system_channel_id ??
              (
                  await Channel.findOneOrFail({
                      where: { guild_id, type: ChannelType.GUILD_TEXT },
                  })
              ).id)
            : null;

        await getDatabase()!
            .transaction(async (manager) => {
                if (!guild.features.includes("ALIASABLE_NAMES")) await manager.delete(Invite, { guild_id, vanity_url: true });
                if (code && !(await manager.findOne(Invite, { where: { code }, select: { code: true } })))
                    await manager.insert(Invite, {
                        vanity_url: true,
                        code,
                        temporary: false,
                        uses: 0,
                        max_uses: 0,
                        max_age: 0,
                        created_at: new Date(),
                        guild_id,
                        channel_id: channel_id!,
                        flags: 0,
                    });
                await manager.update(Guild, { id: guild_id }, { vanity_url_code: code });
            })
            .catch((error: { code?: string; driverError?: { code?: string } }) => {
                const reason = String(error.driverError?.code ?? error.code ?? "");
                if (reason === "23505" || reason.startsWith("SQLITE_CONSTRAINT")) throw taken();
                throw error;
            });
        await Guild.emitUpdate(guild_id);

        return res.json({ code });
    },
);

export default router;
