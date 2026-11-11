import { Request, Response, Router } from "express";
import { HTTPError } from "lambert-server/HTTPError";
import { route } from "@spacebar/api/middlewares";
import { BlogCategory, BlogPost } from "@spacebar/database";
import { parseOptionalDate, resolveSlug, serializeBlogPost, siteImageField } from "@spacebar/api/util";
import { AdminBlogPostUpdateSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

const findPost = async (req: Request) => {
    const post = await BlogPost.findOne({ where: { id: req.params.post_id as string } });
    if (!post) throw new HTTPError("Unknown blog post", 404);
    return post;
};

router.get("/", route({ right: "OPERATOR", spacebarOnly: true, description: "Get a blog post with its Markdown body" }), async (req: Request, res: Response) => {
    res.json(serializeBlogPost(await findPost(req), true));
});

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, requestBody: "AdminBlogPostUpdateSchema", description: "Edit, publish or unpublish a blog post" }),
    async (req: Request, res: Response) => {
        const body = req.body as AdminBlogPostUpdateSchema;
        const post = await findPost(req);
        if (body.title !== undefined) {
            if (!body.title.trim()) throw new HTTPError("A post needs a title", 400);
            post.title = body.title.trim();
        }
        if (body.slug !== undefined && body.slug.trim() !== post.slug) post.slug = await resolveSlug("blogPost", body.slug, post.title, post.id);
        if (body.excerpt !== undefined) post.excerpt = body.excerpt.trim();
        if (body.body !== undefined) post.body = body.body;
        if (body.cover_image !== undefined) post.cover_image = siteImageField(body.cover_image) ?? null;
        if (body.category_id !== undefined) {
            if (body.category_id && !(await BlogCategory.findOne({ where: { id: body.category_id }, select: { id: true } }))) throw new HTTPError("Unknown blog category", 400);
            post.category_id = body.category_id || null;
        }
        if (body.author_name !== undefined) post.author_name = body.author_name.trim();
        if (body.featured !== undefined) post.featured = body.featured;
        const publishedAt = parseOptionalDate(body.published_at);
        if (publishedAt !== undefined) post.published_at = publishedAt;
        if (body.published !== undefined) post.published = body.published;
        if (post.published && !post.published_at) post.published_at = new Date();
        post.updated_at = new Date();
        await post.save();
        res.json(serializeBlogPost(post, true));
    },
);

router.delete("/", route({ right: "OPERATOR", spacebarOnly: true, description: "Delete a blog post", responses: { 204: {} } }), async (req: Request, res: Response) => {
    const post = await findPost(req);
    await BlogPost.delete({ id: post.id });
    res.sendStatus(204);
});

export default router;
