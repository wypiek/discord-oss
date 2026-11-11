import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { BlogCategory, BlogPost } from "@spacebar/database";
import { applyOrder, resolveSlug, serializeBlogCategory } from "@spacebar/api/util";
import { Snowflake } from "@spacebar/util";
import { AdminBlogCategoryCreateSchema, AdminSiteOrderSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const listCategories = async () => {
    const categories = await BlogCategory.find({ order: { position: "ASC", name: "ASC" } });
    const counts: { category_id: string; count: string | number }[] = await BlogPost.createQueryBuilder("post")
        .select("post.category_id", "category_id")
        .addSelect("COUNT(*)", "count")
        .where("post.category_id IS NOT NULL")
        .groupBy("post.category_id")
        .getRawMany();
    return categories.map((category) => serializeBlogCategory(category, Number(counts.find((row) => String(row.category_id) === category.id)?.count ?? 0)));
};

router.get(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, description: "List blog categories in order, with how many posts each has" }),
    async (req: Request, res: Response) => {
        res.json(await listCategories());
    },
);

router.post(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminBlogCategoryCreateSchema", description: "Create a blog category" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminBlogCategoryCreateSchema;
        const name = body.name.trim();
        const category = await BlogCategory.create({
            id: Snowflake.generate(),
            name,
            slug: await resolveSlug("blogCategory", body.slug, name),
            description: body.description?.trim() ?? "",
            position: await BlogCategory.count(),
            created_at: new Date(),
        }).save();
        res.status(201).json(serializeBlogCategory(category, 0));
    },
);

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminSiteOrderSchema", description: "Reorder blog categories" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminSiteOrderSchema;
        await applyOrder(await BlogCategory.find(), body.ids);
        res.json(await listCategories());
    },
);

export default router;
