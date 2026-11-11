import { Request, Response, Router } from "express";
import { IsNull, Not } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { SavedMessage } from "@spacebar/database";
import { savedMessageResults } from "@spacebar/api/util/handlers/SavedMessages";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: { 200: {} },
        query: {
            bookmark_ids: {
                type: "boolean",
                description: "Return reminders in full and bookmarks as message ids, which /saved-messages/bookmarks pages through",
            },
        },
    }),
    async (req: Request, res: Response) => {
        if (String(req.query.bookmark_ids) !== "true") {
            const saved = await SavedMessage.find({ where: { user_id: req.user_id }, order: { saved_at: "DESC" } });
            return res.json({ results: await savedMessageResults(saved, req.user_id) });
        }
        const [reminders, bookmarks] = await Promise.all([
            SavedMessage.find({ where: { user_id: req.user_id, due_at: Not(IsNull()) }, order: { due_at: "ASC" } }),
            SavedMessage.find({ select: { message_id: true }, where: { user_id: req.user_id, due_at: IsNull() }, order: { saved_at: "DESC" } }),
        ]);
        res.json({
            reminders: await savedMessageResults(reminders, req.user_id),
            bookmark_ids: bookmarks.map((entry) => entry.message_id),
        });
    },
);

export default router;
