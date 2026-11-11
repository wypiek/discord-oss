import { Request, Response, Router } from "express";
import imageSize from "image-size";
import type { EntityManager } from "typeorm";
import { route } from "@spacebar/api/middlewares";
import { Application, ApplicationWidgetConfig } from "@spacebar/database";
import { DiscordApiErrors, FieldErrors, Snowflake, deleteFile, handleFile } from "@spacebar/util";
import { MAX_WIDGET_ASSETS, parseWidgetSurfaces } from "@spacebar/api/util/handlers/ApplicationWidgets";

const router = Router({ mergeParams: true });
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const ownedApplication = async (req: Request, manager?: EntityManager) => {
    const options = {
        where: { id: req.params.application_id as string },
        select: { id: true, owner_id: true, widget_config: true, widget_public: true },
    } as const;
    const app = manager ? await manager.findOne(Application, { ...options, lock: { mode: "pessimistic_write" } }) : await Application.findOne(options);
    if (!app) throw DiscordApiErrors.UNKNOWN_APPLICATION;
    if (app.owner_id !== req.user_id) throw DiscordApiErrors.ACTION_NOT_AUTHORIZED_ON_APPLICATION;
    return app;
};

const emptyConfig = (): ApplicationWidgetConfig => ({
    config_id: Snowflake.generate(),
    surfaces: {},
    assets: [],
    updated_at: new Date().toISOString(),
});

router.get("/", route({ responses: { 200: {}, 403: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const app = await ownedApplication(req);
    res.json({ config: app.widget_config ?? null, public: app.widget_public });
});

const assetKeys = (raw: unknown, field: string) => {
    if (raw === undefined) return undefined;
    if (!Array.isArray(raw) || raw.length > MAX_WIDGET_ASSETS || raw.some((key) => typeof key !== "string" || !key || key.length > 64))
        throw FieldErrors({
            [field]: {
                code: "BASE_TYPE_BAD_LENGTH",
                message: `Provide up to ${MAX_WIDGET_ASSETS} image keys.`,
            },
        });
    return new Set<string>(raw);
};

const removeUnusedFiles = async (id: string, assets: ApplicationWidgetConfig["assets"]) => {
    if (!assets.length) return;
    await Application.getRepository().manager.transaction(async (manager) => {
        const app = await manager.findOne(Application, {
            where: { id },
            select: { id: true, widget_config: true },
            lock: { mode: "pessimistic_write" },
        });
        const retained = new Set(app?.widget_config?.assets.map((asset) => asset.asset_id));
        await Promise.all(assets.filter((asset) => !retained.has(asset.asset_id)).map((asset) => deleteFile(`/app-assets/${id}/${asset.asset_id}`).catch(() => null)));
    });
};

router.put(
    "/",
    route({
        responses: { 200: {}, 400: { body: "APIErrorResponse" }, 403: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const body = req.body as {
            surfaces?: unknown;
            public?: unknown;
            asset_keys?: unknown;
            retained_asset_keys?: unknown;
        };
        const result = await Application.getRepository().manager.transaction(async (manager) => {
            const app = await ownedApplication(req, manager);
            const known = assetKeys(body.asset_keys, "asset_keys");
            const retained = assetKeys(body.retained_asset_keys, "retained_asset_keys") ?? new Set<string>();
            const config = app.widget_config ?? emptyConfig();
            const surfaces = parseWidgetSurfaces(body.surfaces, new Set(config.assets.map((asset) => asset.key)));
            const used = new Set(
                Object.values(surfaces).flatMap((surface) =>
                    Object.values(surface.components).flatMap((component) =>
                        Object.values(component.fields)
                            .filter((field) => field.value_type === "application_asset")
                            .map((field) => field.value),
                    ),
                ),
            );
            const keep = (key: string) => used.has(key) || retained.has(key) || (known !== undefined && !known.has(key));
            const kept = config.assets.filter((asset) => keep(asset.key));
            const dropped = config.assets.filter((asset) => !keep(asset.key));
            const next: ApplicationWidgetConfig = {
                ...config,
                surfaces,
                assets: kept,
                updated_at: new Date().toISOString(),
            };
            await manager.update(
                Application,
                { id: app.id },
                {
                    widget_config: next,
                    ...(typeof body.public === "boolean" && { widget_public: body.public }),
                },
            );
            return {
                id: app.id,
                dropped,
                config: next,
                public: typeof body.public === "boolean" ? body.public : app.widget_public,
            };
        });
        await removeUnusedFiles(result.id, result.dropped);
        res.json({ config: result.config, public: result.public });
    },
);

router.delete("/", route({ responses: { 204: {}, 403: { body: "APIErrorResponse" } } }), async (req: Request, res: Response) => {
    const result = await Application.getRepository().manager.transaction(async (manager) => {
        const app = await ownedApplication(req, manager);
        await manager.update(Application, { id: app.id }, { widget_config: null, widget_public: false });
        return { id: app.id, assets: app.widget_config?.assets ?? [] };
    });
    await removeUnusedFiles(result.id, result.assets);
    res.sendStatus(204);
});

router.post(
    "/assets",
    route({
        responses: { 201: {}, 400: { body: "APIErrorResponse" }, 403: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        await ownedApplication(req);
        const { image } = req.body as { image?: unknown };
        const imageError = (message: string) => FieldErrors({ image: { code: "IMAGE_INVALID", message } });
        if (typeof image !== "string" || !/^data:image\/(png|jpeg|gif|webp);base64,/.test(image)) throw imageError("Upload a PNG, JPEG, GIF or WebP image.");
        const buffer = Buffer.from(image.slice(image.indexOf(",") + 1), "base64");
        if (buffer.length > MAX_IMAGE_BYTES) throw imageError("Images can be up to 8 MB.");
        let dimensions: { width?: number; height?: number };
        try {
            dimensions = imageSize(buffer);
        } catch {
            throw imageError("This image couldn't be read.");
        }
        if (!dimensions.width || !dimensions.height) throw imageError("This image couldn't be read.");

        const asset = await Application.getRepository().manager.transaction(async (manager) => {
            const app = await ownedApplication(req, manager);
            const config = app.widget_config ?? emptyConfig();
            if (config.assets.length >= MAX_WIDGET_ASSETS) throw imageError(`A widget can have up to ${MAX_WIDGET_ASSETS} images. Save your widget to free up replaced ones.`);
            const id = await handleFile(`/app-assets/${app.id}`, image);
            if (!id) throw imageError("Upload a PNG, JPEG, GIF or WebP image.");
            const existing = config.assets.find((asset) => asset.asset_id === id);
            const asset = existing ?? {
                key: id,
                asset_id: id,
                width: dimensions.width,
                height: dimensions.height,
                is_animated: id.startsWith("a_"),
                updated_at: new Date().toISOString(),
            };
            if (!existing) await manager.update(Application, { id: app.id }, { widget_config: { ...config, assets: [...config.assets, asset] } });
            return asset;
        });
        res.status(201).json(asset);
    },
);

export default router;
