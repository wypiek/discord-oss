import { route } from "@spacebar/api/middlewares";
import { ConnectionStore, emitEvent, FieldErrors } from "@spacebar/util";
import { Request, Response, Router } from "express";
import { ConnectionCallbackSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.post(
    "/",
    route({
        requestBody: "ConnectionCallbackSchema",
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
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

        if (!connection.settings.enabled)
            throw FieldErrors({
                provider_id: {
                    message: "This connection has been disabled server-side.",
                },
            });

        const body = req.body as ConnectionCallbackSchema;
        const userId = connection.getUserId(body.state);
        const connectedAccnt = await connection.handleCallback(body);

        // whether we should emit a connections update event, only used when a connection doesnt already exist
        if (connectedAccnt)
            await emitEvent({
                event: "USER_CONNECTIONS_UPDATE",
                data: { ...connectedAccnt, token_data: undefined },
                user_id: userId,
            });

        res.sendStatus(204);
    },
);

export default router;
