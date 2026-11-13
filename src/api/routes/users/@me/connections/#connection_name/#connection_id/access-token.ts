import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ConnectedAccount } from "@spacebar/database";
import { ApiError, ConnectionStore, DiscordApiErrors, FieldErrors, isTokenExpired, RefreshableConnection } from "@spacebar/util";

const router = Router({ mergeParams: true });

const ALLOWED_CONNECTIONS = ["spotify", "twitch", "youtube"];

router.get("/", route({}), async (req: Request, res: Response) => {
    const { connection_name, connection_id } = req.params as { [key: string]: string };

    const connection = ConnectionStore.connections.get(connection_name);

    if (!ALLOWED_CONNECTIONS.includes(connection_name) || !connection)
        throw FieldErrors({
            provider_id: {
                code: "BASE_TYPE_CHOICES",
                message: req.t("common:field.BASE_TYPE_CHOICES", {
                    types: ALLOWED_CONNECTIONS.join(", "),
                }),
            },
        });

    if (!connection.settings.enabled)
        throw FieldErrors({
            provider_id: {
                message: "This connection has been disabled server-side.",
            },
        });

    const connectedAccount = await ConnectedAccount.findOne({
        where: {
            type: connection_name,
            external_id: connection_id,
            user_id: req.user_id,
        },
        select: {
            user_id: true,
            external_id: true,
            type: true,
            revoked: true,
            token_data: true,
        },
    });
    if (!connectedAccount) throw DiscordApiErrors.UNKNOWN_CONNECTION;
    if (connectedAccount.revoked) throw DiscordApiErrors.CONNECTION_REVOKED;
    if (!connectedAccount.token_data) throw new ApiError("No token data", 0, 400);

    if (!isTokenExpired(connectedAccount.token_data)) return res.json({ access_token: connectedAccount.token_data.access_token });
    if (!(connection instanceof RefreshableConnection) || !connectedAccount.token_data.refresh_token) throw new ApiError("Access token expired", 0, 400);
    const tokenData = await connection.refresh(connectedAccount);
    res.json({ access_token: tokenData.access_token });
});

export default router;
