import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { HelpArticle, HelpSection } from "@spacebar/database";
import { resolveSlug, serializeHelpArticle } from "@spacebar/api/util";
import { AdminHelpArticleUpdateSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const findArticle = async (req: Request) => {
    const article = await HelpArticle.findOne({ where: { id: req.params.article_id as string } });
    if (!article) throw new HTTPError("Unknown help centre article", 404);
    return article;
};

router.get("/", route({ right: "OPERATOR", spacebarOnly: true, description: "Get a help centre article with its Markdown body" }), async (req: Request, res: Response) => {
    res.json(serializeHelpArticle(await findArticle(req), true));
});

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminHelpArticleUpdateSchema", description: "Edit, move, publish or unpublish a help centre article" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminHelpArticleUpdateSchema;
        const article = await findArticle(req);
        if (body.title !== undefined) {
            if (!body.title.trim()) throw new HTTPError("An article needs a title", 400);
            article.title = body.title.trim();
        }
        if (body.slug !== undefined && body.slug.trim() !== article.slug) article.slug = await resolveSlug("helpArticle", body.slug, article.title, article.id);
        if (body.body !== undefined) article.body = body.body;
        if (body.section_id !== undefined && body.section_id !== article.section_id) {
            if (!(await HelpSection.findOne({ where: { id: body.section_id }, select: { id: true } }))) throw new HTTPError("Unknown help centre section", 400);
            article.section_id = body.section_id;
            article.position = await HelpArticle.count({ where: { section_id: body.section_id } });
        }
        if (body.published !== undefined) article.published = body.published;
        if (body.promoted !== undefined) article.promoted = body.promoted;
        article.updated_at = new Date();
        await article.save();
        res.json(serializeHelpArticle(article, true));
    },
);

router.delete("/", route({ right: "OPERATOR", spacebarOnly: true, description: "Delete a help centre article", responses: { 204: {} } }), async (req: Request, res: Response) => {
    const article = await findArticle(req);
    await HelpArticle.delete({ id: article.id });
    res.sendStatus(204);
});

export default router;
