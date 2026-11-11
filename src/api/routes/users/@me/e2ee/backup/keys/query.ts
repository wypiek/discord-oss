import { Request, Response, Router } from "express";
import { In } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { E2eeErrors, e2eeRateLimit } from "@spacebar/api/util";
import { E2eeBackupKey } from "@spacebar/database";
import { E2eeBackupKeysQuerySchema, E2eeBackupKeysResponse } from "@spacebar/schemas";

const router: Router = Router({ mergeParams: true });

router.post(
    "/",
    e2eeRateLimit("e2ee_backup_keys_query", 120, 60),
    route({
        spacebarOnly: true,
        requestBody: "E2eeBackupKeysQuerySchema",
        responses: { 200: { body: "E2eeBackupKeysResponse" }, 400: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const { message_ids } = req.body as E2eeBackupKeysQuerySchema;
        if (!Array.isArray(message_ids) || message_ids.length > 100 || !message_ids.every((id) => typeof id === "string" && /^\d{1,20}$/.test(id))) throw E2eeErrors.INVALID_BACKUP;
        const rows = message_ids.length ? await E2eeBackupKey.find({ where: { user_id: req.user_id, message_id: In(message_ids) } }) : [];
        res.json({
            keys: rows.map((r) => ({ message_id: r.message_id, enc: r.enc, wrapped: r.wrapped })),
        } satisfies E2eeBackupKeysResponse);
    },
);

export default router;
