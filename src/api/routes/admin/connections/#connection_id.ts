import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ConnectionConfig, ConnectionLoader, ConnectionStore } from "@spacebar/util";
import { HTTPError } from "lambert-server";
import { describeConnection, settingFields } from "./index";

const router = Router({ mergeParams: true });

router.patch(
    "/",
    route({ right: "OPERATOR", spacebarOnly: true, description: "Turn a connected account provider on or off and set its credentials" }),
    async (req: Request, res: Response) => {
        const connection = ConnectionStore.connections.get(req.params.connection_id as string);
        if (!connection) throw new HTTPError("Unknown connection provider", 404);

        const body = req.body;
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["enabled", "values", "clear"].includes(key)))
            throw new HTTPError("Invalid connection settings", 400);
        if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new HTTPError("Invalid connection setting", 400);

        const fields = settingFields(connection);
        const values = body.values ?? {};
        const clear = body.clear ?? [];
        if (!values || typeof values !== "object" || Array.isArray(values) || !Array.isArray(clear)) throw new HTTPError("Invalid connection settings", 400);
        for (const [field, value] of Object.entries(values))
            if (!fields.includes(field) || typeof value !== "string" || value.length > 512 || /\s/.test(value)) throw new HTTPError(`Invalid value for ${field}`, 400);
        if (clear.some((field: unknown) => typeof field !== "string" || !fields.includes(field))) throw new HTTPError("Invalid connection settings", 400);

        const patch: Record<string, unknown> = {
            ...Object.fromEntries(clear.map((field: string) => [field, null])),
            ...Object.fromEntries(Object.entries(values as Record<string, string>).filter(([, value]) => value)),
            ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        };
        const stored = (ConnectionConfig.get() as Record<string, Record<string, unknown> | undefined>)[connection.id] ?? {};
        const next = { ...stored, ...patch };
        const missing = connection.requiredSettings.filter((field) => !next[field]);
        if (next.enabled === true && missing.length) throw new HTTPError(`Add ${missing.join(" and ")} before turning ${connection.friendlyName} on`, 400);

        await ConnectionLoader.setConnectionConfig(connection.id, patch);
        connection.init();
        res.json(describeConnection(connection));
    },
);

export default router;
