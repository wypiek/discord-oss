import { route } from "@spacebar/api/middlewares";
import { Request, Response, Router } from "express";
import { ConnectionStore, FieldErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { connection_name } = req.params as { [key: string]: string };
    const connection = ConnectionStore.connections.get(connection_name);
    if (!connection)
        throw FieldErrors({
            provider_id: {
                code: "BASE_TYPE_CHOICES",
                message: req.t("common:field.BASE_TYPE_CHOICES", {
                    types: Array.from(ConnectionStore.connections.keys()).join(", "),
                }),
            },
        });

    if (!connection.isAvailable)
        throw FieldErrors({
            provider_id: {
                message: "This connection has been disabled server-side.",
            },
        });

    const handle = typeof req.query.handle === "string" ? req.query.handle.slice(0, 256) : undefined;
    res.json({
        url: await connection.getAuthorizationUrl(req.user_id, { handle }),
    });
});

export default router;
