import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Message, Recipient } from "@spacebar/database";

const router: Router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            200: {},
        },
    }),
    async (req: Request, res: Response) => {
        const raw = req.query.channel_ids;
        const ids = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String).slice(0, 25);
        const recipients = ids.length
            ? await Recipient.find({
                  where: { user_id: req.user_id, channel_id: In(ids) },
                  select: { id: true, channel_id: true },
              })
            : [];

        const data = await Promise.all(
            recipients.map(async ({ channel_id }) => {
                const message = await Message.findOne({
                    where: { channel_id },
                    order: { id: "DESC" },
                    relations: {
                        author: true,
                        attachments: true,
                        mentions: true,
                        mention_roles: true,
                        sticker_items: true,
                    },
                });
                return { channel_id, message_preview: message?.toPublicJSON(req.user_id) ?? null };
            }),
        );
        res.json(data);
    },
);

export default router;
