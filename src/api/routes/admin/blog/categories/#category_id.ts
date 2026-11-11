import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { BlogCategory, BlogPost } from "@spacebar/database";
import { resolveSlug, serializeBlogCategory } from "@spacebar/api/util";
import { AdminBlogCategoryUpdateSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const findCategory = async (req: Request) => {
    const category = await BlogCategory.findOne({ where: { id: req.params.category_id as string } });
    if (!category) throw new HTTPError("Unknown blog category", 404);
    return category;
};

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminBlogCategoryUpdateSchema", description: "Rename a blog category or change its slug or description" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminBlogCategoryUpdateSchema;
        const category = await findCategory(req);
        if (body.name !== undefined) category.name = body.name.trim();
        if (body.slug !== undefined && body.slug.trim() !== category.slug) category.slug = await resolveSlug("blogCategory", body.slug, category.name, category.id);
        if (body.description !== undefined) category.description = body.description.trim();
        await category.save();
        res.json(serializeBlogCategory(category, await BlogPost.count({ where: { category_id: category.id } })));
    },
);

router.delete(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, description: "Delete a blog category. Its posts stay and lose their category.", responses: { 204: {} } }),
    async (req: Request, res: Response) => {
        const category = await findCategory(req);
        await BlogPost.update({ category_id: category.id }, { category_id: null });
        await BlogCategory.delete({ id: category.id });
        res.sendStatus(204);
    },
);

export default router;
