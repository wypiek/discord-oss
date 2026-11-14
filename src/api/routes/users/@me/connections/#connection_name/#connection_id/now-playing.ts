import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ConnectedAccount } from "@spacebar/database";
import { ConnectionStore, DiscordApiErrors, FieldErrors, lastFmNowPlaying } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get("/", route({}), async (req: Request, res: Response) => {
    const { connection_name, connection_id } = req.params as { [key: string]: string };
    const connection = ConnectionStore.connections.get(connection_name);
    if (connection_name !== "lastfm" || !connection)
        throw FieldErrors({ provider_id: { code: "BASE_TYPE_CHOICES", message: req.t("common:field.BASE_TYPE_CHOICES", { types: "lastfm" }) } });
    if (!connection.isAvailable) throw FieldErrors({ provider_id: { message: "This connection has been disabled server-side." } });

    const account = await ConnectedAccount.findOne({
        where: { type: connection_name, external_id: connection_id, user_id: req.user_id },
        select: { external_id: true, revoked: true },
    });
    if (!account) throw DiscordApiErrors.UNKNOWN_CONNECTION;
    if (account.revoked) throw DiscordApiErrors.CONNECTION_REVOKED;

    const apiKey = (connection.settings as unknown as { apiKey: string }).apiKey;
    const track = await lastFmNowPlaying(account.external_id, apiKey);
    res.set("Cache-Control", "private, no-store").json({ track: track && { ...track, elapsed_ms: Math.max(0, Date.now() - track.since) } });
});

export default router;
