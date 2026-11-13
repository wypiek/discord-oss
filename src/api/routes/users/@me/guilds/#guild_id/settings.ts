import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { assertChannelOverridesInScope } from "@spacebar/api/util/utility/guildSettingsChannels";
import { Guild, Member, User, userGuildSettingsEntry } from "@spacebar/database";
import { DefaultUserGuildSettings, UserGuildSettings, UserGuildSettingsSchema } from "@spacebar/schemas";

const isPrivate = (guild_id: string) => guild_id === "@me" || guild_id === "null";

const router = Router({ mergeParams: true });

// GET doesn't exist on discord.com
router.get(
    "/",
    route({
        responses: {
            200: {},
            404: {},
        },
    }),
    async (req: Request, res: Response) => {
        const guild_id = req.params.guild_id as string;
        if (isPrivate(guild_id)) {
            const user = await User.findOne({
                where: { id: req.user_id },
                select: { id: true, private_channel_settings: true },
            });
            return res.json(userGuildSettingsEntry(user?.private_channel_settings ?? DefaultUserGuildSettings, null));
        }
        const member = await Member.findOneOrFail({
            where: { id: req.user_id, guild_id },
            select: { settings: true },
        });
        const guild = await Guild.findOne({
            where: { id: guild_id },
            select: { id: true, default_message_notifications: true },
        });
        return res.json(userGuildSettingsEntry(member.settings, guild_id, guild?.default_message_notifications));
    },
);

router.patch(
    "/",
    route({
        requestBody: "UserGuildSettingsSchema",
        responses: {
            200: {},
            400: {
                body: "APIErrorResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as UserGuildSettingsSchema;
        const guild_id = req.params.guild_id as string;
        const target = isPrivate(guild_id) ? null : guild_id;
        await assertChannelOverridesInScope(req.user_id, target, body.channel_overrides);
        res.json(await Member.updateGuildSettings(req.user_id, target, body as Partial<UserGuildSettings>));
    },
);

export default router;
