import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { Changelog } from "@spacebar/database";
import { parseChangelogDate, parseYoutubeVideo, serializeChangelog, siteImageField } from "@spacebar/api/util";
import { AdminChangelogUpdateSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const findChangelog = async (req: Request) => {
    const changelog = await Changelog.findOne({ where: { id: req.params.changelog_id as string } });
    if (!changelog) throw new HTTPError("Unknown changelog", 404);
    return changelog;
};

router.get("/", route({ right: "OPERATOR", spacebarOnly: true, description: "Get a What's New changelog" }), async (req: Request, res: Response) => {
    res.json(serializeChangelog(await findChangelog(req)));
});

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminChangelogUpdateSchema", description: "Edit, publish or unpublish a What's New changelog" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminChangelogUpdateSchema;
        const changelog = await findChangelog(req);
        if (body.title !== undefined) {
            if (!body.title.trim()) throw new HTTPError("A changelog needs a title", 400);
            changelog.title = body.title.trim();
        }
        const date = parseChangelogDate(body.date);
        if (date) changelog.date = date;
        if (body.body !== undefined) changelog.body = body.body;
        if (body.image !== undefined) changelog.image = siteImageField(body.image) ?? null;
        const video = parseYoutubeVideo(body.youtube_video_id);
        if (video !== undefined) changelog.youtube_video_id = video;
        if (changelog.image && changelog.youtube_video_id) throw new HTTPError("Pick an image or a video, not both", 400);
        if (body.published !== undefined) changelog.published = body.published;
        if (body.show_on_startup !== undefined) changelog.show_on_startup = body.show_on_startup;
        changelog.updated_at = new Date();
        await changelog.save();
        res.json(serializeChangelog(changelog));
    },
);

router.delete("/", route({ right: "OPERATOR", spacebarOnly: true, description: "Delete a What's New changelog", responses: { 204: {} } }), async (req: Request, res: Response) => {
    const changelog = await findChangelog(req);
    await Changelog.delete({ id: changelog.id });
    res.sendStatus(204);
});

export default router;
