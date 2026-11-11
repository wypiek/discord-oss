import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Channel, Guild, Member, Invite, Role } from "@spacebar/database";
import { Random } from "@spacebar/extensions";
import { IsNull, MoreThan } from "typeorm";
import { Config, DiscordApiErrors, getUserPresences, Permissions } from "@spacebar/util";
import { ChannelPermissionOverwriteType, ChannelType, GuildWidgetJsonResponse } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

// Undocumented API notes:
// An invite is created for the widget_channel_id on request (only if an existing one created by the widget doesn't already exist)
// This invite created doesn't include an inviter object like user created ones and has a default expiry of 24 hours
// Missing user object information is intentional (https://github.com/discord/discord-api-docs/issues/1287)
// channels returns voice channel objects where @everyone has the CONNECT permission
// members (max 100 returned) is a sample of all members, and bots par invisible status, there exists some alphabetical distribution pattern between the members returned

// https://discord.com/developers/docs/resources/guild#get-guild-widget
const expiryTime = 1000 * 60 * 5; // 5 minutes
const jsonDataCache = new Map<string, { data: Promise<GuildWidgetJsonResponse>; expiry: Date; settings: string }>();

router.get(
    "/",
    route({
        responses: {
            200: {
                body: "GuildWidgetJsonResponse",
            },
            404: {
                body: "APIErrorResponse",
            },
        },
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };

        const current = await Guild.findOneOrFail({
            where: { id: guild_id },
            select: { id: true, widget_enabled: true, widget_channel_id: true, name: true },
        });
        const settings = `${current.widget_enabled}:${current.widget_channel_id}:${current.name}`;
        let cacheEntry = jsonDataCache.get(guild_id);
        if (!cacheEntry || cacheEntry.expiry.getTime() < Date.now() || cacheEntry.settings !== settings) {
            // Create new cache entry
            const dataPromise = getWidgetJsonData(guild_id);
            cacheEntry = {
                data: dataPromise,
                expiry: new Date(Date.now() + expiryTime),
                settings,
            };
            dataPromise.catch(() => jsonDataCache.delete(guild_id));
            console.log("[Widget] Caching widget data for guild", guild_id);
            jsonDataCache.set(guild_id, cacheEntry);
        }

        const cacheRemainingSeconds = Math.floor((cacheEntry.expiry.getTime() - Date.now()) / 1000);
        res.set("Cache-Control", `public, max-age=${cacheRemainingSeconds}, s-maxage=${cacheRemainingSeconds}, immutable`);
        return res.json(await cacheEntry.data);
    },
);

async function getWidgetJsonData(guild_id: string) {
    const guild = await Guild.findOneOrFail({
        where: { id: guild_id },
        select: {
            channel_ordering: true,
            widget_channel_id: true,
            widget_enabled: true,
            presence_count: true,
            name: true,
        },
    });
    if (!guild.widget_enabled) throw DiscordApiErrors.EMBED_DISABLED;

    // Fetch existing widget invite for widget channel
    let invite = guild.widget_channel_id
        ? await Invite.findOne({
              where: { guild_id, channel_id: guild.widget_channel_id, inviter_id: IsNull(), flags: 0, temporary: false, max_uses: 0, expires_at: MoreThan(new Date()) },
          })
        : null;

    if (guild.widget_channel_id && !invite) {
        // Create invite for channel if none exists
        // TODO: Refactor invite create code to a shared function
        const max_age = 86400; // 24 hours
        const expires_at = new Date(max_age * 1000 + Date.now());

        invite = await Invite.create({
            code: Random.getString("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", 6),
            temporary: false,
            uses: 0,
            max_uses: 0,
            max_age: max_age,
            expires_at,
            created_at: new Date(),
            guild_id,
            channel_id: guild.widget_channel_id,
            flags: 0,
        }).save();
    }

    // Fetch voice channels, and the @everyone permissions object
    const channels: { id: string; name: string; position: number }[] = [];

    const everyoneRole = await Role.findOne({ where: { id: guild_id }, select: { id: true, permissions: true } });
    (await Channel.getOrderedChannels(guild.id, guild)).forEach((doc) => {
        if (doc.type !== ChannelType.GUILD_VOICE) return;
        const everyoneOverwrite = doc.permission_overwrites?.find((x) => x.type === ChannelPermissionOverwriteType.role && x.id === guild_id);
        const everyone = new Permissions(Permissions.channelPermission(everyoneOverwrite ? [everyoneOverwrite] : [], BigInt(everyoneRole?.permissions ?? "0"), guild_id));
        if (everyone.has("VIEW_CHANNEL") && everyone.has("CONNECT")) {
            channels.push({
                id: doc.id,
                name: doc.name ?? "Unknown channel",
                position: doc.position ?? 0,
            });
        }
    });

    // Fetch members
    // TODO: Understand how Discord's max 100 random member sample works, and apply to here (see top of this file)
    const members = await Member.find({
        where: { guild_id: guild_id },
        relations: { user: true },
    });
    const cdn = (Config.get().cdn.endpointPublic ?? "").replace(/\/+$/, "");
    const presences = await getUserPresences(members.map((m) => m.id));
    const onlineMembers = members.filter((m) => ["online", "idle", "dnd"].includes(presences.get(m.id)?.status ?? "offline"));
    const memberData = onlineMembers
        .map((x) => ({
            id: x.id,
            username: x.user.username,
            discriminator: x.user.discriminator,
            avatar: null,
            status: presences.get(x.id)!.status as string,
            avatar_url: x.avatar
                ? `${cdn}/guilds/${guild_id}/users/${x.id}/avatars/${x.avatar}.png`
                : x.user.avatar
                  ? `${cdn}/avatars/${x.id}/${x.user.avatar}.png`
                  : `${cdn}/embed/avatars/${Number((BigInt(x.id) >> 22n) % 6n)}.png`,
        }))
        .sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)))
        .slice(0, 100);

    // Construct object to respond with
    return {
        id: guild_id,
        name: guild.name,
        instant_invite: invite?.code,
        channels: channels,
        members: memberData,
        member_count: members.length,
        presence_count: guild.presence_count || onlineMembers.length,
    } as GuildWidgetJsonResponse;
}

export default router;
