import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { externalProxyPath, FieldErrors } from "@spacebar/util";
import { ApplicationExternalAsset, ApplicationExternalAssetsSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

function externalAssetPath(input: string) {
    if (!URL.canParse(input)) return null;
    const url = new URL(input);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return externalProxyPath(url).replace(/^\//, "");
}

router.post(
    "/",
    route({
        requestBody: "ApplicationExternalAssetsSchema",
        responses: {
            200: { body: "ApplicationExternalAssetsResponse" },
            400: { body: "APIErrorResponse" },
        },
    }),
    async (req: Request, res: Response) => {
        if (!/^\d{1,20}$/.test(req.params.application_id as string)) throw FieldErrors({ application_id: { code: "NUMBER_TYPE_COERCE", message: "Value is not snowflake." } });
        const { urls } = req.body as ApplicationExternalAssetsSchema;
        const assets: ApplicationExternalAsset[] = [];
        for (const url of urls) {
            const external_asset_path = externalAssetPath(url);
            if (!external_asset_path) throw FieldErrors({ urls: { code: "URL_TYPE_INVALID_URL", message: "Not a well formed URL." } });
            assets.push({ url, external_asset_path });
        }
        res.json(assets);
    },
);

export default router;
