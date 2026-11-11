import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { BlogCategory, BlogPost } from "@spacebar/database";
import { parseOptionalDate, resolveSlug, serializeBlogPost, siteImageField } from "@spacebar/api/util";
import { Snowflake } from "@spacebar/util";
import { AdminBlogPostCreateSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        description: "List blog posts, drafts included, newest first",
        query: {
            limit: { type: "number", required: false },
            offset: { type: "number", required: false },
        },
    }),
    async (req: Request, res: Response) => {
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
        const offset = Math.max(Number(req.query.offset) || 0, 0);
        const [posts, total] = await BlogPost.findAndCount({
            order: { created_at: "DESC" },
            take: limit,
            skip: offset,
            select: {
                id: true,
                title: true,
                slug: true,
                excerpt: true,
                cover_image: true,
                category_id: true,
                author_name: true,
                published: true,
                published_at: true,
                featured: true,
                created_at: true,
                updated_at: true,
            },
        });
        res.json({ total, posts: posts.map((post) => serializeBlogPost(post)) });
    },
);

router.post(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminBlogPostCreateSchema", description: "Write a blog post, as a draft or published" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminBlogPostCreateSchema;
        const title = body.title.trim();
        if (body.category_id && !(await BlogCategory.findOne({ where: { id: body.category_id }, select: { id: true } }))) throw new HTTPError("Unknown blog category", 400);
        const now = new Date();
        const published = body.published ?? false;
        const post = await BlogPost.create({
            id: Snowflake.generate(),
            title,
            slug: await resolveSlug("blogPost", body.slug, title),
            excerpt: body.excerpt?.trim() ?? "",
            body: body.body ?? "",
            cover_image: siteImageField(body.cover_image) ?? null,
            category_id: body.category_id || null,
            author_name: body.author_name?.trim() ?? "",
            published,
            published_at: parseOptionalDate(body.published_at) ?? (published ? now : null),
            featured: body.featured ?? false,
            created_at: now,
            updated_at: now,
        }).save();
        res.status(201).json(serializeBlogPost(post, true));
    },
);

export default router;
