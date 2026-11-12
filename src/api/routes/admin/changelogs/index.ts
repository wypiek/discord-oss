import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Changelog } from "@spacebar/database";
import { parseChangelogDate, parseYoutubeVideo, serializeChangelog, siteImageField, today } from "@spacebar/api/util";
import { Snowflake } from "@spacebar/util";
import { AdminChangelogCreateSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, description: "List What's New changelogs, drafts included, newest first" }),
    async (_req: Request, res: Response) => {
        const changelogs = await Changelog.find({ order: { date: "DESC", id: "DESC" }, take: 500 });
        res.json(changelogs.map((changelog) => serializeChangelog(changelog)));
    },
);

router.post(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminChangelogCreateSchema", description: "Write a What's New changelog, as a draft or published" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminChangelogCreateSchema;
        const image = siteImageField(body.image) ?? null;
        const video = parseYoutubeVideo(body.youtube_video_id) ?? null;
        if (image && video) throw new HTTPError("Pick an image or a video, not both", 400);
        const now = new Date();
        const changelog = await Changelog.create({
            id: Snowflake.generate(),
            title: body.title.trim(),
            date: parseChangelogDate(body.date) ?? today(now),
            body: body.body ?? "",
            image,
            youtube_video_id: video,
            published: body.published ?? false,
            show_on_startup: body.show_on_startup ?? true,
            created_at: now,
            updated_at: now,
        }).save();
        res.status(201).json(serializeChangelog(changelog));
    },
);

export default router;
