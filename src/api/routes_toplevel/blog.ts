import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { blogAtomFeed, blogListingPage, blogPostPage, blogSearchPage, SEARCH_QUERY_MAX, SitePage } from "@spacebar/api/util";
import { isSlug } from "@spacebar/util";

const router = Router({ mergeParams: true });

const pageNumber = (value: unknown) => {
    const page = Number(typeof value === "string" ? value : 1);
    return Number.isInteger(page) && page >= 1 && page <= 10000 ? page : 1;
};

const send = (res: Response, page: SitePage) => res.status(page.status).set("Cache-Control", "no-cache").type("html").send(page.html);

const options = route({ spacebarOnly: true, authentication: "never" });

router.get("/", options, async (req: Request, res: Response) => {
    if (typeof req.query.q === "string") return send(res, await blogSearchPage(req, req.query.q.slice(0, SEARCH_QUERY_MAX)));
    send(res, await blogListingPage(req, pageNumber(req.query.page)));
});

router.get("/feed.atom", options, async (req: Request, res: Response) => {
    res.set("Cache-Control", "public, max-age=300")
        .type("application/atom+xml")
        .send(await blogAtomFeed(req));
});

router.get("/category/:slug", options, async (req: Request, res: Response) => {
    const slug = String(req.params.slug).toLowerCase();
    send(res, await blogListingPage(req, pageNumber(req.query.page), isSlug(slug) ? slug : "-"));
});

router.get("/:slug", options, async (req: Request, res: Response) => {
    const slug = String(req.params.slug).toLowerCase();
    send(res, await blogPostPage(req, isSlug(slug) ? slug : "-"));
});

export default router;
