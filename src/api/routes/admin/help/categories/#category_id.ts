import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { HelpArticle, HelpCategory, HelpSection } from "@spacebar/database";
import { In } from "typeorm";
import { resolveSlug, serializeHelpCategory, siteImageField } from "@spacebar/api/util";
import { AdminHelpCategoryUpdateSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const findCategory = async (req: Request) => {
    const category = await HelpCategory.findOne({ where: { id: req.params.category_id as string } });
    if (!category) throw new HTTPError("Unknown help centre category", 404);
    return category;
};

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminHelpCategoryUpdateSchema", description: "Edit a help centre category" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminHelpCategoryUpdateSchema;
        const category = await findCategory(req);
        if (body.name !== undefined) {
            if (!body.name.trim()) throw new HTTPError("A category needs a name", 400);
            category.name = body.name.trim();
        }
        if (body.slug !== undefined && body.slug.trim() !== category.slug) category.slug = await resolveSlug("helpCategory", body.slug, category.name, category.id);
        if (body.description !== undefined) category.description = body.description.trim();
        if (body.icon !== undefined) category.icon = body.icon.trim();
        if (body.icon_image !== undefined) category.icon_image = siteImageField(body.icon_image) ?? null;
        await category.save();
        res.json(serializeHelpCategory(category));
    },
);

router.delete(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, description: "Delete a help centre category with its sections and articles", responses: { 204: {} } }),
    async (req: Request, res: Response) => {
        const category = await findCategory(req);
        const sections = await HelpSection.find({ where: { category_id: category.id }, select: { id: true } });
        if (sections.length) await HelpArticle.delete({ section_id: In(sections.map((section) => section.id)) });
        await HelpSection.delete({ category_id: category.id });
        await HelpCategory.delete({ id: category.id });
        res.sendStatus(204);
    },
);

export default router;
