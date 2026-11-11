import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { HelpArticle, HelpSection } from "@spacebar/database";
import { helpCentreTree, resolveSlug, serializeHelpArticle } from "@spacebar/api/util";
import { Snowflake } from "@spacebar/util";
import { AdminHelpArticleCreateSchema, AdminSiteOrderSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminHelpArticleCreateSchema", description: "Write a help centre article, as a draft or published" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminHelpArticleCreateSchema;
        if (!(await HelpSection.findOne({ where: { id: body.section_id }, select: { id: true } }))) throw new HTTPError("Unknown help centre section", 400);
        const title = body.title.trim();
        const now = new Date();
        const article = await HelpArticle.create({
            id: Snowflake.generate(),
            section_id: body.section_id,
            title,
            slug: await resolveSlug("helpArticle", body.slug, title),
            body: body.body ?? "",
            position: await HelpArticle.count({ where: { section_id: body.section_id } }),
            published: body.published ?? false,
            promoted: body.promoted ?? false,
            created_at: now,
            updated_at: now,
        }).save();
        res.status(201).json(serializeHelpArticle(article, true));
    },
);

router.patch(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminSiteOrderSchema",
        description: "Reorder the articles of one section. Every id must belong to the same section.",
    }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminSiteOrderSchema;
        const first = await HelpArticle.findOne({ where: { id: body.ids[0] }, select: { id: true, section_id: true } });
        if (!first) throw new HTTPError("Unknown help centre article", 400);
        const articles = await HelpArticle.find({ where: { section_id: first.section_id }, select: { id: true, position: true, section_id: true } });
        const order = new Map(body.ids.map((id, index) => [id, index]));
        const sorted = [...articles].sort((a, b) => (order.get(a.id) ?? body.ids.length + a.position) - (order.get(b.id) ?? body.ids.length + b.position));
        for (const [index, article] of sorted.entries()) if (article.position !== index) await HelpArticle.update({ id: article.id }, { position: index });
        res.json(await helpCentreTree());
    },
);

export default router;
