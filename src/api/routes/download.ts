import { Request, Response, Router } from "express";
import { route } from "@spacebar/api/middlewares";
import { assertMaxLength } from "@spacebar/api/util/utility/inputCaps";
import { ClientRelease } from "@spacebar/database";
import { FieldErrors } from "@spacebar/util";

const router = Router({ mergeParams: true });

router.get(
    "/",
    route({
        responses: {
            302: {},
            404: {
                body: "APIErrorResponse",
            },
        },
        authentication: "never",
    }),
    async (req: Request, res: Response) => {
        const { platform } = req.query;
        assertMaxLength("platform", platform, 32);

        if (!platform)
            throw FieldErrors({
                platform: {
                    code: "BASE_TYPE_REQUIRED",
                    message: req.t("common:field.BASE_TYPE_REQUIRED"),
                },
            });

        const release = await ClientRelease.findOneOrFail({
            where: {
                enabled: true,
                platform: platform as string,
            },
            order: { pub_date: "DESC" },
        });

        res.redirect(release.url);
    },
);

export default router;
