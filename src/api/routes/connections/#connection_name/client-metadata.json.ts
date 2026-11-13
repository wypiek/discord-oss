import { route } from "@spacebar/api/middlewares";
import { ConnectionStore, DiscordApiErrors } from "@spacebar/util";
import { Request, Response, Router } from "express";

const router = Router({ mergeParams: true });

router.get("/", route({ authentication: "never", responses: { 200: {}, 404: { body: "APIErrorResponse" } } }), (req: Request, res: Response) => {
    const connection = ConnectionStore.connections.get(req.params.connection_name as string) as { isAvailable: boolean; clientMetadata?: () => object } | undefined;
    if (!connection?.isAvailable || typeof connection.clientMetadata !== "function") throw DiscordApiErrors.UNKNOWN_CONNECTION;
    res.set("Cache-Control", "public, max-age=300").json(connection.clientMetadata());
});

export default router;
