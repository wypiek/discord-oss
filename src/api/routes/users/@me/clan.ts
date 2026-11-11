import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Guild, Member, User } from "@spacebar/database";
import { broadcastUserUpdate, DiscordApiErrors, emitEvent, UserUpdateEvent } from "@spacebar/util";
import { HTTPError } from "lambert-server/HTTPError";

const router = Router({ mergeParams: true });

router.put("/", route({}), async (req: Request, res: Response) => {
    const { identity_guild_id, identity_enabled } = req.body as {
        identity_guild_id?: string | null;
        identity_enabled?: boolean;
    };
    const user = await User.findOneOrFail({ where: { id: req.user_id } });

    if (!identity_guild_id || identity_enabled === false) {
        user.primary_guild = {
            identity_guild_id: identity_guild_id ?? null,
            identity_enabled: false,
            tag: null,
            badge: null,
        };
    } else {
        await Member.IsInGuildOrFail(req.user_id, identity_guild_id);
        const guild = await Guild.findOne({
            where: { id: identity_guild_id },
            select: { id: true, profile: true },
        });
        if (!guild) throw DiscordApiErrors.UNKNOWN_GUILD;
        if (!guild.profile?.tag) throw new HTTPError("This server does not have a server tag", 400);
        user.primary_guild = {
            identity_guild_id,
            identity_enabled: true,
            tag: guild.profile.tag,
            badge: guild.profile.badge_hash ?? null,
        };
    }
    await user.save();

    const data = user.toPrivateUser();
    await emitEvent({
        event: "USER_UPDATE",
        user_id: req.user_id,
        data: data as unknown as UserUpdateEvent["data"],
    } satisfies UserUpdateEvent);
    await broadcastUserUpdate(req.user_id);
    res.json(data);
});

export default router;
