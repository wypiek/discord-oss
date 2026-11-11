import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { renderSiteMarkdown } from "@spacebar/api/util";
import { AdminMarkdownPreviewSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        right: "OPERATOR",
        spacebarOnly: true,
        requestBody: "AdminMarkdownPreviewSchema",
        description: "Render Markdown the way the blog and help centre show it",
    }),
    (req: Request, res: Response) => {
        const body = req.body as AdminMarkdownPreviewSchema;
        res.json({ html: renderSiteMarkdown(body.markdown) });
    },
);

export default router;
