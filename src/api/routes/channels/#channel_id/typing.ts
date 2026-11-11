import { Request, Response, Router } from "express";
import { messageSlowmodeCooldown } from "@spacebar/api/util/handlers/Slowmode";
import { route } from "@spacebar/api/middlewares";
import { Channel, Member } from "@spacebar/database";
import { emitEvent, getPermission, TypingStartEvent } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        permission: "SEND_MESSAGES",
        responses: {
            200: {},
            204: {},
            404: {},
            403: {},
        },
    }),
    async (req: Request, res: Response) => {
        const { channel_id } = req.params as { [key: string]: string };
        const user_id = req.user_id;
        const timestamp = Math.floor(Date.now() / 1000);
        const channel = await Channel.findOneOrFail({
            where: { id: channel_id },
        });

        if (channel.rate_limit_per_user) {
            const permission = req.permission ?? (await getPermission(user_id, channel.guild_id, channel));
            const cooldown = await messageSlowmodeCooldown(channel, user_id, permission);
            if (cooldown > 0) return res.status(200).json({ message_send_cooldown_ms: cooldown });
        }

        const member = channel.guild_id
            ? await Member.createQueryBuilder("member")
                  .leftJoinAndSelect("member.user", "user")
                  .where("member.id = :user_id AND member.guild_id = :guild_id", { user_id, guild_id: channel.guild_id })
                  .getOne()
            : null;
        if (member) {
            const cached = req.permission?.cache?.member;
            if (cached?.index === member.index && Array.isArray(cached.roles)) member.roles = cached.roles;
            else await Member.attachRoles([member]);
        }
        await emitEvent({
            event: "TYPING_START",
            channel_id: channel_id,
            data: {
                ...(member
                    ? {
                          member: {
                              ...member.toPublicMember(),
                              roles: member?.roles?.map((x) => x.id),
                          },
                      }
                    : null),
                channel_id,
                timestamp,
                user_id,
                guild_id: channel.guild_id ?? undefined,
            },
        } satisfies TypingStartEvent);

        res.sendStatus(204);
    },
);

export default router;
