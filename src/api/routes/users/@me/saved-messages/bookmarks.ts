import { Request, Response, Router } from "express";
import { IsNull, LessThan } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { SavedMessage } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";
import { savedMessageResults } from "@spacebar/api/util/handlers/SavedMessages";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: { 200: {}, 400: { body: "APIErrorResponse" } },
        query: {
            before: { type: "string", description: "Only bookmarks saved before this time" },
            limit: { type: "number", description: "How many bookmarks to return, 1 to 100 (default 25)" },
        },
    }),
    async (req: Request, res: Response) => {
        const before = typeof req.query.before === "string" && req.query.before !== "" ? new Date(req.query.before) : null;
        if (before && Number.isNaN(before.getTime())) throw FieldErrors({ before: { code: "BASE_TYPE_INVALID", message: "Not a valid timestamp." } });
        const requested = Number(req.query.limit ?? 25);
        const limit = Number.isInteger(requested) ? Math.min(100, Math.max(1, requested)) : 25;
        const saved = await SavedMessage.find({
            where: { user_id: req.user_id, due_at: IsNull(), ...(before ? { saved_at: LessThan(before) } : {}) },
            order: { saved_at: "DESC", message_id: "DESC" },
            take: limit + 1,
        });
        res.json({ results: await savedMessageResults(saved.slice(0, limit), req.user_id), has_more: saved.length > limit });
    },
);

export default router;
