import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Guild, Member } from "@spacebar/database";
import { DiscordApiErrors, emitEvent, GuildMemberUpdateEvent } from "@spacebar/util";

const router = Router({ mergeParams: true });

const STARTED_HOME_ACTIONS = 1 << 5;
const COMPLETED_HOME_ACTIONS = 1 << 6;

router.post("/", route({ responses: { 204: {}, 404: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const { guild_id, channel_id } = req.params as { [key: string]: string };
    const [guild, member] = await Promise.all([
        Guild.findOneOrFail({ where: { id: guild_id }, select: { id: true, home_settings: true } }),
        Member.findOne({ where: { id: req.user_id, guild_id }, select: { index: true, id: true, guild_id: true, flags: true, completed_new_member_actions: true } }),
    ]);
    if (!member) throw DiscordApiErrors.UNKNOWN_MEMBER;
    const actions = (guild.home_settings?.new_member_actions ?? []).map((action) => action.channel_id);
    if (!actions.includes(channel_id)) throw DiscordApiErrors.UNKNOWN_CHANNEL;

    const completed = [...new Set([...(member.completed_new_member_actions ?? []).filter((id) => actions.includes(id)), channel_id])];
    const flags = ((member.flags ?? 0) | STARTED_HOME_ACTIONS | (actions.every((id) => completed.includes(id)) ? COMPLETED_HOME_ACTIONS : 0)) >>> 0;
    if (completed.length === member.completed_new_member_actions?.length && flags === member.flags) return res.sendStatus(204);
    await Member.update({ index: member.index }, { completed_new_member_actions: completed, flags });

    if (flags !== member.flags) {
        const updated = await Member.findOneOrFail({ where: { index: member.index }, relations: { roles: true, user: true } });
        await emitEvent({
            event: "GUILD_MEMBER_UPDATE",
            guild_id,
            data: {
                ...updated.toPublicMember(),
                guild_id,
                user: updated.user.toPublicUser(),
                roles: updated.roles.map((role) => role.id).filter((id) => id !== guild_id),
            },
        } satisfies GuildMemberUpdateEvent);
    }
    res.sendStatus(204);
});

export default router;
