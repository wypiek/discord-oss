import fs from "node:fs";
import path from "node:path";
import { Request } from "express";
import { Brackets, In, LessThanOrEqual, Not } from "typeorm";
import { BlogCategory, BlogPost, HelpArticle, HelpCategory, HelpSection } from "@spacebar/database";
import { sqlLike } from "@spacebar/database/Sql";
import { Config, PUBLIC_ASSETS_FOLDER, brandPage, escapeMarkup, instanceIconTile, instanceName, markdownText, openGraphTags, renderMarkdown, requestOrigin } from "@spacebar/util";

export type SiteSection = "blog" | "support";

export interface SitePage {
    status: number;
    html: string;
}

const BLOG_FIRST_PAGE = 13;
const BLOG_PAGE_SIZE = 12;
const BLOG_SEARCH_RESULTS = 48;
const RELATED_ARTICLES = 5;
const SIDEBAR_ARTICLES = 10;
const SEARCH_RESULTS = 50;
export const SEARCH_QUERY_MAX = 100;

export const siteImageUrl = (file: string) => `${(Config.get().cdn.endpointPublic || "").replace(/\/+$/, "")}/site-images/${file}`;

export const siteImageOrigins = () => {
    const { cdn, api, general } = Config.get();
    return [cdn.endpointPublic, api.endpointPublic, general.serverName].filter((value): value is string => !!value && URL.canParse(value));
};

const instanceHtml = () => escapeMarkup(instanceName());

export const instanceText = (text: string) => escapeMarkup(text).replaceAll("{instance}", instanceHtml());

export const plainInstanceText = (text: string) => text.replaceAll("{instance}", instanceName());

export const renderSiteMarkdown = (source: string) => renderMarkdown(source, { imageOrigins: siteImageOrigins() }).replaceAll("{instance}", instanceHtml());

const formatDate = (value?: Date | string | null) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
};

const isoDate = (value?: Date | string | null) => (value ? new Date(value).toISOString() : "");

const fill = (template: string, values: Record<string, string>) => template.replace(/__([A-Z_]+)__/g, (match, key: string) => (key in values ? values[key] : match));

const searchIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`;

const chevron = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>`;

const searchForm = (query = "", autofocus = false) =>
    `<form class="search" role="search" action="/support/search" method="get">${searchIcon}<label class="sr-only" for="support-search">Search the help centre</label><input id="support-search" type="search" name="q" maxlength="${SEARCH_QUERY_MAX}" value="${escapeMarkup(query)}" placeholder="Search" autocomplete="off"${autofocus ? " autofocus" : ""}></form>`;

const blogSearchForm = (query = "") =>
    `<form class="dock-search" role="search" action="/blog" method="get"><button type="submit" aria-label="Search">${searchIcon}</button><label class="sr-only" for="blog-search">Search the blog</label><input id="blog-search" type="search" name="q" maxlength="${SEARCH_QUERY_MAX}" value="${escapeMarkup(query)}" placeholder="Search..." autocomplete="off"></form>`;

const dockMenu = (label: string, navLabel: string, links: string) =>
    `<details class="dock-menu"><summary><span>${label}</span>${chevron}</summary><nav class="dock-list" aria-label="${navLabel}">${links}</nav></details>`;

const dock = (menu: string, query = "") =>
    `<div class="dock"><div class="dock-bar">${menu}${menu ? `<span class="dock-line" aria-hidden="true"></span>` : ""}${blogSearchForm(query)}</div></div>`;

const crumbs = (items: [string, string | null][]) =>
    `<nav aria-label="Breadcrumbs"><ol class="crumbs">${items
        .map(([label, href], index) => (href && index < items.length - 1 ? `<li><a href="${escapeMarkup(href)}">${label}</a></li>` : `<li aria-current="page">${label}</li>`))
        .join("")}</ol></nav>`;

const navLinks = (section: SiteSection) =>
    (
        [
            ["Home", "/", false],
            ["Blog", "/blog", section === "blog"],
            ["Support", "/support", section === "support"],
            ["Status", "/status", false],
            ["Developers", "/developers", false],
            ["Guidelines", "/guidelines", false],
        ] as [string, string, boolean][]
    )
        .map(([label, href, current]) => `<li><a href="${href}"${current ? ' aria-current="page"' : ""}>${label}</a></li>`)
        .join("");

interface PageOptions {
    section: SiteSection;
    title: string;
    description: string;
    url: string;
    image?: string;
    hero: string;
    content: string;
    dock?: string;
    bodyClass?: string;
    feed?: boolean;
    status?: number;
}

const renderPage = (req: Request, options: PageOptions): SitePage => {
    const template = fs.readFileSync(path.join(PUBLIC_ASSETS_FOLDER, "site.html"), "utf8");
    const origin = requestOrigin(req);
    const email = Config.get().general.correspondenceEmail?.trim();
    const description = options.description.slice(0, 300);
    return {
        status: options.status ?? 200,
        html: fill(brandPage(template), {
            PAGE_TITLE: escapeMarkup(options.title),
            META_DESCRIPTION: escapeMarkup(description),
            OPEN_GRAPH: openGraphTags(origin, { title: options.title, description, url: options.url, image: options.image }),
            FEED_LINK: options.feed ? `<link rel="alternate" type="application/atom+xml" title="${escapeMarkup(instanceName())} Blog" href="/blog/feed.atom" />` : "",
            BODY_CLASS: options.bodyClass ? `${options.section} ${options.bodyClass}` : options.section,
            NAV_LINKS: navLinks(options.section),
            NAV_ACTION: `<a class="nav-cta" href="/channels/@me">Open ${instanceHtml()}</a>`,
            HERO: options.hero,
            CONTENT: options.content,
            DOCK: options.dock ?? "",
            CONTACT: email ? `<li><a href="mailto:${escapeMarkup(email)}">Contact</a></li>` : "",
        }),
    };
};

const blogTitle = () => `${instanceName()} Blog`;

const notFoundPage = (req: Request, section: SiteSection, message: string) => {
    const title = section === "blog" ? "Post not found" : "Page not found";
    const back = section === "blog" ? `<a class="pill" href="/blog">Back to the blog</a>` : `<a class="pill" href="/support">Back to the help centre</a>`;
    return renderPage(req, {
        section,
        status: 404,
        title: `${title} | ${section === "blog" ? blogTitle() : `${instanceName()} Help Centre`}`,
        description: message,
        url: section === "blog" ? "/blog" : "/support",
        hero:
            section === "blog"
                ? `<section class="blog-hero"><div class="container"><header class="blog-head"><h1 class="display">${title}</h1><p>${escapeMarkup(message)}</p></header><div class="pager">${back}</div></div></section>`
                : "",
        content:
            section === "blog"
                ? ""
                : `<div class="help-page"><div class="sub-nav">${searchForm()}</div><header class="page-header"><h1>${title}</h1><p>${escapeMarkup(message)}</p></header><div class="pager">${back}</div></div>`,
    });
};

const publishedWhere = () => ({ published: true, published_at: LessThanOrEqual(new Date()) });

const postUrl = (post: BlogPost) => `/blog/${post.slug}`;

const postExcerpt = (post: BlogPost) => post.excerpt?.trim() || markdownText(post.body).slice(0, 220);

const cover = (post: BlogPost, eager = false) =>
    `<span class="cover">${
        post.cover_image
            ? `<img class="cover-image" src="${escapeMarkup(siteImageUrl(post.cover_image))}" alt=""${eager ? "" : ' loading="lazy"'} decoding="async">`
            : `<span class="cover-mark">${instanceIconTile()}</span>`
    }</span>`;

const kicker = (category?: BlogCategory | null) => (category ? `<span class="kicker">${instanceText(category.name)}</span>` : "");

const card = (post: BlogPost, categories: Map<string, BlogCategory>) =>
    `<a class="card" href="${escapeMarkup(postUrl(post))}">${cover(post)}<span class="card-text">${kicker(post.category_id ? categories.get(post.category_id) : null)}<span class="card-title">${instanceText(post.title)}</span></span></a>`;

const featuredCard = (post: BlogPost, categories: Map<string, BlogCategory>) =>
    `<a class="featured" href="${escapeMarkup(postUrl(post))}">${cover(post, true)}<span class="featured-info">${kicker(post.category_id ? categories.get(post.category_id) : null)}<h2>${instanceText(post.title)}</h2><p>${instanceText(postExcerpt(post))}</p></span></a>`;

const categoryMenu = (categories: BlogCategory[], current?: BlogCategory | null) =>
    dockMenu(
        current ? instanceText(current.name) : "Featured",
        "Blog categories",
        `<a href="/blog"${current === undefined ? ' aria-current="page"' : ""}><span>Featured</span></a>${categories
            .map(
                (category) =>
                    `<a href="/blog/category/${escapeMarkup(category.slug)}"${category.id === current?.id ? ' aria-current="page"' : ""}><span>${instanceText(category.name)}</span></a>`,
            )
            .join("")}`,
    );

const loadCategories = async () => {
    const categories = await BlogCategory.find({ order: { position: "ASC", name: "ASC" } });
    return { categories, byId: new Map(categories.map((category) => [category.id, category])) };
};

export const blogListingPage = async (req: Request, page: number, categorySlug?: string): Promise<SitePage> => {
    const { categories, byId } = await loadCategories();
    const category = categorySlug ? categories.find((entry) => entry.slug === categorySlug) : undefined;
    if (categorySlug && !category) return notFoundPage(req, "blog", "That category doesn't exist.");
    const scope = { ...publishedWhere(), ...(category ? { category_id: category.id } : {}) };
    const featured =
        (await BlogPost.findOne({ where: { ...scope, featured: true }, order: { published_at: "DESC" } })) ??
        (await BlogPost.findOne({ where: scope, order: { published_at: "DESC" } }));
    const rest = featured ? { ...scope, id: Not(featured.id) } : scope;
    const total = await BlogPost.count({ where: rest });
    const skip = page <= 1 ? 0 : BLOG_FIRST_PAGE + (page - 2) * BLOG_PAGE_SIZE;
    const take = page <= 1 ? BLOG_FIRST_PAGE : BLOG_PAGE_SIZE;
    const posts = await BlogPost.find({ where: rest, order: { published_at: "DESC", id: "DESC" }, skip, take });
    if (page > 1 && !posts.length) return notFoundPage(req, "blog", "There are no posts on this page.");

    const base = category ? `/blog/category/${category.slug}` : "/blog";
    const heading = category ? instanceText(category.name) : `${instanceHtml()} Blog`;
    const intro = category?.description.trim() ? `<p>${instanceText(category.description)}</p>` : "";
    const hero = `<section class="blog-hero"><div class="container"><header class="blog-head"><h1 class="display">${heading}</h1>${intro}</header>${
        page <= 1 && featured ? featuredCard(featured, byId) : ""
    }</div></section>`;

    const twoColumn = page <= 1 ? posts.slice(0, 4) : [];
    const explore = page <= 1 ? posts.slice(4) : posts;
    const hasMore = skip + posts.length < total;
    const pager = [
        page > 1 ? `<a class="pill" href="${escapeMarkup(page === 2 ? base : `${base}?page=${page - 1}`)}">Newer posts</a>` : "",
        hasMore ? `<a class="pill" href="${escapeMarkup(`${base}?page=${page + 1}`)}">Load more</a>` : "",
    ].join("");

    const sections = [
        twoColumn.length ? `<div class="blog-content"><div class="container"><div class="grid-2">${twoColumn.map((post) => card(post, byId)).join("")}</div></div></div>` : "",
        explore.length || page > 1
            ? `<section class="explore" aria-labelledby="explore-title"><div class="container"><header><h2 id="explore-title">${page > 1 ? `Page ${page}` : "Explore further"}</h2>${
                  page > 1 ? "" : "<p>Catch up on everything else we've written.</p>"
              }</header><div class="grid-3">${explore.map((post) => card(post, byId)).join("")}</div>${pager ? `<div class="pager">${pager}</div>` : ""}</div></section>`
            : pager
              ? `<div class="container"><div class="pager">${pager}</div></div>`
              : "",
    ].join("");
    const empty = !featured ? `<div class="container"><div class="empty-state">Nothing has been posted here yet. Check back soon.</div></div>` : "";

    const title = category ? `${plainInstanceText(category.name)} | ${blogTitle()}` : blogTitle();
    const description = category?.description.trim() ? plainInstanceText(category.description) : `News and stories from ${instanceName()}.`;
    return renderPage(req, {
        section: "blog",
        title: page > 1 ? `${title}, page ${page}` : title,
        description,
        url: page > 1 ? `${base}?page=${page}` : base,
        feed: true,
        hero,
        content: `${empty}${sections}`,
        dock: dock(categoryMenu(categories, category ?? undefined)),
    });
};

export const blogSearchPage = async (req: Request, rawQuery: string): Promise<SitePage> => {
    const query = rawQuery.trim().slice(0, SEARCH_QUERY_MAX);
    const pattern = likePattern(query);
    const { categories, byId } = await loadCategories();
    const results = query
        ? await BlogPost.createQueryBuilder("post")
              .where("post.published = :published", { published: true })
              .andWhere("post.published_at <= :now", { now: new Date() })
              .andWhere(
                  new Brackets((where) =>
                      where
                          .where(sqlLike("post.title", ":pattern"), { pattern })
                          .orWhere(sqlLike("post.excerpt", ":pattern"), { pattern })
                          .orWhere(sqlLike("post.body", ":pattern"), { pattern }),
                  ),
              )
              .orderBy("post.published_at", "DESC")
              .take(BLOG_SEARCH_RESULTS)
              .getMany()
        : [];
    const summary = !query
        ? "Type a word or two to search every post."
        : results.length
          ? `${results.length === BLOG_SEARCH_RESULTS ? `The first ${BLOG_SEARCH_RESULTS}` : results.length} ${results.length === 1 ? "post" : "posts"} about “${escapeMarkup(query)}”`
          : `No posts match “${escapeMarkup(query)}”. Try fewer or different words.`;
    return renderPage(req, {
        section: "blog",
        title: `${query ? `${query} | ` : ""}Search | ${blogTitle()}`,
        description: `Search the ${instanceName()} blog.`,
        url: "/blog",
        feed: true,
        hero: `<section class="blog-hero"><div class="container"><header class="blog-head"><h1 class="display">Search</h1><p role="status">${summary}</p></header></div></section>`,
        content: results.length
            ? `<section class="explore" aria-label="Search results"><div class="container"><div class="grid-3">${results.map((post) => card(post, byId)).join("")}</div></div></section>`
            : "",
        dock: dock(categoryMenu(categories, null), query),
    });
};

export const blogPostPage = async (req: Request, slug: string): Promise<SitePage> => {
    const post = await BlogPost.findOne({ where: { ...publishedWhere(), slug } });
    if (!post) return notFoundPage(req, "blog", "This post doesn't exist or hasn't been published yet.");
    const { byId } = await loadCategories();
    const category = post.category_id ? byId.get(post.category_id) : undefined;
    const sameCategory = category
        ? await BlogPost.find({ where: { ...publishedWhere(), category_id: category.id, id: Not(post.id) }, order: { published_at: "DESC" }, take: 3 })
        : [];
    const others =
        sameCategory.length < 3
            ? await BlogPost.find({
                  where: { ...publishedWhere(), id: Not(In([post.id, ...sameCategory.map((entry) => entry.id)])) },
                  order: { published_at: "DESC" },
                  take: 3 - sameCategory.length,
              })
            : [];
    const related = [...sameCategory, ...others];
    const author = post.author_name.trim() ? instanceText(post.author_name) : instanceHtml();

    const body = renderSiteMarkdown(post.body);
    const title = instanceText(post.title);
    const hero = `<section class="post-head"><div class="post-container">${cover(post, true)}<div class="post-title">${
        category ? `<a class="post-kicker" href="/blog/category/${escapeMarkup(category.slug)}">${instanceText(category.name)}</a>` : ""
    }<h1 id="post-title">${title}</h1></div><div class="byline"><span class="byline-author">${instanceIconTile()}<span>${author}</span></span><time datetime="${isoDate(
        post.published_at,
    )}">${formatDate(post.published_at)}</time></div></div></section>`;

    const content = `<article class="post-body" aria-labelledby="post-title"><div class="post-container"><div class="prose">${body}</div></div></article><div class="post-container"><div class="post-end"><hr><div class="author-card">${instanceIconTile()}<div><strong>${author}</strong><span>${instanceText(
        `Writing for {instance}`,
    )}</span></div></div></div></div>${
        related.length
            ? `<section class="related" aria-labelledby="related-title"><div class="container"><h2 id="related-title">Related articles</h2><div class="grid-3">${related
                  .map((entry) => card(entry, byId))
                  .join("")}</div></div></section>`
            : `<div class="related" aria-hidden="true"></div>`
    }`;

    const outline = [...body.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map(([, id, label]) => `<a href="#${id}"><span>${label.replace(/<[^>]*>/g, "")}</span></a>`);

    return renderPage(req, {
        section: "blog",
        title: `${plainInstanceText(post.title)} | ${blogTitle()}`,
        description: plainInstanceText(postExcerpt(post)),
        url: postUrl(post),
        image: post.cover_image ? siteImageUrl(post.cover_image) : undefined,
        feed: true,
        bodyClass: "post",
        hero,
        content,
        dock: dock(dockMenu(title, "On this page", `<a href="#post-title" aria-current="location"><span>${title}</span></a>${outline.join("")}`)),
    });
};

const xml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const blogAtomFeed = async (req: Request) => {
    const origin = requestOrigin(req);
    const posts = await BlogPost.find({ where: publishedWhere(), order: { published_at: "DESC" }, take: 30 });
    const updated = posts.reduce((latest, post) => Math.max(latest, new Date(post.updated_at).getTime(), new Date(post.published_at ?? 0).getTime()), 0);
    const entries = posts.map((post) => {
        const url = `${origin}${postUrl(post)}`;
        return `<entry><id>${xml(url)}</id><title>${xml(plainInstanceText(post.title))}</title><updated>${new Date(post.updated_at).toISOString()}</updated><published>${isoDate(
            post.published_at,
        )}</published><link href="${xml(url)}"/><author><name>${xml(plainInstanceText(post.author_name.trim() || instanceName()))}</name></author><summary>${xml(
            plainInstanceText(postExcerpt(post)),
        )}</summary><content type="html">${xml(renderSiteMarkdown(post.body))}</content></entry>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${xml(`${origin}/blog`)}</id><title>${xml(blogTitle())}</title><updated>${new Date(
        updated || Date.now(),
    ).toISOString()}</updated><link href="${xml(`${origin}/blog`)}"/><link rel="self" href="${xml(`${origin}/blog/feed.atom`)}"/>${entries.join("")}</feed>`;
};

const helpTitle = () => `${instanceName()} Help Centre`;

const supportHero = (title: string) =>
    `<section class="help-hero"><div class="help-hero-inner"><span class="help-decor left" aria-hidden="true">${instanceIconTile()}</span><span class="help-decor right" aria-hidden="true"></span><h1 class="help-title">${title}</h1>${searchForm()}</div></section>`;

const articleUrl = (article: HelpArticle) => `/support/articles/${article.slug}`;

const categoryUrl = (category: HelpCategory) => `/support/categories/${category.slug}`;

const categoryIcon = (category: HelpCategory) =>
    `<span class="category-art" aria-hidden="true">${
        category.icon_image ? `<img src="${escapeMarkup(siteImageUrl(category.icon_image))}" alt="" loading="lazy">` : escapeMarkup(category.icon.trim() || "📘")
    }</span>`;

export const supportHomePage = async (req: Request): Promise<SitePage> => {
    const categories = await HelpCategory.find({ order: { position: "ASC", name: "ASC" } });
    const sections = categories.length ? await HelpSection.find({ where: { category_id: In(categories.map((category) => category.id)) } }) : [];
    const counts: { section_id: string; count: string | number }[] = sections.length
        ? await HelpArticle.createQueryBuilder("article")
              .select("article.section_id", "section_id")
              .addSelect("COUNT(*)", "count")
              .where("article.published = :published", { published: true })
              .andWhere("article.section_id IN (:...ids)", { ids: sections.map((section) => section.id) })
              .groupBy("article.section_id")
              .getRawMany()
        : [];
    const articlesPerCategory = new Map<string, number>();
    for (const section of sections) {
        const count = Number(counts.find((row) => String(row.section_id) === String(section.id))?.count ?? 0);
        articlesPerCategory.set(section.category_id, (articlesPerCategory.get(section.category_id) ?? 0) + count);
    }
    const promoted = await HelpArticle.find({ where: { published: true, promoted: true }, order: { updated_at: "DESC" }, take: 10 });

    const grid = categories.length
        ? `<div class="help-cards"><ul class="category-grid">${categories
              .map((category) => {
                  const count = articlesPerCategory.get(category.id) ?? 0;
                  return `<li><a class="category-card" href="${escapeMarkup(categoryUrl(category))}">${categoryIcon(category)}<span class="category-text"><h3>${instanceText(
                      category.name,
                  )}</h3><p>${instanceText(category.description)}</p><small>${count} ${count === 1 ? "article" : "articles"}</small></span></a></li>`;
              })
              .join("")}</ul></div>`
        : `<div class="help-page"><div class="empty-state">There's nothing in the help centre yet.</div></div>`;

    const content = `<section class="help-intro" aria-labelledby="help-intro-title"><h2 class="help-heading" id="help-intro-title">How can we help?</h2><p>${instanceText(
        "Guides for your account, encryption, notifications and servers on {instance}. Pick a topic or search for what you need.",
    )}</p></section>${grid}${
        promoted.length
            ? `<section class="help-intro" aria-labelledby="promoted-title"><h2 class="help-heading" id="promoted-title">Popular articles</h2><ul class="promoted-list">${promoted
                  .map((article) => `<li><a href="${escapeMarkup(articleUrl(article))}">${instanceText(article.title)}</a></li>`)
                  .join("")}</ul></section>`
            : ""
    }`;
    return renderPage(req, {
        section: "support",
        title: helpTitle(),
        description: `Guides and answers for ${instanceName()}: accounts, encryption, notifications and servers.`,
        url: "/support",
        hero: supportHero("Help Centre"),
        content,
    });
};

export const supportCategoryPage = async (req: Request, slug: string): Promise<SitePage> => {
    const category = await HelpCategory.findOne({ where: { slug } });
    if (!category) return notFoundPage(req, "support", "That category doesn't exist.");
    const sections = await HelpSection.find({ where: { category_id: category.id }, order: { position: "ASC", name: "ASC" } });
    const articles = sections.length
        ? await HelpArticle.find({ where: { published: true, section_id: In(sections.map((section) => section.id)) }, order: { position: "ASC", title: "ASC" } })
        : [];
    const tree = sections
        .map((section) => {
            const list = articles.filter((article) => article.section_id === section.id);
            if (!list.length) return "";
            return `<section id="section-${escapeMarkup(section.id)}" aria-labelledby="section-title-${escapeMarkup(section.id)}"><h2 id="section-title-${escapeMarkup(section.id)}">${instanceText(
                section.name,
            )}</h2><ul class="article-list">${list
                .map(
                    (article) =>
                        `<li>${article.promoted ? '<span class="promoted-mark" role="img" aria-label="Popular">★</span> ' : ""}<a href="${escapeMarkup(articleUrl(article))}">${instanceText(article.title)}</a></li>`,
                )
                .join("")}</ul></section>`;
        })
        .join("");
    const content = `<div class="help-page"><div class="sub-nav">${crumbs([
        ["Help Centre", "/support"],
        [instanceText(category.name), null],
    ])}${searchForm()}</div><header class="page-header"><h1>${instanceText(category.name)}</h1>${
        category.description.trim() ? `<p>${instanceText(category.description)}</p>` : ""
    }</header>${tree ? `<div class="section-tree">${tree}</div>` : `<div class="empty-state">There are no articles here yet.</div>`}</div>`;
    return renderPage(req, {
        section: "support",
        title: `${plainInstanceText(category.name)} | ${helpTitle()}`,
        description: category.description.trim() ? plainInstanceText(category.description) : `Help articles about ${plainInstanceText(category.name)}.`,
        url: categoryUrl(category),
        hero: "",
        content,
    });
};

export const supportArticlePage = async (req: Request, slug: string, voted: boolean): Promise<SitePage> => {
    const article = await HelpArticle.findOne({ where: { slug, published: true } });
    const section = article ? await HelpSection.findOne({ where: { id: article.section_id } }) : null;
    const category = section ? await HelpCategory.findOne({ where: { id: section.category_id } }) : null;
    if (!article || !section || !category) return notFoundPage(req, "support", "This article doesn't exist or hasn't been published yet.");
    const siblings = await HelpArticle.find({ where: { section_id: section.id, published: true }, order: { position: "ASC", title: "ASC" }, take: SIDEBAR_ARTICLES + 1 });
    const sidebarList = siblings.slice(0, SIDEBAR_ARTICLES);
    if (!sidebarList.some((entry) => entry.id === article.id)) sidebarList.push(article);
    const sectionLinks = `<ul>${sidebarList
        .map((entry) => `<li><a href="${escapeMarkup(articleUrl(entry))}"${entry.id === article.id ? ' aria-current="page"' : ""}>${instanceText(entry.title)}</a></li>`)
        .join("")}</ul>${siblings.length > SIDEBAR_ARTICLES ? `<a class="see-all" href="${escapeMarkup(`${categoryUrl(category)}#section-${section.id}`)}">See more</a>` : ""}`;
    const sidebar = `<aside class="sidebar" aria-labelledby="sidebar-title"><span class="sidebar-title" id="sidebar-title">Articles in this section</span>${sectionLinks}</aside>`;
    const sidebarMobile = `<details class="sidebar-mobile"><summary>Articles in this section${chevron}</summary>${sectionLinks}</details>`;

    const otherSections = await HelpSection.find({ where: { category_id: category.id, id: Not(section.id) }, select: { id: true } });
    const shown = new Set(sidebarList.map((entry) => entry.id));
    const nearby = otherSections.length
        ? await HelpArticle.find({
              where: { published: true, section_id: In(otherSections.map((entry) => entry.id)) },
              order: { position: "ASC", title: "ASC" },
              take: RELATED_ARTICLES,
          })
        : [];
    const popular =
        nearby.length < RELATED_ARTICLES
            ? await HelpArticle.find({ where: { published: true, promoted: true }, order: { updated_at: "DESC" }, take: RELATED_ARTICLES + shown.size })
            : [];
    const related = [...nearby, ...popular.filter((entry) => !shown.has(entry.id) && !nearby.some((other) => other.id === entry.id))].slice(0, RELATED_ARTICLES);

    const total = article.helpful_yes + article.helpful_no;
    const votes = `<section class="votes" id="feedback" aria-labelledby="feedback-title"><h2 id="feedback-title">Was this article helpful?</h2>${
        voted
            ? "<p>Thanks for your feedback.</p>"
            : `<form method="post" action="${escapeMarkup(`${articleUrl(article)}/vote`)}"><button type="submit" name="helpful" value="yes" formaction="${escapeMarkup(
                  `${articleUrl(article)}/vote?helpful=yes`,
              )}">Yes</button><button type="submit" name="helpful" value="no" formaction="${escapeMarkup(`${articleUrl(article)}/vote?helpful=no`)}">No</button></form>`
    }${total ? `<small>${article.helpful_yes} out of ${total} found this helpful</small>` : ""}</section>`;

    const email = Config.get().general.correspondenceEmail?.trim();
    const moreHelp = `<p class="more-help">Have more questions? ${
        email ? `<a href="mailto:${escapeMarkup(email)}">Contact the people who run ${instanceHtml()}</a>` : `<a href="/support">Browse the help centre</a>`
    }</p>`;

    const relatedList = related.length
        ? `<div class="related-help"><section aria-labelledby="related-help-title"><h2 id="related-help-title">Related articles</h2><ul>${related
              .map((entry) => `<li><a href="${escapeMarkup(articleUrl(entry))}">${instanceText(entry.title)}</a></li>`)
              .join("")}</ul></section></div>`
        : "";

    const content = `<div class="help-page"><div class="article-layout">${sidebar}<article class="article"><div class="sub-nav">${crumbs([
        ["Help Centre", "/support"],
        [instanceText(category.name), categoryUrl(category)],
        [instanceText(section.name), `${categoryUrl(category)}#section-${section.id}`],
    ])}${searchForm()}</div>${sidebarMobile}<header class="article-header"><h1>${instanceText(
        article.title,
    )}</h1><div class="article-meta"><span class="article-author">${instanceIconTile()}<span>${instanceHtml()}</span></span><p class="article-date"><time datetime="${isoDate(
        article.updated_at,
    )}">${formatDate(article.updated_at)}</time> · Updated</p></div></header><div class="prose">${renderSiteMarkdown(article.body)}</div>${votes}${moreHelp}${relatedList}</article></div></div>`;

    return renderPage(req, {
        section: "support",
        title: `${plainInstanceText(article.title)} | ${helpTitle()}`,
        description: plainInstanceText(markdownText(article.body).slice(0, 220)),
        url: articleUrl(article),
        hero: "",
        content,
    });
};

const likePattern = (query: string) => `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const highlight = (text: string, query: string) => {
    const lower = text.toLowerCase();
    const needle = query.toLowerCase();
    const index = lower.indexOf(needle);
    const start = index < 0 ? 0 : Math.max(0, index - 80);
    const snippet = text.slice(start, start + 220);
    const prefix = start > 0 ? "…" : "";
    const suffix = start + 220 < text.length ? "…" : "";
    if (index < 0 || !needle) return prefix + instanceText(snippet) + suffix;
    const local = index - start;
    return `${prefix}${instanceText(snippet.slice(0, local))}<mark>${instanceText(snippet.slice(local, local + needle.length))}</mark>${instanceText(snippet.slice(local + needle.length))}${suffix}`;
};

export const supportSearchPage = async (req: Request, rawQuery: string): Promise<SitePage> => {
    const query = rawQuery.trim().slice(0, SEARCH_QUERY_MAX);
    const pattern = likePattern(query);
    const results = query
        ? await HelpArticle.createQueryBuilder("article")
              .where("article.published = :published", { published: true })
              .andWhere(new Brackets((where) => where.where(sqlLike("article.title", ":pattern"), { pattern }).orWhere(sqlLike("article.body", ":pattern"), { pattern })))
              .orderBy("article.promoted", "DESC")
              .addOrderBy("article.updated_at", "DESC")
              .take(SEARCH_RESULTS)
              .getMany()
        : [];
    const sections = results.length ? await HelpSection.find({ where: { id: In([...new Set(results.map((article) => article.section_id))]) } }) : [];
    const categories = sections.length ? await HelpCategory.find({ where: { id: In([...new Set(sections.map((section) => section.category_id))]) } }) : [];
    const rows = results
        .map((article) => {
            const section = sections.find((entry) => entry.id === article.section_id);
            const category = section ? categories.find((entry) => entry.id === section.category_id) : undefined;
            const pathLabel = [category?.name, section?.name]
                .filter((part): part is string => !!part)
                .map(instanceText)
                .join(" › ");
            return `<li><h2><a href="${escapeMarkup(articleUrl(article))}">${instanceText(article.title)}</a></h2>${pathLabel ? `<span class="path">${pathLabel}</span>` : ""}<p>${highlight(
                markdownText(plainInstanceText(article.body)),
                query,
            )}</p></li>`;
        })
        .join("");
    const summary = !query
        ? "Type a word or two to search every published article."
        : results.length
          ? `${results.length === SEARCH_RESULTS ? `The first ${SEARCH_RESULTS}` : results.length} ${results.length === 1 ? "result" : "results"} for “${escapeMarkup(query)}”`
          : `No articles match “${escapeMarkup(query)}”. Try fewer or different words.`;
    const content = `<div class="help-page"><div class="sub-nav">${crumbs([
        ["Help Centre", "/support"],
        ["Search results", null],
    ])}${searchForm(query, !query)}</div><header class="page-header"><h1>Search results</h1><p role="status">${summary}</p></header>${rows ? `<ol class="results">${rows}</ol>` : ""}</div>`;
    return renderPage(req, {
        section: "support",
        title: `${query ? `${query} | ` : ""}Search | ${helpTitle()}`,
        description: `Search the ${instanceName()} help centre.`,
        url: "/support/search",
        hero: "",
        content,
    });
};

export const helpArticleCounts = async (sectionIds: string[]) => {
    if (!sectionIds.length) return new Map<string, number>();
    const rows: { section_id: string; count: string | number }[] = await HelpArticle.createQueryBuilder("article")
        .select("article.section_id", "section_id")
        .addSelect("COUNT(*)", "count")
        .where("article.section_id IN (:...ids)", { ids: sectionIds })
        .groupBy("article.section_id")
        .getRawMany();
    return new Map(rows.map((row) => [String(row.section_id), Number(row.count)]));
};
