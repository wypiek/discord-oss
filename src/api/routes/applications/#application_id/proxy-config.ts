import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { ownedEmbeddedActivity } from "@spacebar/api/activities";
import { forgetActivityLookup } from "@spacebar/api/activities/ActivityHost";
import { EmbeddedActivity } from "@spacebar/database";
import { FieldErrors, isPublicUrl } from "@spacebar/util";
import { ApplicationProxyConfigSchema } from "@spacebar/schemas";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: { 200: {}, 403: { body: "APIErrorResponse" }, 404: { body: "APIErrorResponse" } },
    }),
    async (req: Request, res: Response) => {
        const activity = await ownedEmbeddedActivity(req.params.application_id as string, req.user_id);
        res.json({ url_map: activity.url_mappings });
    },
);

const replace = async (req: Request, res: Response) => {
    const body = req.body as ApplicationProxyConfigSchema;
    const activity = await ownedEmbeddedActivity(req.params.application_id as string, req.user_id);
    const url_map = [];
    const prefixes = new Set<string>();
    for (const [index, mapping] of body.url_map.entries()) {
        const prefix = mapping.prefix.trim() === "/" ? "/" : mapping.prefix.trim().replace(/\/+$/, "");
        const target = mapping.target
            .trim()
            .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
            .replace(/\/+$/, "");
        if (!/^\/[^\s?#]*$/.test(prefix))
            throw FieldErrors({
                [`url_map.${index}.prefix`]: {
                    code: "URL_TYPE_INVALID_URL",
                    message: "Prefixes start with / and can't contain spaces, ? or #.",
                },
            });
        if (prefixes.has(prefix))
            throw FieldErrors({
                [`url_map.${index}.prefix`]: {
                    code: "DUPLICATE_PREFIX",
                    message: "Each prefix can only be mapped once.",
                },
            });
        if (!target || /[\s?#]/.test(target) || !URL.canParse(`https://${target}`))
            throw FieldErrors({
                [`url_map.${index}.target`]: {
                    code: "URL_TYPE_INVALID_URL",
                    message: "Enter a domain, optionally with a path, like example.com/app.",
                },
            });
        if (!(await isPublicUrl(`https://${target}`)))
            throw FieldErrors({
                [`url_map.${index}.target`]: {
                    code: "URL_TYPE_INVALID_URL",
                    message: "This target doesn't resolve to a public address.",
                },
            });
        prefixes.add(prefix);
        url_map.push({ prefix, target });
    }
    await EmbeddedActivity.update({ application_id: activity.application_id }, { url_mappings: url_map });
    forgetActivityLookup(activity.application_id);
    res.json({ url_map });
};

for (const method of ["put", "patch"] as const)
    router[method](
        "/",
        route({
            requestBody: "ApplicationProxyConfigSchema",
            responses: {
                200: {},
                400: { body: "APIErrorResponse" },
                403: { body: "APIErrorResponse" },
                404: { body: "APIErrorResponse" },
            },
        }),
        replace,
    );

export default router;
