import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { RateLimit, HelpArticle } from "@spacebar/database";
import { SEARCH_QUERY_MAX, SitePage, supportArticlePage, supportCategoryPage, supportHomePage, supportSearchPage } from "@spacebar/api/util";
import { isSlug } from "@spacebar/util";
import { hashIp } from "@spacebar/util/util/IpHash";

const router = Router({ mergeParams: true });

const VOTE_COOKIE = "help_votes";
const VOTES_PER_HOUR = 30;

const send = (res: Response, page: SitePage) => res.status(page.status).set("Cache-Control", "no-cache").type("html").send(page.html);

const options = route({ spacebarOnly: true, authentication: "never" });

const slugParam = (req: Request) => {
    const slug = String(req.params.slug).toLowerCase();
    return isSlug(slug) ? slug : "-";
};

export const votedArticles = (header?: string) => {
    const value = header
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${VOTE_COOKIE}=`))
        ?.slice(VOTE_COOKIE.length + 1);
    return new Set((value ?? "").split(".").filter((id) => /^\d{1,20}$/.test(id)));
};

router.get("/", options, async (req: Request, res: Response) => send(res, await supportHomePage(req)));

router.get("/search", options, async (req: Request, res: Response) => {
    const query = typeof req.query.q === "string" ? req.query.q.slice(0, SEARCH_QUERY_MAX) : "";
    send(res, await supportSearchPage(req, query));
});

router.get("/categories/:slug", options, async (req: Request, res: Response) => send(res, await supportCategoryPage(req, slugParam(req))));

router.get("/articles/:slug", options, async (req: Request, res: Response) => {
    const slug = slugParam(req);
    const article = await HelpArticle.findOne({ where: { slug, published: true }, select: { id: true } });
    send(res, await supportArticlePage(req, slug, !!article && votedArticles(req.headers.cookie).has(article.id)));
});

router.post("/articles/:slug/vote", options, async (req: Request, res: Response) => {
    const slug = slugParam(req);
    const article = await HelpArticle.findOne({ where: { slug, published: true }, select: { id: true, slug: true } });
    if (!article) return res.status(404).type("text").send("This article doesn't exist.");
    const voted = votedArticles(req.headers.cookie);
    const helpful = req.query.helpful === "yes" ? true : req.query.helpful === "no" ? false : null;
    if (helpful !== null && !voted.has(article.id)) {
        const voter = hashIp(req.ip) ?? "unknown";
        const { admitted } = await RateLimit.reserve(`help-vote:${voter}`, voter, VOTES_PER_HOUR, 3600);
        if (admitted) await HelpArticle.increment({ id: article.id }, helpful ? "helpful_yes" : "helpful_no", 1);
        voted.add(article.id);
        res.cookie(VOTE_COOKIE, [...voted].slice(-100).join("."), { path: "/support", maxAge: 365 * 24 * 3600 * 1000, httpOnly: true, sameSite: "lax" });
    }
    res.redirect(303, `/support/articles/${article.slug}#feedback`);
});

export default router;
