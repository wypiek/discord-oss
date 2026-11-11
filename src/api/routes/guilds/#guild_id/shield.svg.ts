import fs from "node:fs";
import path from "node:path";
import { makeBadge } from "badge-maker";
import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Guild, Member } from "@spacebar/database";
import { DiscordApiErrors, getUserPresences, instanceName } from "@spacebar/util";

const router: Router = Router({ mergeParams: true });

// Undocumented API notes:
// An invite is created for the widget_channel_id on request (only if an existing one created by the widget doesn't already exist)
// This invite created doesn't include an inviter object like user created ones and has a default expiry of 24 hours
// Missing user object information is intentional (https://github.com/discord/discord-api-docs/issues/1287)
// channels returns voice channel objects where @everyone has the CONNECT permission
// members (max 100 returned) is a sample of all members, and bots par invisible status, there exists some alphabetical distribution pattern between the members returned

// https://discord.com/developers/docs/resources/guild#get-guild-widget
const expiryTime = 1000 * 60 * 5; // 5 minutes
const jsonDataCache = new Map<string, { data: Promise<string>; expiry: Date }>();

const assetsPath = path.join(__dirname, "..", "..", "..", "..", "..", "assets");
const whiteLogo = "data:image/png;base64," + Buffer.from(fs.readFileSync(path.join(assetsPath, "icon_white.png"))).toString("base64");
const blueLogo = "data:image/png;base64," + Buffer.from(fs.readFileSync(path.join(assetsPath, "icon.png"))).toString("base64");

router.get(
    "/",
    route({
        responses: {
            200: {},
            404: {
                body: "APIErrorResponse",
            },
        },
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const { guild_id } = req.params as { [key: string]: string };

        let cacheEntry = jsonDataCache.get(guild_id);
        if (!cacheEntry || cacheEntry.expiry.getTime() < Date.now()) {
            // Create new cache entry
            const dataPromise = getWidgetJsonData(guild_id);
            cacheEntry = {
                data: dataPromise,
                expiry: new Date(Date.now() + expiryTime),
            };
            console.log("[Shield] Caching shield data for guild", guild_id);
            jsonDataCache.set(guild_id, cacheEntry);
        }

        const cacheRemainingSeconds = Math.floor((cacheEntry.expiry.getTime() - Date.now()) / 1000);
        res.set("Cache-Control", `public, max-age=${cacheRemainingSeconds}, s-maxage=${cacheRemainingSeconds}, immutable`);
        res.set("Content-Type", "image/svg+xml;charset=utf-8");
        return res.status(200).send(await cacheEntry.data);
    },
);

async function getWidgetJsonData(guild_id: string, useWhiteLogo: boolean = true) {
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

    const members = await Member.find({ where: { guild_id }, select: { id: true } });
    const presences = await getUserPresences(members.map((m) => m.id));
    const online = [...presences.values()].filter((presence) => ["online", "idle", "dnd"].includes(presence.status)).length;

    return makeBadge({
        label: instanceName(),
        message: `${online} online`,
        color: "#0185ff",
        logoBase64: useWhiteLogo ? whiteLogo : blueLogo,
    });
}

export default router;
