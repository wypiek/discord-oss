import { Request, Response, Router } from "express";
import { Changelog } from "@spacebar/database";
import { changelogConfig, changelogDocument, visibleChangelogs } from "@spacebar/api/util";

const router = Router({ mergeParams: true });

const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

router.get("/config_:platform.json", async (_req: Request, res: Response) => {
    const changelogs = await Changelog.find({ where: { published: true }, select: { id: true, date: true, published: true, show_on_startup: true } });
    res.set("Cache-Control", "public, max-age=60").json(changelogConfig(changelogs));
});

router.get("/:platform/:changelog_id/:locale.json", async (req: Request, res: Response) => {
    const { changelog_id, locale } = req.params as { [key: string]: string };
    if (!/^\d{1,20}$/.test(changelog_id) || !LOCALE.test(locale)) return res.sendStatus(404);
    const changelog = await Changelog.findOne({ where: { id: changelog_id, published: true } });
    if (!changelog || !visibleChangelogs([changelog]).length) return res.sendStatus(404);
    res.set("Cache-Control", "public, max-age=60").json(changelogDocument(changelog, locale));
});

export default router;
