import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Config, Connection, ConnectionConfig, ConnectionStore } from "@spacebar/util";

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
        setup_url: connection.setupUrl || null,
        fields: settingFields(connection).map((field) =>
            isSecretField(field) ? { name: field, secret: true, set: !!settings[field] } : { name: field, secret: false, set: !!settings[field], value: settings[field] ?? null },
        ),
    };
}

router.get("/", route({ right: "OPERATOR", spacebarOnly: true, description: "List connected account providers and their settings" }), (_req: Request, res: Response) => {
    res.json({
        third_party: Config.get().externalRequests.thirdParty,
        connections: Array.from(ConnectionStore.connections.values())
            .map(describeConnection)
            .sort((a, b) => a.name.localeCompare(b.name)),
    });
});

export default router;
