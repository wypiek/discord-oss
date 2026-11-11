import { HTTPError } from "lambert-server/HTTPError";
import { BaseEntity, In } from "typeorm";
import { BlogCategory, BlogPost, getDatabase, HelpArticle, HelpCategory, HelpSection } from "@spacebar/database";
import { isSlug, slugify, uniqueSlug } from "@spacebar/util";
import { siteImageUrl } from "./sitePages";

export const SITE_IMAGE_FILE = /^[0-9a-f]{32}\.(png|jpg|webp|avif|gif)$/;

export const SITE_IMAGE_DATA_URI = /^data:image\/(png|jpeg|webp|avif|gif);base64,[A-Za-z0-9+/]+=*$/;

const SLUG_TABLES = {
    blogCategory: { table: BlogCategory, fallback: "category" },
    blogPost: { table: BlogPost, fallback: "post" },
    helpCategory: { table: HelpCategory, fallback: "category" },
    helpArticle: { table: HelpArticle, fallback: "article" },
};

export type SlugKind = keyof typeof SLUG_TABLES;

export const resolveSlug = async (kind: SlugKind, wanted: string | undefined, title: string, ownId?: string) => {
    const { table, fallback } = SLUG_TABLES[kind];
    const taken = async (slug: string) => {
        const existing = await getDatabase()!
            .getRepository<{ id: string; slug: string }>(table)
            .findOne({ where: { slug }, select: { id: true } });
        return !!existing && existing.id !== ownId;
    };
    if (wanted === undefined || !wanted.trim()) return uniqueSlug(title, fallback, taken);
    const slug = slugify(wanted);
    if (!isSlug(slug)) throw new HTTPError("A slug needs at least one letter or digit", 400);
    if (await taken(slug)) throw new HTTPError(`The slug "${slug}" is already in use`, 400);
    return slug;
};

export const siteImageField = (value: string | null | undefined) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    if (!SITE_IMAGE_FILE.test(value)) throw new HTTPError("Upload the image first, then use the file name it returns", 400);
    return value;
};

export const parseOptionalDate = (value: string | null | undefined) => {
    if (value === undefined) return undefined;
    if (value === null || value === "") return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new HTTPError("Dates must be ISO 8601 timestamps", 400);
    return date;
};

export const applyOrder = async <T extends BaseEntity & { id: string; position: number }>(rows: T[], ids: string[]) => {
    const order = new Map(ids.map((id, index) => [id, index]));
    const sorted = [...rows].sort((a, b) => (order.get(a.id) ?? ids.length + a.position) - (order.get(b.id) ?? ids.length + b.position));
    const changed: T[] = [];
    sorted.forEach((row, index) => {
        if (row.position === index) return;
        row.position = index;
        changed.push(row);
    });
    for (const row of changed) await row.save();
    return sorted;
};

export const serializeBlogCategory = (category: BlogCategory, posts?: number) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    position: category.position,
    ...(posts !== undefined ? { posts } : {}),
});

export const serializeBlogPost = (post: BlogPost, withBody = false) => ({
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    ...(withBody ? { body: post.body } : {}),
    cover_image: post.cover_image ?? null,
    cover_image_url: post.cover_image ? siteImageUrl(post.cover_image) : null,
    category_id: post.category_id ?? null,
    author_name: post.author_name,
    published: post.published,
    published_at: post.published_at ? new Date(post.published_at).toISOString() : null,
    featured: post.featured,
    created_at: new Date(post.created_at).toISOString(),
    updated_at: new Date(post.updated_at).toISOString(),
    url: `/blog/${post.slug}`,
});

export const serializeHelpCategory = (category: HelpCategory) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    icon: category.icon,
    icon_image: category.icon_image ?? null,
    icon_image_url: category.icon_image ? siteImageUrl(category.icon_image) : null,
    position: category.position,
    url: `/support/categories/${category.slug}`,
});

export const serializeHelpSection = (section: HelpSection) => ({
    id: section.id,
    category_id: section.category_id,
    name: section.name,
    position: section.position,
});

export const serializeHelpArticle = (article: HelpArticle, withBody = false) => ({
    id: article.id,
    section_id: article.section_id,
    title: article.title,
    slug: article.slug,
    ...(withBody ? { body: article.body } : {}),
    position: article.position,
    published: article.published,
    promoted: article.promoted,
    helpful_yes: article.helpful_yes,
    helpful_no: article.helpful_no,
    created_at: new Date(article.created_at).toISOString(),
    updated_at: new Date(article.updated_at).toISOString(),
    url: `/support/articles/${article.slug}`,
});

export const helpCentreTree = async () => {
    const categories = await HelpCategory.find({ order: { position: "ASC", name: "ASC" } });
    const sections = categories.length ? await HelpSection.find({ where: { category_id: In(categories.map((c) => c.id)) }, order: { position: "ASC", name: "ASC" } }) : [];
    const articles = sections.length
        ? await HelpArticle.find({
              where: { section_id: In(sections.map((s) => s.id)) },
              order: { position: "ASC", title: "ASC" },
              select: {
                  id: true,
                  section_id: true,
                  title: true,
                  slug: true,
                  position: true,
                  published: true,
                  promoted: true,
                  helpful_yes: true,
                  helpful_no: true,
                  created_at: true,
                  updated_at: true,
              },
          })
        : [];
    return categories.map((category) => ({
        ...serializeHelpCategory(category),
        sections: sections
            .filter((section) => section.category_id === category.id)
            .map((section) => ({
                ...serializeHelpSection(section),
                articles: articles.filter((article) => article.section_id === section.id).map((article) => serializeHelpArticle(article)),
            })),
    }));
};
