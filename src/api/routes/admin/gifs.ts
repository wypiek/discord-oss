import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { Config } from "@spacebar/util";
import { GifProviderManager } from "@spacebar/integrations/gifs";
import { HTTPError } from "lambert-server";

const router = Router({ mergeParams: true });
const settings = () => {
    const config = Config.get().integrations.gifs;
    return {
        enabled: config.enabled,
        defaultProvider: config.defaultProvider,
        klipy: {
            enabled: config.klipy.enabled,
            key_set: !!(config.klipy.apiKey || config.klipy.apiKeyPath),
        },
        tenor: {
            enabled: config.tenor.enabled,
            key_set: !!(config.tenor.apiKey || config.tenor.apiKeyPath),
        },
        providers: GifProviderManager.getProviders(),
    };
};
router.get("/", route({ right: "OPERATOR", spacebarOnly: true }), (_req: Request, res: Response) => res.json(settings()));
router.patch("/", route({ right: "OPERATOR", spacebarOnly: true }), async (req: Request, res: Response) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["enabled", "defaultProvider", "klipy", "tenor"].includes(key)))
        throw new HTTPError("Invalid GIF settings", 400);
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new HTTPError("Invalid GIF setting", 400);
    if (body.defaultProvider !== undefined && !["klipy", "tenor"].includes(body.defaultProvider)) throw new HTTPError("Invalid GIF provider", 400);
    const patch: Record<string, unknown> = {};
    for (const provider of ["klipy", "tenor"]) {
        const value = body[provider];
        if (value === undefined) continue;
        if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !["enabled", "apiKey", "clearKey"].includes(key)))
            throw new HTTPError("Invalid GIF provider settings", 400);
        if (value.enabled !== undefined && typeof value.enabled !== "boolean") throw new HTTPError("Invalid GIF provider setting", 400);
        if (value.apiKey !== undefined && (typeof value.apiKey !== "string" || value.apiKey.length > 512 || /[\s/?#]/.test(value.apiKey)))
            throw new HTTPError("Invalid API key", 400);
        if (value.clearKey !== undefined && typeof value.clearKey !== "boolean") throw new HTTPError("Invalid API key setting", 400);
        patch[provider] = {
            ...(value.enabled === undefined ? {} : { enabled: value.enabled }),
            ...(value.apiKey ? { apiKey: value.apiKey } : {}),
            ...(value.clearKey ? { apiKey: null, apiKeyPath: null } : {}),
        };
    }
    await Config.set({
        integrations: {
            gifs: {
                ...patch,
                ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
                ...(body.defaultProvider === undefined ? {} : { defaultProvider: body.defaultProvider }),
            },
        },
    } as Parameters<typeof Config.set>[0]);
    await GifProviderManager.init();
    res.json(settings());
});
export default router;
