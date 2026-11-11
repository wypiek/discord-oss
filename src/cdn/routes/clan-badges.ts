import { Router, Response, Request } from "express";
import { Guild } from "@spacebar/database";
import { listClanBadges, renderClanBadge, setCacheControl, setCacheControlNotFound } from "../util";

const router = Router({ mergeParams: true });

const color = (value: string | null | undefined, fallback: string) => (value && /^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback);

// previews for picking a badge (the admin panel), in any colours: /clan-badges/preview lists the badges,
// /clan-badges/preview/<badge>?primary=%23rrggbb&secondary=%23rrggbb draws one. Registered before /:guild_id/:hash
// the list and previews change whenever the instance's badges are edited, so they're only cached briefly
router.get("/preview", (req: Request, res: Response) => {
    res.set("Cache-Control", "no-cache");
    res.json(listClanBadges());
});

router.get("/preview/:badge", (req: Request, res: Response) => {
    res.set("Cache-Control", "public, max-age=300");
    const size = Math.min(Math.max(Number(req.query.size) || 64, 8), 512);
    const badge = renderClanBadge(Number(req.params.badge), color(String(req.query.primary ?? ""), ""), color(String(req.query.secondary ?? ""), ""), size);
    if (!badge) return setCacheControlNotFound(req, res);
    res.set("Content-Type", "image/svg+xml");
    res.send(badge);
});

router.get("/:guild_id/:hash", setCacheControl, async (req: Request, res: Response) => {
    const { guild_id, hash } = req.params as { [key: string]: string };
    const guild = await Guild.findOne({
        where: { id: guild_id },
        select: { id: true, profile: true },
    });
    const profile = guild?.profile;
    if (!profile?.badge_hash || profile.badge_hash !== hash.split(".")[0]) return setCacheControlNotFound(req, res);

    res.set("Content-Type", "image/svg+xml");
    const size = Math.min(Math.max(Number(req.query.size) || 64, 8), 512);
    const badge = renderClanBadge(profile.badge, color(profile.badge_color_primary, ""), color(profile.badge_color_secondary, ""), size);
    if (badge) return res.send(badge);

    // no badge templates (run `bun run generate:client`): a plain tile in the guild's colours
    const primary = color(profile.badge_color_primary, "#5865f2");
    const secondary = color(profile.badge_color_secondary, "#ffffff");
    res.send(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="64" height="64" shape-rendering="crispEdges"><path fill="${primary}" d="M3 2h10v1h1v10h-1v1H3v-1H2V3h1z"/><path fill="${secondary}" d="M6 5h4v1h1v4h-1v1H6v-1H5V6h1z"/></svg>`,
    );
});

export default router;
