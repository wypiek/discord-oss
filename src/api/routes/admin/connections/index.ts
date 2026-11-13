import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Config, Connection, ConnectionConfig, ConnectionStore, connectionOriginSource, normalizeConnectionsOrigin } from "@spacebar/util";
import { HTTPError } from "lambert-server";

const router = Router({ mergeParams: true });

export const isSecretField = (field: string) => /secret|key|token/i.test(field);

export const settingFields = (connection: Connection) => Object.keys(connection.settings).filter((field) => field !== "enabled");

export function describeConnection(connection: Connection) {
    const stored = (ConnectionConfig.get() as Record<string, Record<string, unknown> | undefined>)[connection.id] ?? {};
    const settings = connection.settings as unknown as Record<string, unknown>;
    return {
        id: connection.id,
        name: connection.friendlyName,
        enabled: stored.enabled === true,
        configured: connection.isConfigured,
        available: connection.isAvailable,
        callback_url: connection.getRedirectUri(),
        link_url: "clientMetadataUrl" in connection ? String((connection as Connection & { clientMetadataUrl: string }).clientMetadataUrl) : connection.getRedirectUri(),
        setup_url: connection.setupUrl || null,
        fields: settingFields(connection).map((field) =>
            isSecretField(field) ? { name: field, secret: true, set: !!settings[field] } : { name: field, secret: false, set: !!settings[field], value: settings[field] ?? null },
        ),
    };
}

function overview() {
    const { origin, source } = connectionOriginSource();
    return {
        third_party: Config.get().externalRequests.thirdParty,
        callback_origin: origin || null,
        callback_origin_source: source,
        connections_origin: Config.get().api.connectionsOrigin ?? null,
        connections: Array.from(ConnectionStore.connections.values())
            .map(describeConnection)
            .sort((a, b) => a.name.localeCompare(b.name)),
    };
}

router.get("/", route({ right: "OPERATOR", spacebarOnly: true, description: "List connected account providers and their settings" }), (_req: Request, res: Response) => {
    res.json(overview());
});

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, description: "Turn third-party connections on or off and set the public address used in callback URLs" }),
    async (req: Request, res: Response) => {
        const body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["third_party", "connections_origin"].includes(key)))
            throw new HTTPError("Invalid connection settings", 400);
        if (body.third_party !== undefined && typeof body.third_party !== "boolean") throw new HTTPError("Invalid connection settings", 400);
        const patch: Record<string, unknown> = {};
        if (body.third_party !== undefined) patch.externalRequests = { thirdParty: body.third_party };
        if (body.connections_origin !== undefined) {
            const connectionsOrigin = normalizeConnectionsOrigin(body.connections_origin);
            if (connectionsOrigin === undefined) throw new HTTPError("Enter only the instance's public address, such as https://example.com", 400);
            patch.api = { connectionsOrigin };
        }
        if (Object.keys(patch).length) await Config.set(patch as Parameters<typeof Config.set>[0]);
        res.json(overview());
    },
);

export default router;
