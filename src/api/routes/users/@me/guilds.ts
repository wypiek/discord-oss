import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Guild, Member, User } from "@spacebar/database";
import { Config, DiscordApiErrors, emitEvent, GuildDeleteEvent, Permissions } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        oauth2: ["guilds"],
        responses: {
            200: {
                body: "APIGuildArray",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const withCounts = req.query.with_counts == "true";
        const [members, user] = await Promise.all([
            Member.find({ relations: { guild: true, roles: true }, where: { id: req.user_id } }),
            User.findOneOrFail({ where: { id: req.user_id }, select: { id: true, flags: true } }),
        ]);
        const online = withCounts ? await Guild.countOnlineMembersIn(members.map((x) => x.guild_id)) : undefined;

        res.json(
            members.map(({ guild, roles, communication_disabled_until }) => ({
                id: guild.id,
                name: guild.name,
                icon: guild.icon ?? null,
                banner: guild.banner ?? null,
                owner: guild.owner_id === req.user_id,
                permissions: Permissions.finalPermission({
                    user: {
                        id: req.user_id,
                        roles: roles.map((x) => x.id),
                        communication_disabled_until: communication_disabled_until ?? null,
                        flags: user.flags,
                    },
                    guild: { id: guild.id, owner_id: guild.owner_id!, roles },
                }).bitfield.toString(),
                features: guild.features,
                ...(online && {
                    approximate_member_count: guild.member_count ?? 0,
                    approximate_presence_count: online.get(guild.id) ?? 0,
                }),
            })),
        );
    },
);

// user send to leave a certain guild
router.delete(
    "/:guild_id",
    route({
        responses: {
            204: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const { autoJoin } = Config.get().guild;
        const { guild_id } = req.params as { [key: string]: string };
        const guild = await Guild.findOneOrFail({
            where: { id: guild_id },
            select: { owner_id: true },
        });

        if (!guild) throw new HTTPError("Guild doesn't exist", 404);
        if (!(await Member.existsBy({ id: req.user_id, guild_id }))) {
            if (!req.body?.lurking) throw DiscordApiErrors.UNKNOWN_MEMBER;
            await emitEvent({
                event: "GUILD_DELETE",
                data: { id: guild_id },
                user_id: req.user_id,
            } satisfies GuildDeleteEvent);
            return res.sendStatus(204);
        }
        if (guild.owner_id === req.user_id) throw new HTTPError("You can't leave your own guild", 400);
        if (autoJoin.enabled && autoJoin.guilds.includes(guild_id) && !autoJoin.canLeave) {
            throw new HTTPError("You can't leave instance auto join guilds", 400);
        }

        await Member.removeFromGuild(req.user_id, guild_id);

        return res.sendStatus(204);
    },
);

export default router;
