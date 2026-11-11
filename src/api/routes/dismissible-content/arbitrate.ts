import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";

const router = Router({ mergeParams: true });

router.post("/", route({}), (req: Request, res: Response) => {
    const candidates: unknown[] = Array.isArray(req.body?.candidates) ? req.body.candidates.slice(0, 100) : [];
    const contents = [
        ...new Set(
            candidates.flatMap((candidate) => {
                const content = (candidate as { content?: unknown })?.content;
                return (typeof content === "string" && content.length <= 128) || (typeof content === "number" && Number.isFinite(content)) ? [content] : [];
            }),
        ),
    ];
    res.json({ candidates: contents.map((content) => ({ content })) });
});

export default router;
